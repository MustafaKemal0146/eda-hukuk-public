// @tk TK-06
import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  type DekContext,
  dekAad,
  deriveVariantKey,
  fileKeyAad,
  generateFileKey,
  type ObjectContext,
  unwrapDek,
  unwrapFileKey,
  VARIANTS,
  type Variant,
  WRAPPED_KEY_BYTES,
  wrapDek,
  wrapFileKey,
} from '../src/index.ts';
import { wrapDekWithNonce, wrapFileKeyWithNonce } from '../src/keys.ts';
import { flipByte, hex, keyVectors, seq } from './load-vectors.ts';

const ORG_A = '00000000-0000-7000-8000-00000000000a';
const ORG_B = '00000000-0000-7000-8000-00000000000b';
const FILE_A = '00000000-0000-7000-8000-0000000000f1';
const FILE_B = '00000000-0000-7000-8000-0000000000f2';

const kek = seq(0x00, 32);
const dek = seq(0x20, 32);
const fileKey = seq(0x40, 32);

function expectCode(fn: () => unknown, code: CryptoError['code']): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(CryptoError);
  expect((caught as CryptoError).code).toBe(code);
}

describe('KK-P03c-15: bilinen-cevap vektörleri (anahtar katmanı)', () => {
  it('varyant anahtarları vektörle aynı', () => {
    expect(keyVectors.variants.map((v) => v.variant)).toEqual([...VARIANTS]);
    for (const v of keyVectors.variants) {
      expect(deriveVariantKey(hex(v.fileKey), v.variant as Variant).toString('hex')).toBe(v.key);
    }
  });

  it('wrapDek: AAD ve sarılı çıktı vektörle aynı; unwrapDek DEK döndürür', () => {
    for (const v of keyVectors.wrapDek) {
      const p: DekContext = { orgId: v.orgId, dekVersion: v.dekVersion, kekVersion: v.kekVersion };
      expect(dekAad(p).toString('hex')).toBe(v.aad);
      expect(wrapDekWithNonce(hex(v.kek), p, hex(v.dek), hex(v.nonce)).toString('hex')).toBe(
        v.wrapped,
      );
      expect(unwrapDek(hex(v.kek), p, hex(v.wrapped)).toString('hex')).toBe(v.dek);
    }
  });

  it('wrapFileKey: AAD ve sarılı çıktı vektörle aynı; unwrapFileKey dosya anahtarını döndürür', () => {
    for (const v of keyVectors.wrapFileKey) {
      const ctx: ObjectContext = { orgId: v.orgId, fileId: v.fileId, keyVersion: v.keyVersion };
      expect(fileKeyAad(ctx).toString('hex')).toBe(v.aad);
      expect(
        wrapFileKeyWithNonce(hex(v.dek), ctx, hex(v.fileKey), hex(v.nonce)).toString('hex'),
      ).toBe(v.wrapped);
      expect(unwrapFileKey(hex(v.dek), ctx, hex(v.wrapped)).toString('hex')).toBe(v.fileKey);
    }
  });
});

describe('KK-P03c-15: dosya anahtarı ve varyantlar', () => {
  it('generateFileKey 32 bayt ve her çağrıda farklı', () => {
    const a = generateFileKey();
    const b = generateFileKey();
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(false);
  });

  it('farklı varyantlar farklı anahtar üretir; varyant anahtarı dosya anahtarından farklı', () => {
    const keys = VARIANTS.map((v) => deriveVariantKey(fileKey, v).toString('hex'));
    expect(new Set(keys).size).toBe(VARIANTS.length);
    expect(keys).not.toContain(fileKey.toString('hex'));
    for (const k of keys) expect(k.length).toBe(64);
  });

  it('bilinmeyen varyant ve yanlış uzunlukta dosya anahtarı reddedilir', () => {
    expectCode(() => deriveVariantKey(fileKey, 'thumb' as Variant), 'invalid_input');
    expectCode(() => deriveVariantKey(seq(0, 31), 'orig'), 'invalid_input');
  });
});

describe('KK-P03c-15: DEK sarma (KEK ile)', () => {
  const p: DekContext = { orgId: ORG_A, dekVersion: 1, kekVersion: 1 };

  it('wrapDek çıktısı 60 bayt; gidiş-dönüş; üretim nonce’u rastgele', () => {
    const w1 = wrapDek(kek, p, dek);
    const w2 = wrapDek(kek, p, dek);
    expect(WRAPPED_KEY_BYTES).toBe(60);
    expect(w1.length).toBe(60);
    expect(w2.length).toBe(60);
    expect(w1.subarray(0, 12).equals(w2.subarray(0, 12))).toBe(false);
    expect(unwrapDek(kek, p, w1).equals(dek)).toBe(true);
    expect(unwrapDek(kek, p, w2).equals(dek)).toBe(true);
  });

  it('AAD bileşeni (org, dek_version, kek_version) değişince unwrapDek hata verir', () => {
    const w = wrapDek(kek, p, dek);
    expectCode(() => unwrapDek(kek, { ...p, orgId: ORG_B }, w), 'auth_failed');
    expectCode(() => unwrapDek(kek, { ...p, dekVersion: 2 }, w), 'auth_failed');
    expectCode(() => unwrapDek(kek, { ...p, kekVersion: 2 }, w), 'auth_failed');
  });

  it('bozuk nonce, şifreli bayt, etiket, uzunluk veya yanlış KEK hata verir', () => {
    const w = wrapDek(kek, p, dek);
    for (const i of [0, 11, 12, 43, 44, 59]) {
      expectCode(() => unwrapDek(kek, p, flipByte(w, i)), 'auth_failed');
    }
    expectCode(() => unwrapDek(kek, p, w.subarray(0, 59)), 'auth_failed');
    expectCode(() => unwrapDek(kek, p, Buffer.concat([w, Buffer.of(0)])), 'auth_failed');
    expectCode(() => unwrapDek(seq(0x01, 32), p, w), 'auth_failed');
  });

  it('geçersiz bağlam ve anahtar uzunluğu invalid_input verir', () => {
    expectCode(() => wrapDek(kek, { ...p, dekVersion: 0 }, dek), 'invalid_input');
    expectCode(() => wrapDek(kek, { ...p, kekVersion: 1.5 }, dek), 'invalid_input');
    expectCode(() => wrapDek(kek, { ...p, orgId: 'kimlik-degil' }, dek), 'invalid_input');
    expectCode(() => wrapDek(seq(0, 16), p, dek), 'invalid_input');
    expectCode(() => wrapDek(kek, p, seq(0, 33)), 'invalid_input');
    expectCode(() => wrapDekWithNonce(kek, p, dek, seq(0, 8)), 'invalid_input');
  });
});

describe('KK-P03c-15: dosya anahtarı sarma (DEK ile)', () => {
  const ctx: ObjectContext = { orgId: ORG_A, fileId: FILE_A, keyVersion: 1 };

  it('wrapFileKey çıktısı 60 bayt ve gidiş-dönüş', () => {
    const w = wrapFileKey(dek, ctx, fileKey);
    expect(w.length).toBe(60);
    expect(unwrapFileKey(dek, ctx, w).equals(fileKey)).toBe(true);
  });

  it('AAD bileşeni (org, file, key_version) değişince unwrapFileKey hata verir', () => {
    const w = wrapFileKey(dek, ctx, fileKey);
    expectCode(() => unwrapFileKey(dek, { ...ctx, orgId: ORG_B }, w), 'auth_failed');
    expectCode(() => unwrapFileKey(dek, { ...ctx, fileId: FILE_B }, w), 'auth_failed');
    expectCode(() => unwrapFileKey(dek, { ...ctx, keyVersion: 2 }, w), 'auth_failed');
  });

  it('bozuk bayt/etiket ve yanlış DEK hata verir; sarılı DEK dosya anahtarı olarak açılmaz', () => {
    const w = wrapFileKey(dek, ctx, fileKey);
    for (const i of [0, 12, 30, 44, 59]) {
      expectCode(() => unwrapFileKey(dek, ctx, flipByte(w, i)), 'auth_failed');
    }
    expectCode(() => unwrapFileKey(kek, ctx, w), 'auth_failed');
    const wrappedDek = wrapDek(dek, { orgId: ORG_A, dekVersion: 1, kekVersion: 1 }, fileKey);
    expectCode(() => unwrapFileKey(dek, ctx, wrappedDek), 'auth_failed');
  });

  it('hata mesajı anahtar baytı içermez', () => {
    const w = wrapFileKey(dek, ctx, fileKey);
    try {
      unwrapFileKey(dek, { ...ctx, keyVersion: 9 }, w);
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(dek.toString('hex'));
      expect(msg).not.toContain(w.toString('hex'));
      expect(msg).not.toContain(dek.toString('base64'));
    }
  });
});
