// Deterministik test kimlikleri (032 §12): fid(worldKey, name) = uuidv5(worldKey, name). Her test
// dosyası rastgele worldKey alır; dosyalar arası çakışma olmaz, temizlik gerekmez.
import { createHash, randomUUID } from 'node:crypto';

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll('-', ''), 'hex');
}

function format(bytes: Buffer): string {
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** RFC 9562 UUID sürüm 5 (SHA-1, ad alanı + ad). */
export function uuidv5(namespace: string, name: string): string {
  const hash = createHash('sha1')
    .update(uuidBytes(namespace))
    .update(Buffer.from(name, 'utf8'))
    .digest()
    .subarray(0, 16);
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  return format(hash);
}

export function newWorldKey(): string {
  return randomUUID();
}

export function fid(worldKey: string, name: string): string {
  return uuidv5(worldKey, name);
}

/** Kısa, şema/e-posta için güvenli rastgele son ek. */
export function shortKey(worldKey: string): string {
  return worldKey.replaceAll('-', '').slice(0, 10);
}
