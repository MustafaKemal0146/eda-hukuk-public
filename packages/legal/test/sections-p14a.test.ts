// @tk TK-17
// KK-P14a-6 (KK-034-4): korpus bölümleyici altın kümesi (8 MVP mahkeme türü x en az 2), fallback;
// KK-P14a-9 (KK-034-7): 6000 karakter bölme; 034 §6.6 heyet/imza bloğu. Altın metinler SENTETİK yapı
// örnekleridir (`unverified_shape`); gerçek karar fixture'ıyla doğrulama 'dadır.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COURT_TYPES } from '@eda/contracts/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sectionDecision, splitLongText } from '../src/sections/index.ts';
import { seeded } from './support/rng.ts';

const GOLDEN_DIR = fileURLToPath(new URL('./golden/sections/', import.meta.url));
const Golden = z.strictObject({
  id: z.string(),
  synthetic: z.literal(true),
  unverified_shape: z.literal(true),
  note: z.string().includes('ÖRNEK'),
  courtType: z.enum(COURT_TYPES),
  lines: z.array(z.string()).min(1),
  roles: z.array(z.string()).min(1),
  outcome: z.enum(['patterned', 'fallback']),
  headings: z.array(z.string().nullable()).optional(),
  gerekceExcludes: z.array(z.string()),
});
const goldens = readdirSync(GOLDEN_DIR)
  .filter((n) => n.startsWith('corpus-') && n.endsWith('.json'))
  .sort()
  .map((n) => Golden.parse(JSON.parse(readFileSync(join(GOLDEN_DIR, n), 'utf8'))));

/** Parçalar metnin birebir dilimleri; aralar yalnız boşluk (kayıpsız). */
function expectLossless(text: string, pieces: readonly string[]): void {
  let at = 0;
  for (const p of pieces) {
    const idx = text.indexOf(p, at);
    expect(idx).toBeGreaterThanOrEqual(at);
    expect(text.slice(at, idx).trim()).toBe('');
    at = idx + p.length;
  }
  expect(text.slice(at).trim()).toBe('');
}

describe('KK-P14a-6 / KK-034-4: bölümleyici altın kümesi', () => {
  it('her MVP court_type için en az 2 altın kayıt', () => {
    for (const ct of COURT_TYPES) {
      expect(goldens.filter((g) => g.courtType === ct).length, ct).toBeGreaterThanOrEqual(2);
    }
  });

  for (const g of goldens) {
    it(`${g.id}: ${g.roles.join(' > ')} (${g.outcome})`, () => {
      const out = sectionDecision(g.lines.join('\n'), { courtType: g.courtType });
      expect(out.sections.map((s) => s.role)).toEqual(g.roles);
      expect(out.outcome).toBe(g.outcome);
      expect(out.sections.map((s) => s.no)).toEqual(out.sections.map((_, i) => i + 1));
      if (g.headings) expect(out.sections.map((s) => s.heading)).toEqual(g.headings);
      const gerekce = out.sections
        .filter((s) => s.role === 'gerekce')
        .map((s) => s.text)
        .join('\n');
      for (const phrase of g.gerekceExcludes) expect(gerekce).not.toContain(phrase);
    });
  }

  it('taraf_iddiasi ve tetkik_hakimi metni hiçbir altın kayıtta gerekce bölümüne girmez', () => {
    let checked = 0;
    for (const g of goldens) {
      const out = sectionDecision(g.lines.join('\n'), { courtType: g.courtType });
      const gerekce = out.sections.filter((s) => s.role === 'gerekce').map((s) => s.text);
      for (const s of out.sections.filter(
        (x) => x.role === 'taraf_iddiasi' || x.role === 'tetkik_hakimi',
      )) {
        checked += 1;
        for (const gt of gerekce) expect(gt.includes(s.text)).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('başlıksız ve künye ipucusuz metin tek diger bölümü; fallback (gerekce / hukum yok)', () => {
    const out = sectionDecision('Örnek metin birinci paragraf.\n\nİkinci paragraf.', {
      courtType: 'yargitay',
    });
    expect(out.outcome).toBe('fallback');
    expect(out.sections.map((s) => s.role)).toEqual(['diger']);
  });

  it('heyet/imza bloğu ayrı kunye bölümü; "oy birliğiyle karar verildi" hükümde kalır (034 §6.6)', () => {
    const text = [
      'ÖRNEK DAİRE',
      'GEREKÇE',
      'Örnek gerekçe.',
      'HÜKÜM',
      'Davanın reddine oy birliğiyle karar verildi.',
      'Başkan',
      'Örnek Ad',
      'Üye',
      'Örnek Soyad',
    ].join('\n');
    const out = sectionDecision(text, { courtType: 'yargitay' });
    expect(out.sections.map((s) => s.role)).toEqual(['kunye', 'gerekce', 'hukum', 'kunye']);
    expect(out.sections[2]?.text).toBe('Davanın reddine oy birliğiyle karar verildi.');
    expect(out.sections[3]?.text).toBe('Başkan\nÖrnek Ad\nÜye\nÖrnek Soyad');
  });
});

describe('KK-P14a-9 / KK-034-7: 6000 karakter bölme', () => {
  const sentence = 'Örnek gerekçe cümlesi m. 5 ve E. 2024/1 atfıyla devam eder. ';
  const paragraph = sentence.repeat(30).trim();
  const longBody = Array.from({ length: 6 }, () => paragraph).join('\n\n');

  it('aynı rol, ardışık section_no, başlık yalnız ilkinde, her parça ≤ 6000, kayıpsız', () => {
    expect(longBody.length).toBeGreaterThan(6000);
    const out = sectionDecision(`ÖRNEK DAİRE\nGEREKÇE\n${longBody}\nHÜKÜM\nOnanmasına.`, {
      courtType: 'yargitay',
    });
    const parts = out.sections.filter((s) => s.role === 'gerekce');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]?.heading).toBe('GEREKÇE');
    for (const p of parts.slice(1)) expect(p.heading).toBeNull();
    const nos = parts.map((p) => p.no);
    expect(nos).toEqual(nos.map((_, i) => (nos[0] ?? 0) + i));
    for (const p of parts) expect(p.text.length).toBeLessThanOrEqual(6000);
    expectLossless(
      longBody,
      parts.map((p) => p.text),
    );
  });

  it('paragrafsız uzun metin cümle sınırından, cümlesiz metin boşluktan bölünür', () => {
    const noPara = sentence.repeat(200);
    const spans = splitLongText(noPara, 6000);
    expect(spans.length).toBeGreaterThan(1);
    for (const s of spans.slice(0, -1))
      expect(noPara.slice(s.start, s.end).endsWith('eder.')).toBe(true);
    const words = 'kelime '.repeat(2000);
    const ws = splitLongText(words, 6000);
    for (const s of ws) expect(words.slice(s.start, s.end)).toMatch(/^kelime( kelime)*$/);
  });

  it('özellik: 500 rastgele metinde parçalar ≤ sınır ve kayıpsız', () => {
    const rng = seeded(34);
    const tokens = [
      'Örnek',
      'cümle.',
      'm.',
      '5',
      'Daire',
      '\n\n',
      '\n',
      'uzunsözcük'.repeat(3),
      'E.',
      'Son!',
    ];
    for (let i = 0; i < 500; i++) {
      const text = Array.from({ length: rng.int(0, 400) }, () => rng.pick(tokens)).join(' ');
      const max = rng.int(40, 400);
      const spans = splitLongText(text, max);
      for (const s of spans) expect(s.end - s.start).toBeLessThanOrEqual(max);
      expectLossless(
        text,
        spans.map((s) => text.slice(s.start, s.end)),
      );
    }
  });
});
