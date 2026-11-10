// @tk TK-04
// KK-P04a-7 önkoşulu ve KK-P04a-17 (KK-053-01-4 önkoşulu): kayıt adım 1 ve meslek başvurusu şemaları
// (042 §3.1; 002 §26 madde 88). Adım 1 meslek alanı taşımaz; e-posta ASCII; sicil XOR stajyer sicili.
import { describe, expect, it } from 'vitest';
import { LawyerApplicationSchema, RegisterStep1Schema } from '../src/api/auth.ts';
import { CONFIG_DEFAULTS } from '../src/config/defaults.ts';

const base = {
  name: 'Deneme Kullanıcı',
  email: 'deneme@example.invalid',
  password: 'x'.repeat(CONFIG_DEFAULTS['auth.passwordMinLength']),
  acceptTerms: true,
  acknowledgePrivacy: true,
} as const;

describe('KK-P04a-17: kayıt adım 1 şeması', () => {
  it('geçerli gövde kabul edilir; iki onay ayrı ve zorunlu', () => {
    expect(RegisterStep1Schema.safeParse(base).success).toBe(true);
    expect(RegisterStep1Schema.safeParse({ ...base, acceptTerms: false }).success).toBe(false);
    const { acknowledgePrivacy: _omit, ...noPrivacy } = base;
    expect(RegisterStep1Schema.safeParse(noPrivacy).success).toBe(false);
  });

  it('ASCII dışı e-posta reddedilir (İ/ı/ş)', () => {
    for (const email of ['İsim@example.invalid', 'ısım@example.invalid', 'şa@örnek.invalid']) {
      expect(RegisterStep1Schema.safeParse({ ...base, email }).success).toBe(false);
    }
  });

  it('parola uzunluğu auth.passwordMinLength..auth.passwordMaxLength', () => {
    const short = 'x'.repeat(CONFIG_DEFAULTS['auth.passwordMinLength'] - 1);
    const long = 'x'.repeat(CONFIG_DEFAULTS['auth.passwordMaxLength'] + 1);
    expect(RegisterStep1Schema.safeParse({ ...base, password: short }).success).toBe(false);
    expect(RegisterStep1Schema.safeParse({ ...base, password: long }).success).toBe(false);
  });

  it('callbackURL: web formlarının gönderdiği iç yol ve basit sorgu kabul, dış adres reddedilir', () => {
    // Regresyon: `/eposta-dogrulama?durum=basarili` pilot sunucuda her kaydı 400 ile düşürüyordu.
    for (const callbackURL of [
      '/eposta-dogrulama',
      '/eposta-dogrulama?durum=basarili',
      '/davet/0198f0a0-0000-7000-8000-000000000001',
    ]) {
      expect(RegisterStep1Schema.safeParse({ ...base, callbackURL }).success).toBe(true);
    }
    for (const callbackURL of [
      'https://kotu.example.invalid/',
      '//kotu.example.invalid/',
      '/\\kotu',
      '/yol?a=b&',
      '/yol?a=<b>',
      '/yol#parca',
      'javascript:alert(1)',
    ]) {
      expect(RegisterStep1Schema.safeParse({ ...base, callbackURL }).success).toBe(false);
    }
  });

  it('meslek alanları adım 1de kabul edilmez (strict)', () => {
    expect(RegisterStep1Schema.safeParse({ ...base, baro: 'Ankara Barosu' }).success).toBe(false);
  });
});

describe('KK-P04a-6 önkoşulu: meslek başvurusu şeması', () => {
  const app = { kind: 'lawyer', baro: 'Ankara Barosu', sicilNo: '12345', declareProfession: true };

  it('avukat sicil no, stajyer stajyer sicil no taşır (XOR)', () => {
    expect(LawyerApplicationSchema.safeParse(app).success).toBe(true);
    expect(LawyerApplicationSchema.safeParse({ ...app, traineeRegistryNo: '1' }).success).toBe(
      false,
    );
    expect(
      LawyerApplicationSchema.safeParse({
        kind: 'trainee',
        baro: 'Ankara Barosu',
        traineeRegistryNo: 'S-1',
        declareProfession: true,
      }).success,
    ).toBe(true);
    expect(LawyerApplicationSchema.safeParse({ ...app, kind: 'trainee' }).success).toBe(false);
  });

  it('beyan zorunlu; sicil biçimi ve referans kodu biçimi denetlenir', () => {
    expect(LawyerApplicationSchema.safeParse({ ...app, declareProfession: false }).success).toBe(
      false,
    );
    expect(LawyerApplicationSchema.safeParse({ ...app, sicilNo: '12 34' }).success).toBe(false);
    expect(LawyerApplicationSchema.safeParse({ ...app, partnerCode: 'abc' }).success).toBe(false);
    expect(LawyerApplicationSchema.safeParse({ ...app, partnerCode: 'BAYI-01' }).success).toBe(
      true,
    );
  });
});
