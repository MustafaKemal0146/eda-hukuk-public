// @tk TK-06
import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  labelBytes,
  lengthPrefixed,
  uint32Bytes,
  uuidBytes,
  versionBytes,
} from '../src/index.ts';

function expectInvalid(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(CryptoError);
  expect((caught as CryptoError).code).toBe('invalid_input');
}

describe('KK-P03c-15: AAD kodlaması', () => {
  it('UUID ham 16 bayt; büyük/küçük harf aynı baytı verir', () => {
    const b = uuidBytes('00112233-4455-6677-8899-aabbccddeeff');
    expect(b.toString('hex')).toBe('00112233445566778899aabbccddeeff');
    expect(uuidBytes('00112233-4455-6677-8899-AABBCCDDEEFF').equals(b)).toBe(true);
    for (const bad of [
      '',
      '00112233445566778899aabbccddeeff',
      '0011223-4455-6677-8899-aabbccddeeff0',
      '{00112233-4455-6677-8899-aabbccddeeff}',
      '00112233-4455-6677-8899-aabbccddeefg',
    ]) {
      expectInvalid(() => uuidBytes(bad));
    }
  });

  it('tamsayılar uint32 big-endian; sürüm 1 ile 2^32-1 arasında', () => {
    expect(uint32Bytes(0).toString('hex')).toBe('00000000');
    expect(uint32Bytes(0x01020304).toString('hex')).toBe('01020304');
    expect(versionBytes(1).toString('hex')).toBe('00000001');
    expect(versionBytes(0xffffffff).toString('hex')).toBe('ffffffff');
    for (const bad of [0, -1, 1.5, 2 ** 32, Number.NaN]) expectInvalid(() => versionBytes(bad));
    expectInvalid(() => uint32Bytes(-1));
  });

  it('değişken uzunluklu parça uint16 BE bayt uzunluğu önekli UTF-8', () => {
    expect(lengthPrefixed('clients').toString('hex')).toBe('0007636c69656e7473');
    expect(lengthPrefixed('').toString('hex')).toBe('0000');
    expect(lengthPrefixed('ş').toString('hex')).toBe('0002c59f');
    expect(lengthPrefixed('a'.repeat(0xffff)).length).toBe(2 + 0xffff);
    expectInvalid(() => lengthPrefixed('a'.repeat(0x10000)));
  });

  it('etiket ASCII ‖ 0x00', () => {
    expect(labelBytes('eda/v1/dek').toString('hex')).toBe(
      `${Buffer.from('eda/v1/dek', 'ascii').toString('hex')}00`,
    );
    expectInvalid(() => labelBytes(''));
    expectInvalid(() => labelBytes('eda v1'));
  });
});
