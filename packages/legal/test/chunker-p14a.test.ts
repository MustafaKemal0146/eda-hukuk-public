// @tk TK-17
// KK-P14a-7 (KK-034-5) parçalayıcı özellik testi, KK-P14a-8 (KK-034-6) önek altın dosyası ve gömme
// girdisi, KK-P14a-9 (KK-034-7) uzun bölümün parçalanması, 034 §7.4 mevzuat parçalama. Sayaç sabit
// fixture'dır (`support/count-tokens.ts`); metinler sentetiktir.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type ArticleCitation,
  buildContextPrefix,
  buildEmbedInput,
  buildLawContextPrefix,
  chunkLawArticle,
  chunkSection,
  contextPrefixCandidates,
  DEFAULT_CHUNK_LIMITS,
  type LawPrefixInput,
  type PrefixDecision,
  type SectionChunk,
  sectionDecision,
  selectPrefixCitations,
} from '../src/sections/index.ts';
import { tr_normalize } from '../src/text/index.ts';
import { countingCounter, fixtureCountTokens, tokensOf } from './support/count-tokens.ts';
import { type Rng, seeded } from './support/rng.ts';

const { min, max, hardMax } = DEFAULT_CHUNK_LIMITS;

const WORDS = [
  'örnek',
  'gerekçe',
  'mahkeme',
  'davacı',
  'tazminat',
  'değerlendirme',
  'uyarınca',
  'kararın',
  'hukuka',
  'aykırılık',
  'm.',
  '49',
  'E.',
  '2024/1',
  'sözleşmenin',
  'feshi',
];

function sentence(rng: Rng, words: number): string {
  return `Örnek ${Array.from({ length: words }, () => rng.pick(WORDS)).join(' ')}.`;
}

function randomSection(rng: Rng): string {
  const paragraphs = rng.int(1, 12);
  const parts: string[] = [];
  for (let p = 0; p < paragraphs; p++) {
    const kind = rng.int(0, 9);
    if (kind === 0) {
      // Noktalamasız çok uzun cümle (boşluktan bölme yolu).
      parts.push(Array.from({ length: rng.int(300, 700) }, () => rng.pick(WORDS)).join(' '));
    } else {
      parts.push(
        Array.from({ length: rng.int(1, kind === 1 ? 60 : 12) }, () =>
          sentence(rng, rng.int(3, 40)),
        ).join(rng.pick([' ', '  '])),
      );
    }
  }
  return parts.join(rng.pick(['\n', '\n\n', '\n \n']));
}

function expectCovers(text: string, chunks: readonly SectionChunk[]): void {
  let at = 0;
  for (const c of chunks) {
    expect(c.text).toBe(text.slice(c.charStart, c.charEnd));
    expect(c.charStart).toBeGreaterThanOrEqual(at);
    expect(text.slice(at, c.charStart).trim()).toBe('');
    at = c.charEnd;
  }
  expect(text.slice(at).trim()).toBe('');
}

const DECISION: PrefixDecision = {
  courtType: 'yargitay',
  courtName: 'Yargıtay',
  chamberCode: 'H9',
  chamberRaw: '9. Hukuk Dairesi',
  esasNo: '2024/900101',
  kararNo: '2025/900102',
  decisionDate: '2025-03-12',
};

describe('KK-P14a-7 / KK-034-5: parçalayıcı özellik testi (1.000 rastgele bölüm)', () => {
  it('kayıpsız örtme, dilim eşitliği, önek dahil ≤ 512, hedef aralığı, belirlenimcilik', async () => {
    const rng = seeded(20261011);
    let chunksSeen = 0;
    for (let i = 0; i < 1000; i++) {
      const text = randomSection(rng);
      const prefixes = contextPrefixCandidates(DECISION, 'gerekce', [
        { lawNo: '6098', articleNo: '49' },
      ]);
      const chunks = await chunkSection({ text, prefixCandidates: prefixes }, fixtureCountTokens);
      expectCovers(text, chunks);
      const total = tokensOf(text);
      chunks.forEach((c, k) => {
        expect(tokensOf(c.contextPrefix + c.text)).toBeLessThanOrEqual(hardMax);
        expect(c.tokenCount).toBe(tokensOf(c.text));
        expect(c.tokenCount).toBeLessThanOrEqual(max);
        // 350 altı yalnız bölümün son parçası veya bölüm toplamı 350'den kısa.
        if (k < chunks.length - 1) expect(c.tokenCount).toBeGreaterThanOrEqual(min);
      });
      if (total < min) expect(chunks.length).toBeLessThanOrEqual(1);
      chunksSeen += chunks.length;
      if (i % 50 === 0) {
        const again = await chunkSection({ text, prefixCandidates: prefixes }, fixtureCountTokens);
        expect(JSON.stringify(again)).toBe(JSON.stringify(chunks));
      }
    }
    expect(chunksSeen).toBeGreaterThan(1000);
  });

  it('kısa bölüm tek parça; boş bölüm parça üretmez', async () => {
    const short = 'Kısa örnek hüküm.';
    const chunks = await chunkSection(
      { text: short, prefixCandidates: ['P — '] },
      fixtureCountTokens,
    );
    expect(chunks).toEqual([
      {
        text: short,
        charStart: 0,
        charEnd: short.length,
        tokenCount: tokensOf(short),
        contextPrefix: 'P — ',
      },
    ]);
    expect(await chunkSection({ text: ' \n ', prefixCandidates: [] }, fixtureCountTokens)).toEqual(
      [],
    );
  });

  it('önek dahil 512 aşılırsa önce önek kısaltılır, sonra gövde bölünür', async () => {
    const body = Array.from({ length: 112 }, () => 'abcdefgh').join(' '); // 224 token
    const long = `${'uzunöneksözcüğü '.repeat(80)}— `; // ~320 token
    const chunks = await chunkSection(
      { text: body, prefixCandidates: [long, 'Kısa — '] },
      fixtureCountTokens,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.contextPrefix).toBe('Kısa — ');
    const huge = `${'x'.repeat(4)} `.repeat(10).trim();
    const split = await chunkSection(
      { text: huge, prefixCandidates: ['p — '] },
      fixtureCountTokens,
      { min: 1, max: 20, hardMax: 6 },
    );
    expect(split.length).toBeGreaterThan(1);
    for (const c of split) expect(tokensOf(c.contextPrefix + c.text)).toBeLessThanOrEqual(6);
  });

  it('paragraf sayımı tek toplu çağrıdır; nihai doğrulama ikinci toplu çağrıdır', async () => {
    const text = Array.from({ length: 5 }, (_, i) => `Örnek paragraf ${i} kısa metin.`).join('\n');
    const c = countingCounter();
    await chunkSection({ text, prefixCandidates: ['P — '] }, c.count);
    expect(c.calls()).toBe(2);
  });
});

type PrefixGolden = {
  decision: PrefixDecision;
  role: 'gerekce';
  citations: ArticleCitation[];
  text: string;
  candidates: string[];
  embedInput: string;
  law: { input: LawPrefixInput; prefix: string };
};
const PREFIX = JSON.parse(
  readFileSync(new URL('./golden/sections/prefix.v1.json', import.meta.url), 'utf8'),
) as PrefixGolden;

describe('KK-P14a-8 / KK-034-6: önek altın dosyası ve gömme girdisi', () => {
  it('034 §7.3 biçimi ve kısaltma sırası (atıflar 3, atıfsız, tarihsiz)', () => {
    expect(contextPrefixCandidates(PREFIX.decision, PREFIX.role, PREFIX.citations)).toEqual(
      PREFIX.candidates,
    );
  });

  it('embed_input = tr_normalize(context_prefix + text)', () => {
    const prefix = PREFIX.candidates[0] ?? '';
    expect(buildEmbedInput(prefix, PREFIX.text)).toBe(PREFIX.embedInput);
    expect(buildEmbedInput(prefix, PREFIX.text)).toBe(tr_normalize(prefix + PREFIX.text));
  });

  it('önek bütçesi aşılınca önce atıflar 3e, sonra tamamen, sonra tarih atılır; künye çekirdeği kalır', async () => {
    const cites: ArticleCitation[] = Array.from({ length: 6 }, (_, i) => ({
      lawNo: '6098',
      articleNo: String(i + 1),
    }));
    const all = contextPrefixCandidates(PREFIX.decision, 'hukum', cites);
    expect(all).toHaveLength(4);
    expect(all[1]).toContain('m.1, m.2, m.3 — ');
    expect(all[1]).not.toContain('m.4');
    const sizes = all.map(tokensOf);
    for (const [budget, expected] of [
      [sizes[0] ?? 0, 0],
      [(sizes[0] ?? 0) - 1, 1],
      [(sizes[1] ?? 0) - 1, 2],
      [(sizes[2] ?? 0) - 1, 3],
      [1, 3],
    ] as const) {
      const out = await buildContextPrefix(
        PREFIX.decision,
        'hukum',
        cites,
        fixtureCountTokens,
        budget,
      );
      expect(out.prefix).toBe(all[expected]);
    }
    const core = all[3] ?? '';
    expect(core).toBe('Yargıtay 9. HD | E. 2024/1234 K. 2025/5678 | [HÜKÜM] — ');
  });

  it('atıf seçimi: en sık geçen en çok 6, eşitlikte ilk görülme sırası', () => {
    const occ: ArticleCitation[] = [
      { lawNo: '1', articleNo: 'a' },
      { lawNo: '2', articleNo: 'b' },
      { lawNo: '2', articleNo: 'b' },
      ...Array.from({ length: 8 }, (_, i) => ({ lawNo: '3', articleNo: String(i) })),
    ];
    expect(selectPrefixCitations(occ).map((c) => `${c.lawNo}|${c.articleNo}`)).toEqual([
      '2|b',
      '1|a',
      '3|0',
      '3|1',
      '3|2',
      '3|3',
    ]);
  });

  it('AYM bireysel önekte başvuru numarası; boş alan ve ayırıcısı atlanır', () => {
    const [p] = contextPrefixCandidates(
      {
        ...PREFIX.decision,
        courtType: 'aym_bireysel',
        courtName: 'Anayasa Mahkemesi',
        chamberCode: null,
        chamberRaw: null,
        kararNo: null,
        decisionDate: null,
      },
      'gerekce',
      [],
    );
    expect(p).toBe('Anayasa Mahkemesi | B. No: 2024/1234 | [GEREKÇE] — ');
  });
});

describe('KK-P14a-9 / KK-034-7: 6000+ karakterli bölümün bölme ve parçalama zinciri', () => {
  it('bölümleyici parçaları + parçalayıcı: her bölme parçası kendi içinde kayıpsız parçalanır', async () => {
    const para = 'Örnek gerekçe cümlesi uzun bir değerlendirme içerir. '.repeat(25).trim();
    const body = Array.from({ length: 8 }, () => para).join('\n\n');
    const out = sectionDecision(`ÖRNEK DAİRE\nGEREKÇE\n${body}`, { courtType: 'yargitay' });
    const parts = out.sections.filter((s) => s.role === 'gerekce');
    expect(parts.length).toBeGreaterThan(1);
    for (const s of parts) {
      const chunks = await chunkSection(
        { text: s.text, prefixCandidates: contextPrefixCandidates(DECISION, s.role, []) },
        fixtureCountTokens,
      );
      expectCovers(s.text, chunks);
    }
  });
});

describe('034 §7.4: mevzuat parçalama', () => {
  const base = { lawNo: '6098', lawTitle: 'Türk Borçlar Kanunu', lawShort: 'TBK' };

  it('önek altın örneği; kısa adsız parantez yok; geçici madde biçimi', () => {
    expect(buildLawContextPrefix(PREFIX.law.input)).toBe(PREFIX.law.prefix);
    expect(
      buildLawContextPrefix({ ...base, lawShort: null, articleKey: '49', paragraphs: [1, 2] }),
    ).toBe('6098 sayılı Türk Borçlar Kanunu m. 49/1-2 — ');
    expect(buildLawContextPrefix({ ...base, articleKey: 'G5', paragraphs: null })).toBe(
      '6098 sayılı Türk Borçlar Kanunu (TBK) Geçici Madde 5 — ',
    );
  });

  it('kısa madde tek parça (fıkrasız önek); mülga madde parça üretmez', async () => {
    const text = '(1) [ÖRNEK METİN] Birinci fıkra.\n(2) [ÖRNEK METİN] İkinci fıkra.';
    const one = await chunkLawArticle(
      { ...base, articleKey: '49', text, status: 'in_force' },
      fixtureCountTokens,
    );
    expect(one).toHaveLength(1);
    expect(one[0]?.contextPrefix).toBe('6098 sayılı Türk Borçlar Kanunu (TBK) m. 49 — ');
    expect(
      await chunkLawArticle(
        { ...base, articleKey: 'M18', text: '(Mülga)', status: 'repealed' },
        fixtureCountTokens,
      ),
    ).toEqual([]);
  });

  it('uzun madde fıkra sınırından paketlenir; önek kapsanan fıkraları yazar', async () => {
    const fikra = (n: number) =>
      `(${n}) [ÖRNEK METİN] ${'sentetik fıkra sözcüğü '.repeat(60).trim()}.`;
    const text = [1, 2, 3, 4, 5].map(fikra).join('\n');
    const chunks = await chunkLawArticle(
      { ...base, articleKey: '50', text, status: 'in_force' },
      fixtureCountTokens,
    );
    expect(chunks.length).toBeGreaterThan(1);
    expectCovers(text, chunks);
    expect(chunks[0]?.contextPrefix).toMatch(
      /^6098 sayılı Türk Borçlar Kanunu \(TBK\) m\. 50\/1(-\d)? — $/,
    );
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(max);
      expect(tokensOf(c.contextPrefix + c.text)).toBeLessThanOrEqual(hardMax);
    }
  });
});
