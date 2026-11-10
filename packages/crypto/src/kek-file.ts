// `kek_master` sır dosyası içeriğinin ayrıştırıcısı (033 §4.1). Dosyayı okumaz; içerik metnini alır.
// Biçim: ilk satır `v<sürüm>:<base64>`; sürüm 1'den başlayan tamsayı, base64 tam 32 bayt.
// Sonraki satırlar yok sayılır. Hata mesajları anahtar malzemesi içermez.
import { UINT32_MAX } from './aad.ts';
import { CryptoError } from './errors.ts';
import { KEY_BYTES } from './gcm.ts';

export type KekMaterial = { kekVersion: number; kek: Buffer };

const LINE_RE = /^v([^:]*):(.*)$/;
const VERSION_RE = /^[1-9][0-9]*$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function fail(message: string): never {
  throw new CryptoError('kek_file_invalid', message);
}

export function parseKekFile(content: string): KekMaterial {
  const newline = content.indexOf('\n');
  let line = newline === -1 ? content : content.slice(0, newline);
  if (line.endsWith('\r')) line = line.slice(0, -1);
  if (line.length === 0) {
    fail('KEK dosyası boş; ilk satır v<sürüm>:<base64> biçiminde olmalı.');
  }
  const m = LINE_RE.exec(line);
  if (m === null) {
    fail('KEK dosyasının ilk satırı v<sürüm>:<base64> biçiminde olmalı.');
  }
  const versionText = m[1] ?? '';
  const keyText = m[2] ?? '';
  if (!VERSION_RE.test(versionText) || Number(versionText) > UINT32_MAX) {
    fail('KEK sürümü 1 ile 4294967295 arasında, başında sıfır olmayan bir tamsayı olmalı.');
  }
  if (keyText.length === 0 || keyText.length % 4 !== 0 || !BASE64_RE.test(keyText)) {
    fail('KEK anahtarı standart (dolgulu) base64 olmalı.');
  }
  const kek = Buffer.from(keyText, 'base64');
  if (kek.length !== KEY_BYTES || kek.toString('base64') !== keyText) {
    kek.fill(0);
    fail('KEK anahtarı base64 çözüldüğünde tam 32 bayt olmalı.');
  }
  return { kekVersion: Number(versionText), kek };
}
