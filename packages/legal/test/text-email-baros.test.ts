// @tk TK-04
// KK-P04a-17 (KK-053-01-2 ve KK-053-01-4 önkoşulları): `normalizeEmail` ASCII dışı e-postayı reddeder;
// `tr_fold` Türkçe i/ı/İ/I tuzaklarını doğru eşler; `BAROS` adları `tr_fold` sonrası da benzersizdir.
import { describe, expect, it } from 'vitest';
import { BARO_NAMES, BAROS } from '../src/courts/index.ts';
import { normalizeEmail, tr_fold, tr_normalize } from '../src/text/index.ts';

describe('KK-P04a-17: normalizeEmail', () => {
  it('kırpar ve yalnız ASCII büyük harfleri küçültür', () => {
    expect(normalizeEmail('  Deneme.Kisi@Example.INVALID ')).toBe('deneme.kisi@example.invalid');
    expect(normalizeEmail('IBRAHIM@EXAMPLE.INVALID')).toBe('ibrahim@example.invalid');
  });

  it('ASCII dışı karakter (İ, ı, ş, ü, ç, ğ, ö) içeren e-posta reddedilir', () => {
    for (const bad of [
      'İbrahim@example.invalid',
      'ısık@example.invalid',
      'şule@example.invalid',
      'kişi@örnek.invalid',
      'a b@example.invalid',
      '',
      '   ',
    ]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
  });

  it('Türkçe yerel ayar tuzağına düşmez: I -> i (ı değil)', () => {
    expect(normalizeEmail('ISIK@EXAMPLE.INVALID')).toBe('isik@example.invalid');
  });
});

describe('KK-P04a-17: tr_fold ve tr_normalize Türkçe harf tuzakları', () => {
  it('"İSTANBUL" ~ "istanbul", "ıspanak" ~ "ISPANAK"', () => {
    expect(tr_fold('İSTANBUL')).toBe(tr_fold('istanbul'));
    expect(tr_fold('ıspanak')).toBe(tr_fold('ISPANAK'));
    expect(tr_fold('IĞDIR')).toBe('igdir');
    expect(tr_normalize('IĞDIR')).toBe('ığdır');
    expect(tr_normalize('İzmir')).toBe('izmir');
  });

  it('baro araması aksan ve büyük/küçük harf duyarsız eşleşir', () => {
    const q = tr_fold('istanbul');
    expect(BARO_NAMES.filter((n) => tr_fold(n).startsWith(q))).toEqual([
      'İstanbul Barosu',
      'İstanbul 2 Nolu Barosu',
    ]);
  });
});

describe('KK-P04a-17: BAROS', () => {
  it('adlar boş değil, "Barosu" ile biter, yinelenmez ve tr_fold sonrası da benzersizdir', () => {
    expect(BAROS.length).toBeGreaterThan(0);
    const names = BAROS.map((b) => b.name);
    for (const n of names) expect(n).toMatch(/^\S.* Barosu$/);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(names.map((n) => tr_fold(n))).size).toBe(names.length);
    expect([...BARO_NAMES]).toEqual(names);
  });

  it('lookupUrl yalnız null veya https', () => {
    for (const b of BAROS) {
      const url: string | null = b.lookupUrl;
      if (url !== null) expect(url).toMatch(/^https:\/\//);
    }
  });
});
