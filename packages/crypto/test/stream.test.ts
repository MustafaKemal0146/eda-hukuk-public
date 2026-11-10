// @tk TK-06
// KK-P20-1 (KK-033-4/5/6): EDAE v1 segmentli AEAD akışı: bilinen-cevap vektörleri, bozma matrisi,
// kesilme/yeniden sıralama tespiti, bağlam ve varyant bağı, aralıklı okuma ve fuzz.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  cipherRangeFor,
  createSegmentDecryptor,
  createSegmentEncryptor,
  decryptIterable,
  deriveVariantKey,
  encryptIterable,
  HEADER_BYTES,
  layoutOf,
  type ObjectContext,
  parseHeader,
  SEGMENT_CIPHER_BYTES_MAX,
  SEGMENT_PLAIN_BYTES,
} from '../src/index.ts';
import { createSegmentEncryptorWithPrefix } from '../src/stream.ts';
import { flipByte, hex, seq } from './load-vectors.ts';

type EdaeVectors = {
  fileKey: string;
  orgId: string;
  fileId: string;
  keyVersion: number;
  noncePrefix: string;
  vectors: {
    variant: 'orig' | 'searchable';
    plainBytes: number;
    objectBytes: number;
    header: string;
    firstSegmentTail: string;
    objectSha256: string;
    plainSha256: string;
  }[];
};
const doc = JSON.parse(
  readFileSync(new URL('./vectors/edae-v1.json', import.meta.url), 'utf8'),
) as EdaeVectors;

const ctx: ObjectContext = { orgId: doc.orgId, fileId: doc.fileId, keyVersion: doc.keyVersion };
const fileKey = hex(doc.fileKey);
const origKey = deriveVariantKey(fileKey, 'orig');
const plainOf = (n: number): Buffer =>
  Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff));
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

function encryptAll(plain: Buffer, key = origKey, c = ctx): Buffer {
  const enc = createSegmentEncryptor(c, key);
  return Buffer.concat([...enc.push(plain), ...enc.finish()]);
}

/** Çözer; hata fırlatılana dek yayılan düz metni de döner. */
function decryptCollect(
  object: Buffer,
  opts: Parameters<typeof createSegmentDecryptor>[2] = {},
  key = origKey,
  c = ctx,
  chunk = 4096,
): { plain: Buffer; error: unknown } {
  const dec = createSegmentDecryptor(c, key, opts);
  const parts: Buffer[] = [];
  try {
    for (let i = 0; i < object.length; i += chunk) {
      parts.push(...dec.push(object.subarray(i, i + chunk)));
    }
    parts.push(...dec.finish());
    return { plain: Buffer.concat(parts), error: null };
  } catch (error) {
    return { plain: Buffer.concat(parts), error };
  }
}

function expectAuthFailed(error: unknown): void {
  expect(error).toBeInstanceOf(CryptoError);
  expect((error as CryptoError).code).toBe('auth_failed');
}

describe('KK-P20-1 (KK-033-4): bilinen-cevap vektörleri', () => {
  for (const v of doc.vectors) {
    it(`${v.variant} ${v.plainBytes} bayt: şifreli bayt dizisi birebir ve çözüm özdeş`, () => {
      const key = deriveVariantKey(fileKey, v.variant);
      const enc = createSegmentEncryptorWithPrefix(ctx, key, hex(doc.noncePrefix));
      const obj = Buffer.concat([...enc.push(plainOf(v.plainBytes)), ...enc.finish()]);
      expect(obj.length).toBe(v.objectBytes);
      expect(obj.subarray(0, 24).toString('hex')).toBe(v.header);
      expect(obj.subarray(24, 56).toString('hex')).toBe(v.firstSegmentTail);
      expect(sha(obj)).toBe(v.objectSha256);
      const dec = decryptCollect(obj, {}, key);
      expect(dec.error).toBeNull();
      expect(sha(dec.plain)).toBe(v.plainSha256);
      const known = decryptCollect(obj, { objectLength: obj.length }, key);
      expect(known.error).toBeNull();
      expect(known.plain.equals(dec.plain)).toBe(true);
    });
  }

  it('başlık 24 bayttır; magic, sürüm, alg, seg_log2, anahtar sürümü ve ayrılmış alan', () => {
    const obj = encryptAll(plainOf(10));
    expect(obj.subarray(0, 4).toString('ascii')).toBe('EDAE');
    expect([...obj.subarray(4, 8)]).toEqual([1, 1, 16, 0]);
    expect(obj.readUInt32BE(8)).toBe(ctx.keyVersion);
    expect(obj.readUInt32BE(20)).toBe(0);
    expect(obj.length).toBe(HEADER_BYTES + 10 + 16);
  });

  it('nonce_prefix her nesnede farklıdır (CSPRNG)', () => {
    const a = encryptAll(plainOf(5)).subarray(12, 20).toString('hex');
    const b = encryptAll(plainOf(5)).subarray(12, 20).toString('hex');
    expect(a).not.toBe(b);
  });
});

describe('KK-P20-1: akış, parça sınırları ve boş girdi', () => {
  it('boş girdi şifrelenemez (boş dosya yoktur)', () => {
    const enc = createSegmentEncryptor(ctx, origKey);
    expect(enc.push(Buffer.alloc(0))).toEqual([]);
    expect(() => enc.finish()).toThrow(CryptoError);
  });

  it('rastgele parçalamayla şifrele/çöz iki yönde de özdeştir', async () => {
    for (const n of [1, 17, 65535, 65536, 65537, 131072, 200_001]) {
      const plain = plainOf(n);
      const pieces: Buffer[] = [];
      for (let i = 0; i < n; ) {
        const len = 1 + (randomBytes(2).readUInt16BE(0) % 30_000);
        pieces.push(plain.subarray(i, i + len));
        i += len;
      }
      async function* src(): AsyncGenerator<Buffer> {
        for (const p of pieces) yield p;
      }
      const sealed: Buffer[] = [];
      for await (const c of encryptIterable(src(), ctx, origKey)) sealed.push(c);
      const obj = Buffer.concat(sealed);
      expect(obj.length).toBe(HEADER_BYTES + n + 16 * Math.ceil(n / SEGMENT_PLAIN_BYTES));
      const out: Buffer[] = [];
      async function* wire(): AsyncGenerator<Buffer> {
        for (let i = 0; i < obj.length; i += 7001) yield obj.subarray(i, i + 7001);
      }
      for await (const p of decryptIterable(wire(), ctx, origKey)) out.push(p);
      expect(Buffer.concat(out).equals(plain)).toBe(true);
    }
  });

  it('64 KiB tam katı boyutta son segment de is_last taşır (kesilme yakalanır)', () => {
    const obj = encryptAll(plainOf(SEGMENT_PLAIN_BYTES * 2));
    expect(obj.length).toBe(HEADER_BYTES + 2 * SEGMENT_CIPHER_BYTES_MAX);
    const cut = obj.subarray(0, HEADER_BYTES + SEGMENT_CIPHER_BYTES_MAX);
    expectAuthFailed(decryptCollect(cut).error);
  });
});

describe('KK-P20-1 (KK-033-5): bozma matrisi, çıktıya doğrulanmamış bayt yazılmaz', () => {
  const plain = plainOf(SEGMENT_PLAIN_BYTES * 2 + 100);
  const obj = encryptAll(plain);
  const seg1Start = HEADER_BYTES + SEGMENT_CIPHER_BYTES_MAX;

  const positions: [string, number][] = [
    ['magic', 0],
    ['format_version', 4],
    ['alg', 5],
    ['seg_log2', 6],
    ['flags', 7],
    ['key_version', 8],
    ['nonce_prefix', 13],
    ['reserved', 21],
    ['segment 0 şifreli metin', HEADER_BYTES + 3],
    ['segment 0 etiketi', HEADER_BYTES + SEGMENT_CIPHER_BYTES_MAX - 1],
    ['segment 1 şifreli metin', seg1Start + 5],
    ['son segment etiketi', obj.length - 1],
  ];
  for (const [name, index] of positions) {
    for (const mode of ['uzunluksuz', 'uzunluklu'] as const) {
      it(`${name} (${mode}) bozulursa çözme hata verir`, () => {
        const bad = flipByte(obj, index);
        const r = decryptCollect(bad, mode === 'uzunluklu' ? { objectLength: bad.length } : {});
        expectAuthFailed(r.error);
        // Bozulan segmentten önceki doğrulanmış segmentler dışında hiçbir bayt yayılmamış olmalı.
        const segmentOf =
          index < HEADER_BYTES ? 0 : Math.floor((index - HEADER_BYTES) / SEGMENT_CIPHER_BYTES_MAX);
        const intact = index < HEADER_BYTES ? 0 : segmentOf * SEGMENT_PLAIN_BYTES;
        expect(r.plain.length).toBeLessThanOrEqual(intact);
        expect(r.plain.equals(plain.subarray(0, r.plain.length))).toBe(true);
      });
    }
  }

  it('iki segment yer değiştirirse hata (segment_no AAD)', () => {
    const s0 = obj.subarray(HEADER_BYTES, seg1Start);
    const s1 = obj.subarray(seg1Start, seg1Start + SEGMENT_CIPHER_BYTES_MAX);
    const swapped = Buffer.concat([
      obj.subarray(0, HEADER_BYTES),
      s1,
      s0,
      obj.subarray(seg1Start + SEGMENT_CIPHER_BYTES_MAX),
    ]);
    const r = decryptCollect(swapped);
    expectAuthFailed(r.error);
    expect(r.plain.length).toBe(0);
  });

  it('son segment atılırsa hata (uzunluksuz: is_last, uzunluklu: eksik segment)', () => {
    const cut = obj.subarray(0, obj.length - (100 + 16));
    expectAuthFailed(decryptCollect(cut).error);
    expectAuthFailed(decryptCollect(cut, { objectLength: obj.length }).error);
  });

  it('akış yarım segmentte biterse hata', () => {
    expectAuthFailed(decryptCollect(obj.subarray(0, obj.length - 3)).error);
    expectAuthFailed(decryptCollect(obj.subarray(0, HEADER_BYTES - 1)).error);
    expectAuthFailed(decryptCollect(obj.subarray(0, HEADER_BYTES)).error);
  });

  it('sona segment eklenirse hata (sayaç/is_last uyuşmazlığı)', () => {
    const extra = Buffer.concat([obj, obj.subarray(HEADER_BYTES, HEADER_BYTES + 5000)]);
    expectAuthFailed(decryptCollect(extra).error);
    const dup = Buffer.concat([obj, obj.subarray(seg1Start, seg1Start + SEGMENT_CIPHER_BYTES_MAX)]);
    expectAuthFailed(decryptCollect(dup).error);
    expectAuthFailed(decryptCollect(extra, { objectLength: obj.length }).error);
  });

  it('boş girdi akışı ve yalnız başlık hata verir', () => {
    expectAuthFailed(decryptCollect(Buffer.alloc(0)).error);
  });
});

describe('KK-P20-1 (KK-033-6): bağlam ve varyant bağı', () => {
  const obj = encryptAll(plainOf(70_000));

  it('farklı org, file veya key_version ile çözme hata verir', () => {
    expectAuthFailed(
      decryptCollect(obj, {}, origKey, { ...ctx, orgId: '00000000-0000-7000-8000-00000000000b' })
        .error,
    );
    expectAuthFailed(
      decryptCollect(obj, {}, origKey, { ...ctx, fileId: '00000000-0000-7000-8000-0000000000f2' })
        .error,
    );
    expectAuthFailed(decryptCollect(obj, {}, origKey, { ...ctx, keyVersion: 2 }).error);
  });

  it('.searchable baytları özgün anahtara kopyalanırsa hata (varyant anahtarı)', () => {
    const searchableKey = deriveVariantKey(fileKey, 'searchable');
    const sealedAsSearchable = encryptAll(plainOf(70_000), searchableKey);
    expectAuthFailed(decryptCollect(sealedAsSearchable, {}, origKey).error);
    expect(decryptCollect(sealedAsSearchable, {}, searchableKey).error).toBeNull();
  });

  it('yanlış anahtar uzunluğu girdi hatasıdır', () => {
    expect(() => createSegmentEncryptor(ctx, seq(0, 16))).toThrow(CryptoError);
    expect(() => createSegmentDecryptor(ctx, seq(0, 31))).toThrow(CryptoError);
  });
});

describe('KK-P20-1: aralıklı okuma', () => {
  const plain = plainOf(SEGMENT_PLAIN_BYTES * 3 + 4321);
  const obj = encryptAll(plain);

  it('layoutOf boyut aritmetiği ve geçersiz uzunluklar', () => {
    const l = layoutOf(obj.length);
    expect(l.segments).toBe(4);
    expect(l.plainBytes).toBe(plain.length);
    expect(() => layoutOf(HEADER_BYTES)).toThrow(CryptoError);
    expect(() => layoutOf(HEADER_BYTES + 16)).toThrow(CryptoError);
    expect(() => layoutOf(Number.NaN)).toThrow(CryptoError);
  });

  it('1000 rastgele aralık tam çözümle aynı baytları verir', () => {
    for (let i = 0; i < 1000; i++) {
      const start = randomBytes(4).readUInt32BE(0) % plain.length;
      const end = Math.min(
        plain.length - 1,
        start + (randomBytes(4).readUInt32BE(0) % (SEGMENT_PLAIN_BYTES * 2)),
      );
      const r = cipherRangeFor(obj.length, start, end);
      expect(r.plainLength).toBe(end - start + 1);
      const wire = obj.subarray(r.cipherStart, r.cipherEnd + 1);
      const out = decryptCollect(
        wire,
        {
          objectLength: obj.length,
          firstSegment: r.firstSegment,
          lastSegment: r.lastSegment,
          header: obj.subarray(0, HEADER_BYTES),
        },
        origKey,
        ctx,
        9000,
      );
      expect(out.error).toBeNull();
      expect(
        out.plain
          .subarray(r.skipInFirst, r.skipInFirst + r.plainLength)
          .equals(plain.subarray(start, end + 1)),
      ).toBe(true);
    }
  });

  it('aralık nesne dışındaysa girdi hatası; başlıksız ara segment okunamaz', () => {
    expect(() => cipherRangeFor(obj.length, 0, plain.length)).toThrow(CryptoError);
    expect(() => cipherRangeFor(obj.length, 5, 4)).toThrow(CryptoError);
    expect(() =>
      createSegmentDecryptor(ctx, origKey, { objectLength: obj.length, firstSegment: 1 }),
    ).toThrow(CryptoError);
    expect(() =>
      createSegmentDecryptor(ctx, origKey, { firstSegment: 1, header: obj.subarray(0, 24) }),
    ).toThrow(CryptoError);
  });

  it('aralıklı okumada kesilen aralık hata verir', () => {
    const r = cipherRangeFor(obj.length, 70_000, 140_000);
    const wire = obj.subarray(r.cipherStart, r.cipherEnd + 1 - 10);
    const out = decryptCollect(wire, {
      objectLength: obj.length,
      firstSegment: r.firstSegment,
      lastSegment: r.lastSegment,
      header: obj.subarray(0, HEADER_BYTES),
    });
    expectAuthFailed(out.error);
  });
});

describe('KK-P20-1: başlık katı doğrulama ve fuzz', () => {
  it('parseHeader geçerli başlıkta sürüm ve nonce_prefix döner', () => {
    const h = encryptAll(plainOf(3)).subarray(0, HEADER_BYTES);
    const p = parseHeader(h);
    expect(p.keyVersion).toBe(ctx.keyVersion);
    expect(p.noncePrefix.length).toBe(8);
  });

  it('rastgele bozuk başlıklar çökme olmadan auth_failed verir', () => {
    const obj = encryptAll(plainOf(300));
    for (let i = 0; i < 300; i++) {
      const bad = Buffer.from(obj);
      const rnd = randomBytes(HEADER_BYTES);
      rnd.copy(bad, 0, 0, HEADER_BYTES);
      const r = decryptCollect(bad, {}, origKey, ctx, 1 + (i % 50));
      expectAuthFailed(r.error);
      expect(r.plain.length).toBe(0);
    }
  });

  it('rastgele gövde (geçerli başlık) auth_failed verir', () => {
    const head = encryptAll(plainOf(3)).subarray(0, HEADER_BYTES);
    for (let i = 0; i < 50; i++) {
      const junk = Buffer.concat([head, randomBytes(17 + ((i * 977) % 140_000))]);
      expectAuthFailed(decryptCollect(junk).error);
    }
  });
});
