// @tk TK-28
// #54 BYOK birim testleri (ağsız, veritabansız): şifreleme bağlamları ve sözleşme. Anahtar değeri
// şifreli kolona düz metin olarak girmez ve yanıt şemasından geçemez. Veriler sentetiktir.
import { AiApiKeyInput, AiKeysStatusDto } from '@eda/contracts/api/ai-keys';
import { decryptField, encryptField } from '@eda/crypto';
import { describe, expect, it } from 'vitest';
import {
  deriveUserKey,
  last4Of,
  orgKeyContext,
  userKeyContext,
} from '../src/services/ai-keys/crypto.ts';

const ORG = '0198d2a4-0000-7000-8000-0000000000a1';
const ORG2 = '0198d2a4-0000-7000-8000-0000000000a2';
const USER = '0198d2a4-0000-7000-8000-0000000000b1';
const USER2 = '0198d2a4-0000-7000-8000-0000000000b2';
const KEY = `sk-ant-${'a'.repeat(40)}`;
const dek = Buffer.alloc(32, 7);
const kek = Buffer.alloc(32, 9);

describe('#54: anahtar şifreleme bağlamı', () => {
  it('şifreli değer düz metni içermez ve aynı bağlamda geri çözülür', () => {
    const enc = encryptField(dek, orgKeyContext(ORG, 1), KEY);
    expect(enc.includes(Buffer.from(KEY))).toBe(false);
    expect(enc.includes(Buffer.from(KEY.slice(0, 12)))).toBe(false);
    expect(decryptField(dek, orgKeyContext(ORG, 1), enc)).toBe(KEY);
  });

  it('başka büroya, başka sürüme veya başka anahtara taşınan şifreli değer çözülmez', () => {
    const enc = encryptField(dek, orgKeyContext(ORG, 1), KEY);
    expect(() => decryptField(dek, orgKeyContext(ORG2, 1), enc)).toThrow();
    expect(() => decryptField(dek, orgKeyContext(ORG, 2), enc)).toThrow();
    expect(() => decryptField(Buffer.alloc(32, 8), orgKeyContext(ORG, 1), enc)).toThrow();
  });

  it('büro ve kullanıcı bağlamları birbirinin yerine kullanılamaz', () => {
    const enc = encryptField(dek, orgKeyContext(ORG, 1), KEY);
    expect(() => decryptField(dek, userKeyContext(ORG, 1), enc)).toThrow();
  });

  it('kişisel anahtar kullanıcıya özeldir: başka kullanıcının türetilmiş anahtarı çözemez', () => {
    const k1 = deriveUserKey(kek, USER);
    const k2 = deriveUserKey(kek, USER2);
    expect(k1.equals(k2)).toBe(false);
    expect(k1.equals(deriveUserKey(kek, USER))).toBe(true);
    const enc = encryptField(k1, userKeyContext(USER, 1), KEY);
    expect(decryptField(k1, userKeyContext(USER, 1), enc)).toBe(KEY);
    expect(() => decryptField(k2, userKeyContext(USER, 1), enc)).toThrow();
    expect(() => decryptField(k1, userKeyContext(USER2, 1), enc)).toThrow();
  });

  it('son 4 karakter anahtarın sonundan alınır', () => {
    expect(last4Of('sk-ant-abcdefghijklmnopqrstuvwxyz1234')).toBe('1234');
  });
});

describe('#54: sözleşme', () => {
  it('anahtar biçimi: Anthropic önekli ve uzunluk sınırlı; fazla alan reddedilir', () => {
    expect(AiApiKeyInput.safeParse({ apiKey: KEY }).success).toBe(true);
    expect(AiApiKeyInput.safeParse({ apiKey: ` ${KEY} ` }).success).toBe(true);
    expect(AiApiKeyInput.safeParse({ apiKey: 'sk-ant-kisa' }).success).toBe(false);
    expect(AiApiKeyInput.safeParse({ apiKey: 'baska-bir-anahtar-turu-1234567890' }).success).toBe(
      false,
    );
    expect(AiApiKeyInput.safeParse({ apiKey: KEY, extra: 1 }).success).toBe(false);
    expect(AiApiKeyInput.safeParse({}).success).toBe(false);
  });

  it('durum yanıtı anahtarı taşıyamaz: yalnız son 4 karakter ve durum', () => {
    const base = {
      own: { configured: false, last4: null, verifiedAt: null },
      source: 'org',
      canManageOrg: true,
      usable: true,
      effectiveSource: 'org',
      platformFallback: false,
      platformLabel: null,
    };
    const ok = { configured: true, last4: 'wxyz', verifiedAt: '2026-10-14T10:00:00+03:00' };
    expect(AiKeysStatusDto.safeParse({ ...base, org: ok }).success).toBe(true);
    expect(AiKeysStatusDto.safeParse({ ...base, org: { ...ok, apiKey: KEY } }).success).toBe(false);
    expect(AiKeysStatusDto.safeParse({ ...base, org: { ...ok, last4: KEY } }).success).toBe(false);
  });
});
