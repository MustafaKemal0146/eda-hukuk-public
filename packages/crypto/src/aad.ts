// AAD (ek doğrulanmış veri) kodlama yardımcıları (033 §4.2, §4.4; 030 §1.7).
// Kurallar:
// - UUID ham 16 bayt (tirelerden arındırılmış onaltılık gösterimin baytları).
// - Tamsayılar (sürümler) uint32 big-endian, 4 bayt (033 §4.2 başlığındaki `key_version` ile aynı).
// - Değişken uzunluklu parçalar (tablo, kolon adı) UTF-8 baytlarının önüne uint16 big-endian
//   bayt uzunluğu yazılarak kodlanır; böylece bitişik parçalar arasında belirsizlik kalmaz.
// - Sabit alan etiketleri (ör. "eda/v1/dek") öneksiz ASCII yazılır, ardından 0x00 ayırıcı gelir.
import { CryptoError } from './errors.ts';

export const UINT16_MAX = 0xffff;
export const UINT32_MAX = 0xffff_ffff;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const LABEL_RE = /^[\x21-\x7e]+$/;

/** UUID metnini ham 16 bayta çevirir. */
export function uuidBytes(uuid: string): Buffer {
  if (!UUID_RE.test(uuid)) {
    throw new CryptoError(
      'invalid_input',
      'Kimlik UUID biçiminde olmalı (8-4-4-4-12 onaltılık karakter).',
    );
  }
  return Buffer.from(uuid.replaceAll('-', ''), 'hex');
}

/** 0 ile 2^32-1 arasındaki tamsayıyı uint32 big-endian 4 bayta çevirir. */
export function uint32Bytes(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new CryptoError('invalid_input', 'Tamsayı alanı 0 ile 4294967295 arasında olmalı.');
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value, 0);
  return out;
}

/** Anahtar sürümünü (1'den başlar) uint32 big-endian 4 bayta çevirir. */
export function versionBytes(version: number): Buffer {
  if (!Number.isInteger(version) || version < 1 || version > UINT32_MAX) {
    throw new CryptoError(
      'invalid_input',
      'Anahtar sürümü 1 ile 4294967295 arasında tamsayı olmalı.',
    );
  }
  return uint32Bytes(version);
}

/** Metni `uint16_BE(bayt_uzunluğu) ‖ UTF-8 baytlar` biçiminde kodlar. */
export function lengthPrefixed(value: string): Buffer {
  const body = Buffer.from(value, 'utf8');
  if (body.length > UINT16_MAX) {
    throw new CryptoError('invalid_input', 'AAD metin parçası 65535 baytı aşamaz.');
  }
  const out = Buffer.alloc(2 + body.length);
  out.writeUInt16BE(body.length, 0);
  body.copy(out, 2);
  return out;
}

/** Sabit alan etiketini `ASCII ‖ 0x00` biçiminde kodlar (ör. "eda/v1/dek" ‖ 0x00). */
export function labelBytes(label: string): Buffer {
  if (!LABEL_RE.test(label)) {
    throw new CryptoError('invalid_input', 'AAD etiketi boşluksuz yazdırılabilir ASCII olmalı.');
  }
  return Buffer.concat([Buffer.from(label, 'ascii'), Buffer.of(0x00)]);
}

/** AAD parçalarını sırasıyla birleştirir. */
export function concatAad(parts: readonly Uint8Array[]): Buffer {
  return Buffer.concat(parts);
}
