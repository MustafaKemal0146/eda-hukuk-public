// @tk TK-17
// KK-P14a-1 (KK-023-1): tr_normalize / tr_fold altın tablosu (023 §2.4 tamamı), 10.000 dizide
// idempotentlik, `toLocaleLowerCase` yasağı; P14a.3 cümle bölücü, hukuk terimi sözlüğü, Türkçe harf
// denetimi. Metinler sentetiktir.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  hasLegalTerm,
  hasTurkishSpecificChars,
  LAW_ABBREVIATION_TERMS,
  PROTECTED_LEGAL_TERMS,
  splitSentences,
  tr_fold,
  tr_normalize,
} from '../src/text/index.ts';
import { randomText, seeded } from './support/rng.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('KK-P14a-1 / KK-023-1: tr_normalize ve tr_fold altın tablosu (023 §2.4)', () => {
  const rows: [string, string, string][] = [
    ['YARGITAY 9. HUKUK DAİRESİ', 'yargıtay 9. hukuk dairesi', 'yargitay 9. hukuk dairesi'],
    ['IĞDIR', 'ığdır', 'igdir'],
    ['İSTANBUL', 'istanbul', 'istanbul'],
    ['İçtihat', 'içtihat', 'ictihat'],
    ['4857 S.K. md.18', '4857 sayılı kanun m. 18', '4857 sayili kanun m. 18'],
    ['“kıdem” – tazminatı', '"kıdem" - tazminatı', '"kidem" - tazminati'],
    ['2021 / 1234 E.', '2021/1234 e.', '2021/1234 e.'],
    ['HÂKİMİN', 'hakimin', 'hakimin'],
    ['tazmi-\nnat', 'tazminat', 'tazminat'],
  ];
  for (const [input, norm, fold] of rows) {
    it(JSON.stringify(input), () => {
      expect(tr_normalize(input)).toBe(norm);
      expect(tr_fold(input)).toBe(fold);
    });
  }

  it('"İSTANBUL" çıktısı 8 karakterdir (birleşik nokta işareti kalmaz)', () => {
    expect(tr_normalize('İSTANBUL')).toHaveLength(8);
  });

  it('10.000 rastgele dizide idempotent: tr_normalize(tr_normalize(x)) === tr_normalize(x)', () => {
    const rng = seeded(20261011);
    for (let i = 0; i < 10_000; i++) {
      const x = randomText(rng, 60);
      const once = tr_normalize(x);
      expect(tr_normalize(once), JSON.stringify(x)).toBe(once);
      expect(tr_fold(tr_fold(x)), JSON.stringify(x)).toBe(tr_fold(x));
    }
  });

  it('@eda/legal kaynağında toLocaleLowerCase / toLocaleUpperCase / Intl yok (Y-104)', () => {
    for (const f of sourceFiles(SRC)) {
      const code = readFileSync(f, 'utf8');
      expect(code, f).not.toMatch(/toLocale(Lower|Upper)Case\s*\(/);
    }
  });
});

describe('P14a.3: cümle bölücü (034 §6.5)', () => {
  it('kısaltma ve sıra sayısından sonra bölmez', () => {
    const text =
      'Örnek Yargıtay 9. Hukuk Dairesi kararıdır. TBK m. 49 uygulanır. Bkz. E. 2024/1 K. 2024/2 No. 5 vb. Örnek. Av. Ad Örnek geldi.';
    const parts = splitSentences(text).map((s) => text.slice(s.start, s.end).trim());
    expect(parts).toEqual([
      'Örnek Yargıtay 9. Hukuk Dairesi kararıdır.',
      'TBK m. 49 uygulanır.',
      'Bkz. E. 2024/1 K. 2024/2 No. 5 vb. Örnek.',
      'Av. Ad Örnek geldi.',
    ]);
  });

  it('küçük harfle devam eden nokta cümle sonu değildir; soru ve ünlem bölünür', () => {
    const text = 'Bu bir örnek. ve devam eder! Peki? Evet.';
    const parts = splitSentences(text).map((s) => text.slice(s.start, s.end).trim());
    expect(parts).toEqual(['Bu bir örnek. ve devam eder!', 'Peki?', 'Evet.']);
  });

  it('özellik: 2.000 rastgele metinde aralıklar ardışık ve kayıpsız örter', () => {
    const rng = seeded(7);
    const words = [
      'Karar',
      'verildi.',
      'm.',
      '9.',
      'Daire',
      'E.',
      'örnek',
      'Dava!',
      'Neden?',
      '"Alıntı."',
    ];
    for (let i = 0; i < 2000; i++) {
      const n = rng.int(0, 40);
      const text = Array.from({ length: n }, () => rng.pick(words)).join(
        rng.pick([' ', '  ', '\n']),
      );
      const spans = splitSentences(text);
      expect(spans.map((s) => text.slice(s.start, s.end)).join('')).toBe(text);
      let at = 0;
      for (const s of spans) {
        expect(s.start).toBe(at);
        expect(s.end).toBeGreaterThan(s.start);
        at = s.end;
      }
      expect(at).toBe(text.length);
    }
  });

  it('boş metin aralık üretmez', () => {
    expect(splitSentences('')).toEqual([]);
  });
});

describe('P14a.3: hukuk terimi sözlüğü ve Türkçe harf denetimi (023 §10.1, §4.2)', () => {
  it('normalize girdide korunan terim veya kanun kısaltması eşleşir', () => {
    expect(hasLegalTerm(tr_normalize('Kıdem tazminatı nasıl hesaplanır'))).toBe(true);
    expect(hasLegalTerm(tr_normalize('İİK kapsamında itiraz süresi'))).toBe(true);
    expect(hasLegalTerm(tr_normalize('Av.K. uyarınca disiplin'))).toBe(true);
    expect(hasLegalTerm(tr_normalize('merhaba nasılsın'))).toBe(false);
    // "ay" gündelik sözcüktür; Anayasa kısaltması tek başına terim sayılmaz.
    expect(hasLegalTerm(tr_normalize('bu ay ödeme yaptım'))).toBe(false);
    // Sözcük içinde geçen kısaltma eşleşmez ("tbk" ≠ "tbkx").
    expect(hasLegalTerm('tbkx örnek')).toBe(false);
  });

  it('kısaltma listesi normalize biçimde, yinelemesiz', () => {
    expect(new Set(LAW_ABBREVIATION_TERMS).size).toBe(LAW_ABBREVIATION_TERMS.length);
    for (const t of LAW_ABBREVIATION_TERMS) expect(tr_normalize(t)).toBe(t);
    expect(LAW_ABBREVIATION_TERMS).toContain('tbk');
    expect(LAW_ABBREVIATION_TERMS).toContain('iik');
  });

  it('hasTurkishSpecificChars yalnız Türkçe harfte doğru döner', () => {
    expect(hasTurkishSpecificChars('kidem tazminati')).toBe(false);
    expect(hasTurkishSpecificChars('kıdem')).toBe(true);
    expect(hasTurkishSpecificChars('İSTANBUL')).toBe(true);
    expect(hasTurkishSpecificChars('ÇEK')).toBe(true);
  });
});

describe('KK-P14a-3 (dosya yarısı) / 023 §3.2–§3.3: tr_hukuk sözlük dosyaları', () => {
  const TSEARCH = new URL('../../../infra/postgres/tsearch_data/', import.meta.url);
  const lines = (f: string) =>
    readFileSync(new URL(f, TSEARCH), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');

  it('korunan terim dosyasının sol sütunu PROTECTED_LEGAL_TERMS ile aynı; her satır normalize', () => {
    const syn = lines('tr_hukuk_protected.syn').map((l) => l.split(/\s+/));
    expect(syn.map(([w]) => w)).toEqual([...PROTECTED_LEGAL_TERMS]);
    for (const [w, lex] of syn) {
      expect(tr_normalize(w ?? ''), w).toBe(w);
      expect(
        syn.some(([x, y]) => x === lex && y === lex),
        `${lex} kendine eşlenir`,
      ).toBe(true);
    }
  });

  it('durak sözcük ekleri var; hukuki anlamlı sözcükler (hakkında, aleyhine, lehine) yok', () => {
    const stop = lines('tr_hukuk.stop');
    expect(stop.slice(-5)).toEqual(['göre', 'ilişkin', 'dair', 'istinaden', 'itibaren']);
    for (const w of ['hakkında', 'aleyhine', 'lehine']) expect(stop).not.toContain(w);
  });
});
