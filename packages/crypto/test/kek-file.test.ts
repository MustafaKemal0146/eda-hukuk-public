// @tk TK-06
import { describe, expect, it } from 'vitest';
import { CryptoError, parseKekFile } from '../src/index.ts';
import { seq } from './load-vectors.ts';

// Sentetik KEK: ardışık bayt deseni (gerçek sır değildir).
const KEY = seq(0x00, 32);
const B64 = KEY.toString('base64');

function expectInvalid(content: string): CryptoError {
  let caught: unknown;
  try {
    parseKekFile(content);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(CryptoError);
  const err = caught as CryptoError;
  expect(err.code).toBe('kek_file_invalid');
  return err;
}

describe('KK-P03c-15: kek_master dosya ayrıştırıcısı', () => {
  it('geçerli ilk satırı ayrıştırır; sonraki satırlar ve satır sonu yok sayılır', () => {
    for (const content of [`v1:${B64}`, `v1:${B64}\n`, `v1:${B64}\r\n`, `v1:${B64}\nyorum\n`]) {
      const r = parseKekFile(content);
      expect(r.kekVersion).toBe(1);
      expect(r.kek.equals(KEY)).toBe(true);
    }
    expect(parseKekFile(`v42:${B64}`).kekVersion).toBe(42);
    expect(parseKekFile(`v4294967295:${B64}`).kekVersion).toBe(4294967295);
  });

  it('bozuk biçimi reddeder', () => {
    const short = seq(0, 31).toString('base64');
    const long = seq(0, 33).toString('base64');
    const cases = [
      '',
      '\n',
      `\nv1:${B64}`,
      B64,
      `V1:${B64}`,
      `x1:${B64}`,
      ` v1:${B64}`,
      `v1:${B64} `,
      `v:${B64}`,
      `v0:${B64}`,
      `v01:${B64}`,
      `v-1:${B64}`,
      `v1.5:${B64}`,
      `va:${B64}`,
      `v4294967296:${B64}`,
      'v1:',
      `v1${B64}`,
      `v1:${short}`,
      `v1:${long}`,
      `v1:${B64.slice(0, -1)}`,
      `v1:${B64.replace('=', '')}`,
      `v1:${KEY.toString('base64url')}`,
      `v1:${KEY.toString('hex')}`,
      `v1:${B64.slice(0, 20)}*${B64.slice(21)}`,
    ];
    for (const c of cases) expectInvalid(c);
  });

  it('hata mesajı anahtar malzemesini içermez', () => {
    for (const c of [
      `v0:${B64}`,
      `v1:${B64.slice(0, -2)}`,
      `v1:${seq(0, 31).toString('base64')}`,
    ]) {
      const err = expectInvalid(c);
      expect(err.message).not.toContain(B64.slice(0, 16));
      expect(err.message).not.toContain(KEY.toString('hex').slice(0, 16));
    }
  });
});
