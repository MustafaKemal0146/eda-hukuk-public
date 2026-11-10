// @tk TK-17
// KK-P14a-17 (KK-034-25 veri yarısı): sentetik örnek korpus verisi (034 §15) şema ve tabakalama
// tamlığı. Yükleyici P14b'dedir; burada yalnız veri doğrulanır (ağsız birim testi).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import {
  CorpusDatasetRecord,
  type CorpusDatasetRecordValue,
  recordSha256Matches,
} from '@eda/contracts/corpus-dataset';
import { COURT_TYPES } from '@eda/contracts/tools';
import {
  extractArticleRefs,
  kunyeHashInput,
  parseArticleKey,
  parseCaseNoText,
} from '@eda/legal/kunye';
import { sectionDecision } from '@eda/legal/sections';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const DIR = new URL('../../src/seed/dev/corpus-sample/', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, DIR), 'utf8');
const ndjson = (f: string): unknown[] =>
  read(f)
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as unknown);
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const DECISIONS: CorpusDatasetRecordValue[] = ndjson('decisions.ndjson').map((r) =>
  CorpusDatasetRecord.parse(r),
);

/** Örnek mevzuat satırı (P14b yükleyicisi `corpus.laws` / `law_articles`'a yazar). */
const SampleLaw = z.strictObject({
  law_type: z.enum(['law', 'constitution']),
  law_no: z.string().regex(/^\d{1,5}$/),
  title: z.string().min(1),
  short_name: z.string().nullable(),
  articles: z.array(
    z.strictObject({
      article_no: z.string().regex(/^(G|E|M)?[0-9]+(\/[A-Za-z])?$/),
      title: z.string().nullable(),
      text: z.string().startsWith('[ÖRNEK METİN]'),
      status: z.enum(['in_force', 'repealed']),
    }),
  ),
});
const LAWS = ndjson('laws.ndjson').map((r) => SampleLaw.parse(r));

const hashOf = (r: CorpusDatasetRecordValue) =>
  kunyeHashInput({
    courtType: r.court_type,
    chamberCode: r.chamber_code,
    chamberRaw: r.chamber,
    courtName: r.court,
    esasCanon: r.esas_no ? (parseCaseNoText(r.esas_no).esas?.canon ?? null) : null,
    kararCanon: r.karar_no ? (parseCaseNoText(r.karar_no, 'karar').karar?.canon ?? null) : null,
  });

describe('KK-P14a-17 / KK-034-25: örnek korpus tabakalama (034 §15)', () => {
  it('her satır CorpusDatasetRecord ile geçerli, record_sha256 tutarlı, ÖRNEK etiketli', () => {
    expect(DECISIONS.length).toBeGreaterThanOrEqual(18);
    for (const r of DECISIONS) {
      expect(recordSha256Matches(r, sha), r.document_id).toBe(true);
      expect(r.dataset_id).toContain('ornek');
      expect(r.title ?? '', r.document_id).toMatch(/^Örnek/);
      if (r.text_status === 'ok') expect(r.text_markdown.startsWith('ÖRNEK VERİ')).toBe(true);
    }
  });

  it('8 MVP court_type için kısa ve uzun örnek', () => {
    for (const ct of COURT_TYPES) {
      const rows = DECISIONS.filter((r) => r.court_type === ct && r.text_status === 'ok');
      const sizes = rows.map((r) => r.text_markdown.length);
      expect(Math.min(...sizes), ct).toBeLessThan(1500);
      expect(Math.max(...sizes), ct).toBeGreaterThan(
        CONFIG_DEFAULTS['sources.decisionSectionMaxChars'],
      );
    }
  });

  it('bir text_unavailable kabuk, bir fallback karar, tetkik hâkimi ve taraf iddiası bölümleri', () => {
    expect(DECISIONS.filter((r) => r.text_status === 'text_unavailable')).toHaveLength(1);
    const sectioned = DECISIONS.filter((r) => r.text_status === 'ok').map((r) =>
      sectionDecision(r.text_markdown, { courtType: r.court_type }),
    );
    expect(sectioned.filter((s) => s.outcome === 'fallback').length).toBeGreaterThanOrEqual(1);
    const roles = new Set(sectioned.flatMap((s) => s.sections.map((x) => x.role)));
    for (const role of ['tetkik_hakimi', 'taraf_iddiasi', 'gerekce', 'hukum', 'karsi_oy']) {
      expect(roles.has(role as never), role).toBe(true);
    }
    for (const s of sectioned) {
      for (const sec of s.sections) {
        expect(sec.text.length).toBeLessThanOrEqual(
          CONFIG_DEFAULTS['sources.decisionSectionMaxChars'],
        );
      }
    }
  });

  it('bir mükerrer çift: aynı künye hash girdisi, farklı document_id; diğer künyeler tekil', () => {
    const groups = new Map<string, string[]>();
    for (const r of DECISIONS) {
      const h = hashOf(r);
      expect(h, r.document_id).not.toBeNull();
      groups.set(h as string, [...(groups.get(h as string) ?? []), r.document_id]);
    }
    const dup = [...groups.values()].filter((ids) => ids.length > 1);
    expect(dup).toHaveLength(1);
    expect(new Set(dup[0]).size).toBe(2);
  });

  it('farklı kanunlara atıf yapan örnekler', () => {
    const laws = new Set(
      DECISIONS.flatMap((r) => extractArticleRefs(r.text_markdown).map((a) => a.lawNo)),
    );
    expect(laws.size).toBeGreaterThanOrEqual(5);
  });

  it('mevzuat: TBK m. 1–10 ve 49–50, İİK m. 68, bir geçici, bir ek, bir mülga madde', () => {
    const keys = (lawNo: string) =>
      LAWS.find((l) => l.law_no === lawNo)?.articles.map((a) => a.article_no) ?? [];
    expect(keys('6098')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '49', '50']);
    expect(keys('2004')).toContain('68');
    const all = LAWS.flatMap((l) => l.articles);
    expect(all.some((a) => parseArticleKey(a.article_no)?.prefix === 'G')).toBe(true);
    expect(all.some((a) => parseArticleKey(a.article_no)?.prefix === 'E')).toBe(true);
    expect(all.filter((a) => a.status === 'repealed')).toHaveLength(1);
  });

  it('VERSION sürümleri yapılandırmayla eşit', () => {
    const v = Object.fromEntries(
      read('VERSION')
        .trim()
        .split('\n')
        .map((l) => l.split('=') as [string, string]),
    );
    expect(Number(v.chunkingVersion)).toBe(CONFIG_DEFAULTS['corpus.chunkingVersion']);
    expect(Number(v.prefixVersion)).toBe(CONFIG_DEFAULTS['corpus.prefixVersion']);
    expect(Number(v.sectioningVersion)).toBe(CONFIG_DEFAULTS['corpus.sectioningVersion']);
    expect(read('README.md')).toContain('ÖRNEK VERİ');
  });
});
