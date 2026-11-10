// EDAE v1 segmentli AEAD nesne biçimi (033 §4.2, §4.5, §4.6). Saf: yalnız node:crypto; akış ilkelleri
// `push`/`finish` durum makineleridir (node:stream YOK; I/O yapmaz). Node akışı gerekiyorsa çağıran
// `Readable.from(encryptIterable(...))` ile sarar.
//
// Biçim: 24 bayt başlık ‖ şifreli segmentler. Her segment 64 KiB düz metin (yalnız sonuncusu daha kısa
// olabilir, 1..65536 bayt) + 16 bayt GCM etiketi. Nonce = nonce_prefix (8) ‖ uint32_BE(segment_no);
// AAD = org_id (16) ‖ file_id (16) ‖ key_version (4) ‖ segment_no (4) ‖ is_last (1).
//
// Güvenlik özellikleri:
//  - Segment düz metni etiket doğrulanmadan (`final()` başarılı olmadan) ASLA yayılmaz (D3). Node'da GCM
//    `update()` doğrulamadan önce düz metin döndürür; bu tampon hata hâlinde sıfırlanır ve atılır.
//  - Segment yer değiştirme (segment_no AAD), son segmentin atılması/eklenmesi (is_last AAD + bir segment
//    ileri bakış), başlık/nonce/etiket bozulması, yanlış org/file/key_version bağlamı ve varyant anahtarı
//    takası (HKDF varyant anahtarı) çözmede `auth_failed` verir.
//  - Aynı (anahtar, nonce) çifti tekrar kullanılmaz: nonce_prefix nesne başına CSPRNG'dir ve her varyant
//    ayrı HKDF anahtarı kullanır.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { concatAad, uint32Bytes, uuidBytes, versionBytes } from './aad.ts';
import { CryptoError } from './errors.ts';
import { assertKey, TAG_BYTES } from './gcm.ts';
import type { ObjectContext } from './keys.ts';

export const SEGMENT_PLAIN_BYTES = 65_536;
export const HEADER_BYTES = 24;
export const SEGMENT_CIPHER_BYTES_MAX = SEGMENT_PLAIN_BYTES + TAG_BYTES;
/** Başlık `seg_log2` alanı: 2^16 = 64 KiB. */
const SEG_LOG2 = 16;
const NONCE_PREFIX_BYTES = 8;
const MAGIC = Buffer.from('EDAE', 'ascii');
const FORMAT_VERSION = 0x01;
const ALG_AES_256_GCM = 0x01;
const ALG = 'aes-256-gcm';
const SEGMENT_NO_MAX = 0xffff_ffff;

function authFailed(): CryptoError {
  return new CryptoError(
    'auth_failed',
    'Şifreli nesne çözülemedi: başlık, bağlam (AAD), anahtar veya veri bütünlüğü doğrulanamadı.',
  );
}

function header(keyVersion: number, noncePrefix: Uint8Array): Buffer {
  const h = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(h, 0);
  h[4] = FORMAT_VERSION;
  h[5] = ALG_AES_256_GCM;
  h[6] = SEG_LOG2;
  h[7] = 0x00;
  versionBytes(keyVersion).copy(h, 8);
  Buffer.from(noncePrefix).copy(h, 12);
  // 20..23 ayrılmış, sıfır.
  return h;
}

/** Başlığı katı doğrular; `nonce_prefix` ve `key_version` döner. Yanlış sabit = `auth_failed`. */
export function parseHeader(h: Uint8Array): { keyVersion: number; noncePrefix: Buffer } {
  if (h.length !== HEADER_BYTES) throw authFailed();
  const b = Buffer.from(h.buffer, h.byteOffset, h.length);
  const fixedOk =
    b.subarray(0, 4).equals(MAGIC) &&
    b[4] === FORMAT_VERSION &&
    b[5] === ALG_AES_256_GCM &&
    b[6] === SEG_LOG2 &&
    b[7] === 0x00 &&
    b.readUInt32BE(20) === 0;
  if (!fixedOk) throw authFailed();
  const keyVersion = b.readUInt32BE(8);
  if (keyVersion < 1) throw authFailed();
  return { keyVersion, noncePrefix: Buffer.from(b.subarray(12, 12 + NONCE_PREFIX_BYTES)) };
}

function segmentNonce(prefix: Uint8Array, segmentNo: number): Buffer {
  return Buffer.concat([prefix, uint32Bytes(segmentNo)]);
}

function segmentAad(ctx: ObjectContext, segmentNo: number, isLast: boolean): Buffer {
  return concatAad([
    uuidBytes(ctx.orgId),
    uuidBytes(ctx.fileId),
    versionBytes(ctx.keyVersion),
    uint32Bytes(segmentNo),
    Buffer.of(isLast ? 0x01 : 0x00),
  ]);
}

function sealSegment(
  key: Uint8Array,
  ctx: ObjectContext,
  prefix: Uint8Array,
  segmentNo: number,
  isLast: boolean,
  plain: Uint8Array,
): Buffer {
  if (segmentNo > SEGMENT_NO_MAX) {
    throw new CryptoError('invalid_input', 'Nesne en çok 2^32 segment içerebilir.');
  }
  // Her segment için YENİ şifre nesnesi (033 §4.5).
  const cipher = createCipheriv(ALG, key, segmentNonce(prefix, segmentNo), {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(segmentAad(ctx, segmentNo, isLast));
  const body = cipher.update(plain);
  const tail = cipher.final();
  return Buffer.concat([body, tail, cipher.getAuthTag()]);
}

function openSegment(
  key: Uint8Array,
  ctx: ObjectContext,
  prefix: Uint8Array,
  segmentNo: number,
  isLast: boolean,
  sealed: Buffer,
): Buffer {
  if (sealed.length <= TAG_BYTES || sealed.length > SEGMENT_CIPHER_BYTES_MAX) throw authFailed();
  const body = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const decipher = createDecipheriv(ALG, key, segmentNonce(prefix, segmentNo), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(segmentAad(ctx, segmentNo, isLast));
  decipher.setAuthTag(tag);
  // update() etiket doğrulanmadan düz metin döndürür: final() başarılı olana dek yayılmaz.
  const head = decipher.update(body);
  try {
    const tail = decipher.final();
    if (tail.length === 0) return head;
    const out = Buffer.concat([head, tail]);
    head.fill(0);
    tail.fill(0);
    return out;
  } catch {
    head.fill(0);
    throw authFailed();
  }
}

// ---------- Şifreleme ----------

export interface SegmentEncryptor {
  /** Girdiyi alır; tamamlanan (son OLMAYAN) segmentleri döner. İlk çıktı başlıkla başlar. */
  push(chunk: Uint8Array): Buffer[];
  /** Kalan baytı son segment olarak mühürler. Boş girdi `invalid_input`. */
  finish(): Buffer[];
}

function newEncryptor(
  ctx: ObjectContext,
  variantKey: Uint8Array,
  noncePrefix: Uint8Array,
): SegmentEncryptor {
  assertKey(variantKey, 'Varyant anahtarı');
  if (noncePrefix.length !== NONCE_PREFIX_BYTES) {
    throw new CryptoError('invalid_input', 'nonce_prefix 8 bayt olmalı.');
  }
  // Bağlam doğrulaması (UUID/sürüm biçimi) ilk segmentten önce, hızlı hata için.
  segmentAad(ctx, 0, false);
  const head = header(ctx.keyVersion, noncePrefix);
  let headerSent = false;
  let pending: Buffer = Buffer.alloc(0);
  let segmentNo = 0;
  let total = 0;
  const out = (): Buffer[] => {
    if (headerSent) return [];
    headerSent = true;
    return [head];
  };
  return {
    push(chunk) {
      if (chunk.length === 0) return [];
      total += chunk.length;
      pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
      const result = out();
      // Son segment bir sonraki bayt görülene kadar tutulur: yalnız ÖNDEN fazla baytı mühürle.
      while (pending.length > SEGMENT_PLAIN_BYTES) {
        const plain = pending.subarray(0, SEGMENT_PLAIN_BYTES);
        result.push(sealSegment(variantKey, ctx, noncePrefix, segmentNo, false, plain));
        segmentNo += 1;
        pending = pending.subarray(SEGMENT_PLAIN_BYTES);
      }
      return result;
    },
    finish() {
      if (total === 0) {
        throw new CryptoError('invalid_input', 'Boş girdi şifrelenemez: boş dosya yoktur.');
      }
      const result = out();
      result.push(sealSegment(variantKey, ctx, noncePrefix, segmentNo, true, pending));
      pending = Buffer.alloc(0);
      return result;
    },
  };
}

/** Üretim yolu: nonce_prefix nesne başına CSPRNG ile üretilir. */
export function createSegmentEncryptor(
  ctx: ObjectContext,
  variantKey: Uint8Array,
): SegmentEncryptor {
  return newEncryptor(ctx, variantKey, randomBytes(NONCE_PREFIX_BYTES));
}

/** Yalnız bilinen-cevap testleri içindir; paket kökünden dışa aktarılmaz. */
export function createSegmentEncryptorWithPrefix(
  ctx: ObjectContext,
  variantKey: Uint8Array,
  noncePrefix: Uint8Array,
): SegmentEncryptor {
  return newEncryptor(ctx, variantKey, noncePrefix);
}

export async function* encryptIterable(
  source: AsyncIterable<Uint8Array>,
  ctx: ObjectContext,
  variantKey: Uint8Array,
): AsyncGenerator<Buffer, void, undefined> {
  const enc = createSegmentEncryptor(ctx, variantKey);
  for await (const chunk of source) yield* enc.push(chunk);
  yield* enc.finish();
}

// ---------- Boyut aritmetiği ve aralıklı okuma ----------

export interface ObjectLayout {
  /** Toplam segment sayısı. */
  segments: number;
  /** Son segmentin şifreli uzunluğu (17..65552). */
  lastCipherBytes: number;
  /** Düz metin boyutu. */
  plainBytes: number;
}

/** Şifreli nesne uzunluğundan segment düzeni; geçersiz uzunluk `auth_failed`. */
export function layoutOf(objectLength: number): ObjectLayout {
  if (!Number.isSafeInteger(objectLength) || objectLength <= HEADER_BYTES) throw authFailed();
  const body = objectLength - HEADER_BYTES;
  const segments = Math.ceil(body / SEGMENT_CIPHER_BYTES_MAX);
  const rem = body % SEGMENT_CIPHER_BYTES_MAX;
  const lastCipherBytes = rem === 0 ? SEGMENT_CIPHER_BYTES_MAX : rem;
  if (lastCipherBytes <= TAG_BYTES || segments > SEGMENT_NO_MAX + 1) throw authFailed();
  const plainBytes = (segments - 1) * SEGMENT_PLAIN_BYTES + (lastCipherBytes - TAG_BYTES);
  return { segments, lastCipherBytes, plainBytes };
}

export interface CipherRange {
  /** Nesne ofseti (dahil), `GetObject` `Range: bytes=cipherStart-cipherEnd`. */
  cipherStart: number;
  /** Nesne ofseti (dahil). */
  cipherEnd: number;
  firstSegment: number;
  lastSegment: number;
  /** Çözülmüş ilk segmentin başından atlanacak düz metin baytı. */
  skipInFirst: number;
  /** İstenen düz metin uzunluğu (`plainEnd - plainStart + 1`). */
  plainLength: number;
}

/** Düz metin aralığı (uçlar dahil, `Range` başlığı gibi) için gereken şifreli aralık. */
export function cipherRangeFor(
  objectLength: number,
  plainStart: number,
  plainEnd: number,
): CipherRange {
  const { segments, lastCipherBytes, plainBytes } = layoutOf(objectLength);
  if (
    !Number.isSafeInteger(plainStart) ||
    !Number.isSafeInteger(plainEnd) ||
    plainStart < 0 ||
    plainEnd < plainStart ||
    plainEnd >= plainBytes
  ) {
    throw new CryptoError('invalid_input', 'İstenen aralık nesne boyutunun dışında.');
  }
  const firstSegment = Math.floor(plainStart / SEGMENT_PLAIN_BYTES);
  const lastSegment = Math.floor(plainEnd / SEGMENT_PLAIN_BYTES);
  const cipherStart = HEADER_BYTES + firstSegment * SEGMENT_CIPHER_BYTES_MAX;
  const endSegmentBytes = lastSegment === segments - 1 ? lastCipherBytes : SEGMENT_CIPHER_BYTES_MAX;
  const cipherEnd = HEADER_BYTES + lastSegment * SEGMENT_CIPHER_BYTES_MAX + endSegmentBytes - 1;
  return {
    cipherStart,
    cipherEnd,
    firstSegment,
    lastSegment,
    skipInFirst: plainStart - firstSegment * SEGMENT_PLAIN_BYTES,
    plainLength: plainEnd - plainStart + 1,
  };
}

// ---------- Çözme ----------

export interface DecryptOptions {
  /**
   * Şifreli nesnenin toplam uzunluğu (`HeadObject`). Verilirse segment sınırları ve `is_last` uzunluktan
   * türetilir (ileri bakış gerekmez) ve kesilmiş akış `finish()` içinde reddedilir.
   */
  objectLength?: number;
  /** Aralıklı okuma: akış bu segmentin şifreli baytlarıyla başlar (başlık `header` ile verilir). */
  firstSegment?: number;
  /** Aralıklı okuma: akış bu segmentle biter (dahil); varsayılan son segment. */
  lastSegment?: number;
  /** `firstSegment > 0` iken zorunlu: nesnenin ilk 24 baytı (verilirse akış başlıksız başlar). */
  header?: Uint8Array;
}

export interface SegmentDecryptor {
  /** Girdiyi alır; yalnız etiketi DOĞRULANMIŞ düz metin segmentlerini döner. */
  push(chunk: Uint8Array): Buffer[];
  /** Akış sonu: kalanı çözer; kesilme/fazlalık `auth_failed`. */
  finish(): Buffer[];
}

/** Çözücü. Hata fırlatıldıktan sonra nesne kullanılmaz. */
export function createSegmentDecryptor(
  ctx: ObjectContext,
  variantKey: Uint8Array,
  opts: DecryptOptions = {},
): SegmentDecryptor {
  assertKey(variantKey, 'Varyant anahtarı');
  segmentAad(ctx, 0, false);
  const layout = opts.objectLength === undefined ? null : layoutOf(opts.objectLength);
  const first = opts.firstSegment ?? 0;
  if (!Number.isInteger(first) || first < 0) {
    throw new CryptoError('invalid_input', 'İlk segment numarası geçersiz.');
  }
  if ((first > 0 || opts.lastSegment !== undefined) && layout === null) {
    throw new CryptoError('invalid_input', 'Aralıklı okuma için nesne uzunluğu gerekir.');
  }
  const lastExpected = opts.lastSegment ?? (layout === null ? null : layout.segments - 1);
  if (layout !== null && (first > layout.segments - 1 || (lastExpected ?? 0) < first)) {
    throw new CryptoError('invalid_input', 'Segment aralığı nesne dışında.');
  }
  if (layout !== null && lastExpected !== null && lastExpected > layout.segments - 1) {
    throw new CryptoError('invalid_input', 'Segment aralığı nesne dışında.');
  }

  let prefix: Buffer | null = null;
  let buf: Buffer = Buffer.alloc(0);
  let segmentNo = first;
  let decrypted = 0;

  const adoptHeader = (h: Uint8Array): void => {
    const parsed = parseHeader(h);
    if (parsed.keyVersion !== ctx.keyVersion) throw authFailed();
    prefix = parsed.noncePrefix;
  };
  if (opts.header !== undefined) {
    adoptHeader(opts.header);
  } else if (first > 0) {
    throw new CryptoError('invalid_input', 'Aralıklı okuma için nesne başlığı gerekir.');
  }

  const cipherLenOf = (no: number): number =>
    layout !== null && no === layout.segments - 1
      ? layout.lastCipherBytes
      : SEGMENT_CIPHER_BYTES_MAX;

  const drain = (final: boolean): Buffer[] => {
    const out: Buffer[] = [];
    if (prefix === null) {
      if (buf.length < HEADER_BYTES) return out;
      adoptHeader(buf.subarray(0, HEADER_BYTES));
      buf = buf.subarray(HEADER_BYTES);
    }
    const p = prefix as Buffer | null;
    if (p === null) return out;
    if (layout !== null && lastExpected !== null) {
      // Uzunluk bilinir: her segment tam baytı gelince doğrudan çözülür.
      while (segmentNo <= lastExpected && buf.length >= cipherLenOf(segmentNo)) {
        const len = cipherLenOf(segmentNo);
        const isLast = segmentNo === layout.segments - 1;
        out.push(openSegment(variantKey, ctx, p, segmentNo, isLast, buf.subarray(0, len)));
        buf = buf.subarray(len);
        segmentNo += 1;
        decrypted += 1;
      }
      if (segmentNo > lastExpected && buf.length > 0) throw authFailed();
      return out;
    }
    // Uzunluk bilinmez: bir segment ileri bakış (son segment akış sonunda anlaşılır).
    while (buf.length > SEGMENT_CIPHER_BYTES_MAX) {
      out.push(
        openSegment(
          variantKey,
          ctx,
          p,
          segmentNo,
          false,
          buf.subarray(0, SEGMENT_CIPHER_BYTES_MAX),
        ),
      );
      buf = buf.subarray(SEGMENT_CIPHER_BYTES_MAX);
      segmentNo += 1;
      decrypted += 1;
    }
    if (final) {
      if (buf.length === 0) throw authFailed();
      out.push(openSegment(variantKey, ctx, p, segmentNo, true, buf));
      buf = Buffer.alloc(0);
      segmentNo += 1;
      decrypted += 1;
    }
    return out;
  };

  return {
    push(chunk) {
      if (chunk.length === 0) return [];
      buf = buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([buf, chunk]);
      return drain(false);
    },
    finish() {
      if (prefix === null && buf.length < HEADER_BYTES) throw authFailed();
      const out = drain(true);
      if (layout !== null && lastExpected !== null) {
        if (decrypted !== lastExpected - first + 1 || buf.length !== 0) throw authFailed();
      } else if (decrypted === 0) {
        throw authFailed();
      }
      return out;
    },
  };
}

export async function* decryptIterable(
  source: AsyncIterable<Uint8Array>,
  ctx: ObjectContext,
  variantKey: Uint8Array,
  opts: DecryptOptions = {},
): AsyncGenerator<Buffer, void, undefined> {
  const dec = createSegmentDecryptor(ctx, variantKey, opts);
  for await (const chunk of source) yield* dec.push(chunk);
  yield* dec.finish();
}
