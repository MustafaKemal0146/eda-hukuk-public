// @tk TK-06
import { describe, expect, it } from 'vitest';
import { encryptFieldWithNonce } from '../src/field.ts';
import {
  CryptoError,
  decryptField,
  deriveOrgSearchKey,
  encryptField,
  type FieldContext,
  fieldAad,
  normalizeId,
  searchHmac,
} from '../src/index.ts';
import { fieldVectors, flipByte, hex, seq } from './load-vectors.ts';

const ORG_A = '00000000-0000-7000-8000-00000000000a';
const ORG_B = '00000000-0000-7000-8000-00000000000b';
const ROW_A = '00000000-0000-7000-8000-0000000000c1';
const ROW_B = '00000000-0000-7000-8000-0000000000c2';

const dek = seq(0x20, 32);
const hmacPseudonymKey = seq(0x60, 32);
// Uydurma 11 haneli numara; gerçek kişiye ait değildir.
const SAMPLE_ID = '12345678901';

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

describe('KK-P03c-15: bilinen-cevap vektörleri (alan şifreleme ve arama HMAC)', () => {
  it('encryptField: AAD ve şifreli çıktı vektörle aynı; decryptField değeri döndürür', () => {
    for (const v of fieldVectors.encryptField) {
      const ctx: FieldContext = {
        orgId: v.orgId,
        table: v.table,
        rowId: v.rowId,
        column: v.column,
        keyVersion: v.keyVersion,
      };
      expect(fieldAad(ctx).toString('hex')).toBe(v.aad);
      expect(encryptFieldWithNonce(hex(v.dek), ctx, v.value, hex(v.nonce)).toString('hex')).toBe(
        v.sealed,
      );
      expect(decryptField(hex(v.dek), ctx, hex(v.sealed))).toBe(v.value);
    }
  });

  it('deriveOrgSearchKey ve searchHmac vektörle aynı', () => {
    for (const v of fieldVectors.orgSearch) {
      const key = deriveOrgSearchKey(hex(v.hmacPseudonymKey), v.orgId);
      expect(key.toString('hex')).toBe(v.orgSearchKey);
      expect(normalizeId(v.input)).toBe(v.normalized);
      expect(searchHmac(key, v.normalized).toString('hex')).toBe(v.hmac);
    }
  });
});

describe('KK-P03c-15: TCKN/VKN alan şifreleme', () => {
  const ctx: FieldContext = {
    orgId: ORG_A,
    table: 'clients',
    rowId: ROW_A,
    column: 'tckn_enc',
    keyVersion: 1,
  };

  it('gidiş-dönüş; çıktı nonce(12) ‖ şifreli ‖ etiket(16); üretim nonce’u rastgele', () => {
    const a = encryptField(dek, ctx, SAMPLE_ID);
    const b = encryptField(dek, ctx, SAMPLE_ID);
    expect(a.length).toBe(12 + SAMPLE_ID.length + 16);
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
    expect(decryptField(dek, ctx, a)).toBe(SAMPLE_ID);
    expect(decryptField(dek, ctx, b)).toBe(SAMPLE_ID);
  });

  it('AAD bileşeni (org, tablo, satır, kolon, key_version) değişince decryptField hata verir', () => {
    const sealed = encryptField(dek, ctx, SAMPLE_ID);
    const variants: FieldContext[] = [
      { ...ctx, orgId: ORG_B },
      { ...ctx, table: 'case_parties' },
      { ...ctx, rowId: ROW_B },
      { ...ctx, column: 'vkn_enc' },
      { ...ctx, keyVersion: 2 },
    ];
    for (const other of variants) {
      expectCode(() => decryptField(dek, other, sealed), 'auth_failed');
    }
  });

  it('uzunluk önekleri tablo/kolon sınırı kaymasını ayırt eder', () => {
    const a = fieldAad({ ...ctx, table: 'ab', column: 'c' });
    const b = fieldAad({ ...ctx, table: 'a', column: 'bc' });
    expect(a.equals(b)).toBe(false);
  });

  it('bozuk bayt/etiket, kesilmiş veri ve yanlış DEK hata verir', () => {
    const sealed = encryptField(dek, ctx, SAMPLE_ID);
    for (const i of [0, 11, 12, sealed.length - 17, sealed.length - 1]) {
      expectCode(() => decryptField(dek, ctx, flipByte(sealed, i)), 'auth_failed');
    }
    expectCode(() => decryptField(dek, ctx, sealed.subarray(0, 27)), 'auth_failed');
    expectCode(() => decryptField(seq(0x21, 32), ctx, sealed), 'auth_failed');
  });

  it('geçersiz girdi invalid_input verir', () => {
    expectCode(() => encryptField(dek, ctx, ''), 'invalid_input');
    expectCode(
      () => encryptField(dek, { ...ctx, table: 'app.clients' }, SAMPLE_ID),
      'invalid_input',
    );
    expectCode(() => encryptField(dek, { ...ctx, column: '' }, SAMPLE_ID), 'invalid_input');
    expectCode(() => encryptField(dek, { ...ctx, rowId: 'satir' }, SAMPLE_ID), 'invalid_input');
    expectCode(() => encryptField(seq(0, 31), ctx, SAMPLE_ID), 'invalid_input');
  });
});

describe('KK-P03c-15: büro başına arama HMAC’i', () => {
  it('aynı TCKN iki farklı büro anahtarıyla farklı HMAC üretir', () => {
    const kA = deriveOrgSearchKey(hmacPseudonymKey, ORG_A);
    const kB = deriveOrgSearchKey(hmacPseudonymKey, ORG_B);
    expect(kA.equals(kB)).toBe(false);
    const hA = searchHmac(kA, normalizeId(SAMPLE_ID));
    const hB = searchHmac(kB, normalizeId(SAMPLE_ID));
    expect(hA.length).toBe(32);
    expect(hA.equals(hB)).toBe(false);
    expect(searchHmac(kA, normalizeId('123 456-78901')).equals(hA)).toBe(true);
  });

  it('normalizeId yalnız rakamları bırakır', () => {
    expect(normalizeId('123 456-78901')).toBe('12345678901');
    expect(normalizeId(' 1.234.567.890 ')).toBe('1234567890');
    expect(normalizeId('abc')).toBe('');
  });

  it('normalize edilmemiş veya boş girdi ve yanlış anahtar uzunluğu reddedilir', () => {
    const k = deriveOrgSearchKey(hmacPseudonymKey, ORG_A);
    expectCode(() => searchHmac(k, '123 456'), 'invalid_input');
    expectCode(() => searchHmac(k, ''), 'invalid_input');
    expectCode(() => searchHmac(seq(0, 16), SAMPLE_ID), 'invalid_input');
    expectCode(() => deriveOrgSearchKey(seq(0, 44), ORG_A), 'invalid_input');
    expectCode(() => deriveOrgSearchKey(hmacPseudonymKey, 'buro'), 'invalid_input');
  });
});
