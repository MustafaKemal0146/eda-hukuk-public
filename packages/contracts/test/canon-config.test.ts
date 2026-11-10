// @tk TK-28
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_ADMIN_EDITABLE, CONFIG_DEFAULTS } from '../src/config/defaults.ts';

type FixtureEntry = { default: unknown; adminEditable: boolean };

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'canon-config.json'), 'utf8'),
) as Record<string, FixtureEntry>;

describe('KK-P00-9 KK-002-1 KK-P11-22 config varsayılanları 002 §7 ile birebir', () => {
  it('KK-002-1: anahtar kümesi fixture ile aynı (fazla/eksik anahtar yok)', () => {
    expect(Object.keys(CONFIG_DEFAULTS).sort()).toEqual(Object.keys(fixture).sort());
  });

  it('KK-002-1: her varsayılan değer fixture ile aynı', () => {
    const actual = Object.fromEntries(Object.entries(CONFIG_DEFAULTS));
    const expected = Object.fromEntries(Object.entries(fixture).map(([k, v]) => [k, v.default]));
    expect(actual).toEqual(expected);
  });

  it('KK-002-1: admin tarafından düzenlenebilir anahtarlar fixture Admin=E kümesi', () => {
    const expected = Object.entries(fixture)
      .filter(([, v]) => v.adminEditable)
      .map(([k]) => k)
      .sort();
    expect([...CONFIG_ADMIN_EDITABLE].sort()).toEqual(expected);
  });
});

describe('KK-P14a-18 / KK-002-1: korpus ve getirim anahtarları (P14a.2, 034 / 023 yeni adlar)', () => {
  const EXPECTED: Record<string, unknown> = {
    'corpus.embedBatchSize': 16,
    'corpus.embedBatchTimeoutMs': 120000,
    'corpus.embedSharedModeBatchSize': 4,
    'corpus.embedSharedModePauseMs': 500,
    'corpus.embedCpuMaxChunksPerRun': 2000,
    'corpus.loadBatchRows': 2000,
    'corpus.chunkHardMaxTokens': 512,
    'corpus.prefixMaxTokens': 60,
    'corpus.prefixMaxCitedArticles': 6,
    'corpus.prefixVersion': 1,
    'corpus.chunkingVersion': 1,
    'corpus.sectioningVersion': 1,
    'corpus.minTextChars': 200,
    'corpus.redactDirectIdentifiers': true,
    'corpus.liveHit.ingestOnBufferMiss': false,
    'corpus.liveHit.maxDeferrals': 3,
    'corpus.bulk.enabled': false,
    'corpus.bulk.legalBasisRef': null,
    'corpus.bulk.windowStartHour': 0,
    'corpus.bulk.windowEndHour': 6,
    'corpus.datasetAuditSample': 200,
    'corpus.summary.enabled': false,
    'corpus.segmentation.fallbackAlertPct': 30,
    'retrieval.legLimit': 100,
    'retrieval.queryMaxChars': 2000,
    'retrieval.hnswMaxScanTuples': 20000,
    'retrieval.embedQueryTimeoutMs': 800,
    'retrieval.statementTimeoutMs': 2000,
    'retrieval.excerptMaxTokens': 250,
    'retrieval.archivePoolMax': 200,
    'retrieval.caseMaxChunksPerFile': 2,
  };

  it('anahtarlar 002 değerleriyle tanımlı', () => {
    const actual = CONFIG_DEFAULTS as Record<string, unknown>;
    for (const [k, v] of Object.entries(EXPECTED)) expect(actual[k], k).toEqual(v);
  });

  it('002 §26 madde 75: corpus.offHoursStart/End tanımlı değil (yerine bulk.window*)', () => {
    expect(Object.keys(CONFIG_DEFAULTS)).not.toContain('corpus.offHoursStart');
    expect(Object.keys(CONFIG_DEFAULTS)).not.toContain('corpus.offHoursEnd');
  });
});
