// @tk TK-16
// P17a belge sözleşmeleri: DocAST, EditOp, taslak/kabul/öneri/fark/içe aktarma gövdeleri, alt tür
// kataloğu ve unsur matrisi (054 §6.1, §7, §8.5, §9.2, §11; 080 §1.3, §1.4, §3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONFIG_ADMIN_EDITABLE, CONFIG_DEFAULTS } from '../src/config/defaults.ts';
import { DocAst } from '../src/docast.ts';
import {
  AcceptRequest,
  AcceptResponse,
  DraftSaveRequest,
  DraftSaveResponse,
  EditorIssue,
  ImportReport,
  RejectRequest,
  SuggestionRequest,
  VersionDiffResponse,
} from '../src/document-io.ts';
import { EditOpSchema } from '../src/edit-ops.ts';
import { BLOCK_ID_PATTERN, TipTapDoc, TipTapSection } from '../src/editor-doc.ts';
import { DOCUMENT_KINDS, DOCUMENT_SUBTYPES, EDIT_OP_TYPES } from '../src/enums.ts';
import { ERROR_CATALOG } from '../src/errors/index.ts';
import {
  ELEMENT_ROLES,
  PETITION_CATALOG,
  PETITION_ELEMENT_MATRIX,
  PETITION_SUBTYPES,
  SUBTYPE_ALIASES,
} from '../src/legal/petition-types.ts';

const UUID = '0192f1c2-7a4b-7c3e-9d10-2b3c4d5e6f70';
const section = (blockId: string, role = 'generic') => ({
  type: 'section',
  attrs: { blockId, rev: 1, role },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Örnek metin.' }] }],
});

const validDocAst = {
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
  sections: [
    {
      id: 'b-7Q2K9D',
      role: 'generic',
      layout: 'flow',
      boxWidthMm: null,
      keepTogether: false,
      blocks: [
        {
          type: 'paragraph',
          align: 'justify',
          indent: 'first_line',
          hangingMm: null,
          tabStopsMm: [],
          runs: [
            {
              kind: 'text',
              text: 'Örnek',
              bold: false,
              italic: false,
              underline: false,
              strike: false,
              href: null,
            },
            { kind: 'break' },
          ],
        },
        { type: 'heading', level: 1, align: 'left', runs: [] },
        { type: 'list', ordered: true, start: 1, items: [{ paragraphs: [] }] },
        {
          type: 'table',
          borders: 'grid',
          columnWidthsMm: [82.5, 82.5],
          rows: [{ cells: [{ header: true, paragraphs: [{ align: 'left', runs: [] }] }] }],
        },
      ],
    },
  ],
};

describe('KK-P17a-10 KK-054-22: DocAST şeması', () => {
  it('KK-P17a-10: geçerli örnek ayrıştırılır; sabit sayfa/tipografi dışı değer reddedilir', () => {
    expect(DocAst.safeParse(validDocAst).success).toBe(true);
    const wrongMargin = structuredClone(validDocAst);
    wrongMargin.page.marginsMm.left = 30;
    expect(DocAst.safeParse(wrongMargin).success).toBe(false);
    const extra = { ...validDocAst, watermark: 'x' };
    expect(DocAst.safeParse(extra).success).toBe(false);
  });

  it('KK-P17a-10: JSON Schema özyinelemesiz ($ref/$defs yok) ve iki üretim aynı', () => {
    const a = JSON.stringify(z.toJSONSchema(DocAst, { target: 'draft-2020-12' }));
    const b = JSON.stringify(z.toJSONSchema(DocAst, { target: 'draft-2020-12' }));
    expect(a).toBe(b);
    const committed = readFileSync(
      join(import.meta.dirname, '..', 'generated', 'json-schema', 'docast.schema.json'),
      'utf8',
    );
    expect(committed).not.toMatch(/"\$ref"|"\$defs"/);
    expect(JSON.parse(committed).title).toBe('DocAst');
    expect(JSON.parse(committed).properties.kind.enum).toEqual([...DOCUMENT_KINDS]);
  });
});

describe('KK-P17a-3: EditOp (054 §6.1)', () => {
  const base = {
    opId: 'op-1',
    blockId: 'b-7Q2K9D',
    blockRev: 1,
    reason: 'Kısaltma',
    citationIds: [],
    opStatus: 'pending',
  };

  it('dört op türü EDIT_OP_TYPES ile aynı ve her biri ayrıştırılır', () => {
    const ops = [
      { ...base, type: 'replace_block', content: section('b-7Q2K9D') },
      { ...base, type: 'insert_after', role: 'generic', content: section('b-8R3M0E') },
      { ...base, type: 'delete_block' },
      { ...base, type: 'replace_text', find: 'eski', replace: 'yeni', occurrence: 1 },
    ];
    expect(ops.map((o) => EditOpSchema.parse(o).type)).toEqual([...EDIT_OP_TYPES]);
  });

  it('RFC 6902 biçimi ve geçersiz blockId/blockRev reddedilir', () => {
    expect(EditOpSchema.safeParse({ op: 'replace', path: '/blocks/0', value: {} }).success).toBe(
      false,
    );
    expect(EditOpSchema.safeParse({ ...base, type: 'delete_block', blockRev: 0 }).success).toBe(
      false,
    );
    expect(
      EditOpSchema.safeParse({ ...base, type: 'delete_block', blockId: 'b-7Q2K9I' }).success,
    ).toBe(false);
    expect(
      EditOpSchema.safeParse({
        ...base,
        type: 'replace_text',
        find: '',
        replace: 'x',
        occurrence: 1,
      }).success,
    ).toBe(false);
  });

  it('blockId deseni Crockford base32 (I, L, O, U yok)', () => {
    expect(BLOCK_ID_PATTERN.test('b-7Q2K9D')).toBe(true);
    for (const bad of ['b-7Q2K9', 'b-7Q2K9DD', 'b-7q2k9d', 'b-ILOU00', 'x-7Q2K9D']) {
      expect(BLOCK_ID_PATTERN.test(bad), bad).toBe(false);
    }
  });
});

describe('KK-P17a-3: belge giriş/çıkış gövdeleri', () => {
  it('TipTapDoc gevşek; TipTapSection zorunlu öznitelikleri ister, fazlası korunur', () => {
    expect(TipTapDoc.parse({ type: 'doc', content: [1] }).content).toEqual([1]);
    expect(TipTapSection.safeParse({ ...section('b-7Q2K9D'), content: [] }).success).toBe(false);
    const loose = TipTapSection.parse({
      ...section('b-7Q2K9D'),
      attrs: { blockId: 'b-7Q2K9D', rev: 0, role: 'generic', extra: 1 },
    });
    expect(loose.attrs).toHaveProperty('extra', 1);
  });

  it('DraftSaveRequest/Response (054 §9.2)', () => {
    expect(
      DraftSaveRequest.parse({
        baseVersion: 3,
        draft: { type: 'doc', content: [section('b-7Q2K9D')] },
        clientSeq: 7,
        reason: 'autosave',
      }).reason,
    ).toBe('autosave');
    expect(
      DraftSaveRequest.safeParse({ baseVersion: 3, draft: {}, clientSeq: 1, reason: 'x' }).success,
    ).toBe(false);
    const res = DraftSaveResponse.parse({
      draftRev: 4,
      savedAt: '2026-10-11T10:00:00+03:00',
      blockRevs: { 'b-7Q2K9D': 2 },
      citations: [
        { citationId: UUID, status: 'pending', blocking: 'soft', shortKunye: null, reason: null },
      ],
      warnings: [
        {
          code: 'section.empty',
          severity: 'warning',
          blockId: 'b-7Q2K9D',
          path: 'content.0',
          message: 'Bölüm boş.',
        },
      ],
      versionCreated: { versionNo: 2, trigger: 'session_end' },
    });
    expect(res.versionCreated?.trigger).toBe('session_end');
    expect(EditorIssue.safeParse({ ...res.warnings[0], code: 'x' }).success).toBe(false);
  });

  it('AcceptRequest/Response ve RejectRequest (054 §7.1)', () => {
    expect(AcceptRequest.parse({ baseVersion: 3, opIds: null }).opIds).toBeNull();
    expect(AcceptRequest.safeParse({ baseVersion: 3, opIds: [] }).success).toBe(false);
    expect(RejectRequest.parse({ opIds: ['op-1'] }).opIds).toEqual(['op-1']);
    const res = AcceptResponse.parse({
      draftRev: 5,
      version: { id: UUID, versionNo: 3 },
      applied: ['op-1'],
      stale: [],
      invalid: [{ opId: 'op-2', reason: 'conflicting_ops' }],
      changedBlocks: [{ blockId: 'b-7Q2K9D', rev: 2, node: section('b-7Q2K9D') }],
      removedBlockIds: [],
      order: ['b-7Q2K9D'],
      blockRevs: { 'b-7Q2K9D': 2 },
    });
    expect(res.invalid[0]?.reason).toBe('conflicting_ops');
  });

  it('SuggestionRequest: seçim üst sınırı editor.selectionMaxChars; refresh_from_records korumalı rollerle sınırlı', () => {
    const max = CONFIG_DEFAULTS['editor.selectionMaxChars'];
    const rewrite = {
      intent: 'rewrite',
      baseVersion: 1,
      blockId: 'b-7Q2K9D',
      blockRev: 1,
      selection: { text: 'a'.repeat(max), occurrence: 1 },
      note: null,
    };
    expect(SuggestionRequest.safeParse(rewrite).success).toBe(true);
    expect(
      SuggestionRequest.safeParse({
        ...rewrite,
        selection: { text: 'a'.repeat(max + 1), occurrence: 1 },
      }).success,
    ).toBe(false);
    const refresh = {
      intent: 'refresh_from_records',
      baseVersion: 1,
      role: 'partiesGrid',
      blockId: 'b-7Q2K9D',
      mode: 'replace',
    };
    expect(SuggestionRequest.safeParse(refresh).success).toBe(true);
    expect(SuggestionRequest.safeParse({ ...refresh, role: 'courtHeader' }).success).toBe(false);
  });

  it('VersionDiffResponse ve ImportReport', () => {
    expect(
      VersionDiffResponse.parse({
        from: { versionNo: null, createdAt: '2026-10-11T10:00:00Z' },
        to: { versionNo: 2, createdAt: '2026-10-11T11:00:00Z' },
        blocks: [
          { blockId: 'b-7Q2K9D', role: 'generic', change: 'moved', fromIndex: 0, toIndex: 1 },
        ],
        unchangedCount: 3,
      }).blocks[0]?.change,
    ).toBe('moved');
    expect(
      ImportReport.parse({
        recognizedRoles: [{ role: 'courtHeader', blockId: 'b-7Q2K9D' }],
        freeSectionCount: 1,
        hiddenContentSkipped: 0,
        droppedFeatures: [{ feature: 'image', count: 2 }],
        citationCandidates: 0,
        warnings: [],
      }).freeSectionCount,
    ).toBe(1);
  });
});

describe('KK-P17a-6 KK-080-1 KK-080-2: alt tür kataloğu ve unsur matrisi', () => {
  it('KK-P17a-6 KK-080-1: katalog 22 kod ve DOCUMENT_SUBTYPES ile aynı sırada eşit', () => {
    expect(PETITION_CATALOG).toHaveLength(22);
    expect(PETITION_CATALOG.map((e) => e.code)).toEqual([...DOCUMENT_SUBTYPES]);
    expect(Object.keys(SUBTYPE_ALIASES).sort()).toEqual([...DOCUMENT_SUBTYPES].sort());
  });

  it('KK-P17a-6 KK-080-1: katalog ve takma adlarda mülga HMK hükmüne dayalı tür yok', () => {
    const banned = /belirsiz\s+alacak|indeterminate/i;
    expect(JSON.stringify(PETITION_CATALOG)).not.toMatch(banned);
    expect(JSON.stringify(SUBTYPE_ALIASES)).not.toMatch(banned);
  });

  it('KK-080-1: 13 platform şablonu; takma adlar katlanmış ASCII biçimde', () => {
    const slugs = new Set(PETITION_CATALOG.flatMap((e) => e.templates.map((t) => t.slug)));
    expect(slugs.size).toBe(13);
    for (const aliases of Object.values(SUBTYPE_ALIASES)) {
      expect(aliases.length).toBeGreaterThan(0);
      for (const a of aliases) expect(a.folded).toMatch(/^[a-z ]+$/);
    }
  });

  it('KK-080-2: matris 19 dilekçe alt türü x 8 rol, eksik hücre yok, değerler Z/K/Y', () => {
    expect(Object.keys(PETITION_ELEMENT_MATRIX).sort()).toEqual([...PETITION_SUBTYPES].sort());
    expect(PETITION_SUBTYPES).toHaveLength(19);
    const petitionCodes = PETITION_CATALOG.filter((e) => e.kind === 'petition').map((e) => e.code);
    expect([...PETITION_SUBTYPES]).toEqual(petitionCodes);
    for (const row of Object.values(PETITION_ELEMENT_MATRIX)) {
      expect(Object.keys(row)).toEqual([...ELEMENT_ROLES]);
      for (const cell of Object.values(row)) expect(['Z', 'K', 'Y']).toContain(cell);
    }
    expect(PETITION_ELEMENT_MATRIX.claim.evidenceList).toBe('Z');
    expect(PETITION_ELEMENT_MATRIX.answer.evidenceList).toBe('K');
    expect(PETITION_ELEMENT_MATRIX.excuse.partiesGrid).toBe('K');
  });
});

describe('KK-P17a-12 KK-054-30: editor.* anahtarları ve DOC_ hata nedenleri', () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures', 'canon-config.json'), 'utf8'),
  ) as Record<string, { default: unknown; adminEditable: boolean }>;

  it.each([
    ['editor.maxBlocks', 200],
    ['editor.maxDraftBytes', 1500000],
    ['editor.pasteMaxChars', 200000],
    ['editor.selectionMaxChars', 4000],
    ['editor.inlineDiffMaxChars', 20000],
    ['editor.diffTimeoutMs', 200],
    ['editor.autosaveRetryMax', 5],
    ['citations.editorPollMs', 3000],
  ] as const)('KK-P17a-12: %s = %s, Admin H, fixture anlık görüntüsünde', (key, value) => {
    expect(CONFIG_DEFAULTS[key]).toBe(value);
    expect(fixture[key]).toEqual({ default: value, adminEditable: false });
    expect(CONFIG_ADMIN_EDITABLE.has(key)).toBe(false);
  });

  it('KK-P17a-3: DOC_SCHEMA_INVALID ve DOC_LOCKED nedenleri katalogda', () => {
    expect([...(ERROR_CATALOG.DOC_SCHEMA_INVALID.reasons ?? [])].sort()).toEqual(
      ['block_limit', 'node_invalid', 'role_rule', 'size_limit'].sort(),
    );
    expect([...(ERROR_CATALOG.DOC_LOCKED.reasons ?? [])].sort()).toEqual(
      ['archived', 'generation_in_progress', 'status_locked'].sort(),
    );
    expect(ERROR_CATALOG.DOC_NOT_FOUND.http).toBe(404);
    expect(ERROR_CATALOG.DOC_DELETE_BLOCKED.http).toBe(409);
  });
});
