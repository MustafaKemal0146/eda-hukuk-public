// @tk TK-16
// P19a doc-engine dışa/içe aktarma sözleşmeleri (084 §7, 033 §7.7) ve şema üretimi (KK-084-23).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOC_ENGINE_ERROR_CODES,
  DocEngineError,
  EXPORT_DEGRADED_FEATURES,
  ExportReport,
  ExportRequest,
  ExportResult,
} from '../src/doc-engine/export.ts';
import { HiddenContentReport, ImportEngineReport, ImportResult } from '../src/doc-engine/import.ts';
import { HIDDEN_CONTENT_KINDS } from '../src/enums.ts';

const JOB = '0192f1c2-7a4b-7c3e-9d10-2b3c4d5e6f70';
const docAst = {
  schemaVersion: 1,
  kind: 'petition',
  title: 'Örnek belge',
  page: { size: 'A4', marginsMm: { top: 20, bottom: 20, left: 25, right: 20 } },
  typography: {
    fontFamily: 'Liberation Serif',
    sizePt: 12,
    noteSizePt: 10,
    lineHeight: 1.5,
    firstLineIndentCm: 1.25,
    justify: true,
    hyphenate: false,
  },
  header: null,
  sections: [],
};
const report = { degraded: [], pageCount: null, docEngineVersion: '0.0.0', gotenbergVersion: null };
const engineReport = {
  droppedFeatures: [],
  hiddenContentSkipped: 0,
  invisibleUnicodeRemoved: 0,
  sourcePage: { marginsPt: null, orientation: null },
  warnings: [],
};
const hidden = { found: false, excludedFromText: true, items: [] };
const schemaPath = (name: string) =>
  join(import.meta.dirname, '..', 'generated', 'json-schema', `${name}.schema.json`);

describe('KK-P19a-15: ExportRequest / ExportResult (084 §7)', () => {
  it('geçerli istek ve sonuç ayrıştırılır', () => {
    const req = {
      jobId: JOB,
      format: 'udf',
      docAst,
      options: { pageNumbers: true, fixedTimestamp: '2026-01-02T03:04:05Z' },
    };
    expect(ExportRequest.parse(req)).toEqual(req);
    const res = { jobId: JOB, format: 'pdf', sizeBytes: 10, sha256: 'a'.repeat(64), report };
    expect(ExportResult.parse(res)).toEqual(res);
  });

  it.each([
    ['bilinmeyen biçim', { format: 'odt' }],
    ['uuid olmayan iş', { jobId: 'job-1' }],
    ['fazla alan', { extra: true }],
    ['zaman damgası biçimsiz', { options: { pageNumbers: false, fixedTimestamp: 'dün' } }],
  ])('KK-P19a-15: geçersiz istek reddedilir (%s)', (_l, patch) => {
    const req = {
      jobId: JOB,
      format: 'docx',
      docAst,
      options: { pageNumbers: false, fixedTimestamp: null },
      ...patch,
    };
    expect(ExportRequest.safeParse(req).success).toBe(false);
  });

  it('sha256 küçük harfli 64 onaltılık hane ister; rapor alanları zorunlu', () => {
    const base = { jobId: JOB, format: 'docx', sizeBytes: 1, report };
    expect(ExportResult.safeParse({ ...base, sha256: 'A'.repeat(64) }).success).toBe(false);
    expect(ExportReport.safeParse({ degraded: [] }).success).toBe(false);
  });

  it('bozulma ve hata kod kümeleri 084 §4.2 / D1-D6 adlarını içerir', () => {
    for (const f of [
      'strike',
      'hyperlink',
      'hard_break_as_paragraph',
      'list_start',
      'keep_together',
      'page_number',
    ])
      expect(EXPORT_DEGRADED_FEATURES).toContain(f);
    expect(DOC_ENGINE_ERROR_CODES).toContain('invalid_docast');
    expect(DOC_ENGINE_ERROR_CODES).toContain('forbidden_phrase');
    expect(DocEngineError.parse({ code: 'export_failed', message: 'x' }).code).toBe(
      'export_failed',
    );
  });
});

describe('KK-P19a-15: ImportResult / HiddenContentReport (084 §7, 033 §7.7)', () => {
  it('reddedilen içe aktarma docAst=null ile ayrıştırılır', () => {
    const res = {
      jobId: JOB,
      verdict: 'reject',
      rejectReason: 'zip_slip',
      fileType: 'udf',
      docAst: null,
      report: engineReport,
      hiddenContent: hidden,
    };
    expect(ImportResult.parse(res)).toEqual(res);
  });

  it('marginsPt tam 4 değer; gizli içerik türleri kanonik küme', () => {
    const bad = { ...engineReport, sourcePage: { marginsPt: [1, 2, 3], orientation: null } };
    expect(ImportEngineReport.safeParse(bad).success).toBe(false);
    for (const kind of HIDDEN_CONTENT_KINDS) {
      const item = { kind, page: null, charCount: 1, excerpt: 'x' };
      expect(HiddenContentReport.safeParse({ ...hidden, items: [item] }).success).toBe(true);
    }
    const long = { kind: 'white_text', page: 1, charCount: 1, excerpt: 'x'.repeat(201) };
    expect(HiddenContentReport.safeParse({ ...hidden, items: [long] }).success).toBe(false);
  });
});

describe('KK-P19a-15: üretilmiş JSON Schema (013 §17.2, AS-0291)', () => {
  it('export/import şemaları $defs içinde ve DocAST yalnız $ref ile (çoğaltılmaz)', () => {
    const exp = JSON.parse(readFileSync(schemaPath('export'), 'utf8'));
    expect(Object.keys(exp.$defs).sort()).toEqual([
      'DocEngineError',
      'ExportReport',
      'ExportRequest',
      'ExportResult',
    ]);
    expect(exp.$defs.ExportRequest.properties.docAst).toEqual({ $ref: 'docast.schema.json' });
    expect(exp.$defs.ExportResult.properties.report).toEqual({ $ref: '#/$defs/ExportReport' });
    expect(exp.$defs.ExportRequest.properties.jobId.pattern).toBeUndefined();
    const imp = JSON.parse(readFileSync(schemaPath('import'), 'utf8'));
    expect(Object.keys(imp.$defs).sort()).toEqual([
      'HiddenContentReport',
      'ImportEngineReport',
      'ImportResult',
    ]);
    expect(JSON.stringify(imp)).not.toContain('"schemaVersion"');
  });
});
