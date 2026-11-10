// @tk TK-16
// Rol doğrulayıcıları, sınırlar ve profiller (054 §4; KK-054-5).
import { describe, expect, it } from 'vitest';
import {
  hasErrors,
  schemaInvalidReason,
  validateDoc,
  validateDocJson,
  validateSection,
} from '../../src/validate/index.ts';
import {
  citation,
  doc,
  fixture,
  heading,
  type Json,
  list,
  para,
  pm,
  section,
  table,
  text,
} from '../helpers.ts';

const ID = 'b-7Q2K9D';
const UUID = '0192f1c2-7a4b-7c3e-9d10-2b3c4d5e6f70';

function sectionIssues(role: string, content: Json[], profile: 'user' | 'model' = 'user') {
  const node = pm(doc(section(ID, role, ...content))).firstChild;
  if (node === null) throw new Error('section yok');
  return validateSection(node, { profile });
}
const errorCodes = (role: string, content: Json[], profile: 'user' | 'model' = 'user') =>
  sectionIssues(role, content, profile)
    .filter((i) => i.severity === 'error')
    .map((i) => i.code);

const P = (s = 'Metin.') => para(text(s));

// Rol başına bir geçerli ve en az bir geçersiz vaka (054 §4.2).
const CASES: readonly [string, Json[], Json[], string][] = [
  ['courtHeader', [P('ÖRNEK MAHKEMESİ’NE')], [P(), P(), P(), P(), P()], 'role.count'],
  ['courtHeader', [P()], [para(text('a', 'italic'))], 'role.mark_not_allowed'],
  ['partiesGrid', [para(text('DAVACI\t: A'))], [list(true, 'a')], 'role.child_not_allowed'],
  ['partiesGrid', [P()], Array.from({ length: 21 }, () => P()), 'role.count'],
  ['subjectLine', [para(text('KONU\t: A'))], [heading('KONU')], 'role.child_not_allowed'],
  [
    'numberedExplanations',
    [heading('AÇIKLAMALAR'), list(true, 'a'), table(2, 2)],
    [P(), heading('X')],
    'heading.not_first',
  ],
  ['numberedExplanations', [P()], [list(false, 'a')], 'role.child_not_allowed'],
  [
    'legalGrounds',
    [heading('HUKUKİ SEBEPLER'), P(), list(false, 'a'), list(true, 'b')],
    [table(2, 2)],
    'role.child_not_allowed',
  ],
  [
    'evidenceList',
    [heading('DELİLLER'), list(true, 'a'), P()],
    [list(false, 'a')],
    'role.child_not_allowed',
  ],
  [
    'resultAndRequest',
    [heading('SONUÇ VE İSTEM'), P(), list(true, 'a')],
    [table(2, 2)],
    'role.child_not_allowed',
  ],
  [
    'attorneySignature',
    [P('Davacı Vekili'), P('Av. Örnek')],
    [para(text('a', { type: 'link', attrs: { href: 'https://example.org' } }))],
    'role.mark_not_allowed',
  ],
  ['attorneySignature', [P()], Array.from({ length: 7 }, () => P()), 'role.count'],
  [
    'generic',
    [P(), heading('ARA BAŞLIK'), table(2, 2), list(false, 'a')],
    [table(41, 2)],
    'table.limit',
  ],
  ['freeSection', [heading('X'), P(), heading('Y')], [table(2, 9)], 'table.limit'],
];

describe('KK-P17a-4 KK-054-5: rol kuralları (user profili)', () => {
  it.each(CASES)('KK-P17a-4: %s geçerli vaka hatasız', (role, valid) => {
    expect(errorCodes(role, valid)).toEqual([]);
  });

  it.each(CASES)('KK-P17a-4: %s geçersiz vaka beklenen kodu üretir', (role, _v, invalid, code) => {
    expect(errorCodes(role, invalid)).toContain(code);
  });

  it('KK-P17a-4: 10 rolün her biri kapsanır', () => {
    expect(new Set(CASES.map((c) => c[0])).size).toBe(10);
  });
});

describe('KK-P17a-4 KK-054-5: model profili daha dardır', () => {
  it('deterministik roller model profilinde reddedilir', () => {
    expect(errorCodes('partiesGrid', [P()], 'model')).toContain('role.model_forbidden');
    expect(errorCodes('attorneySignature', [P()], 'model')).toContain('role.model_forbidden');
    expect(errorCodes('partiesGrid', [P()], 'user')).toEqual([]);
  });

  it.each([
    ['numberedExplanations', [table(2, 2)]],
    ['legalGrounds', [list(true, 'a')]],
    ['evidenceList', [P()]],
  ] as const)('%s: user izinli, model reddeder', (role, content) => {
    expect(errorCodes(role, [...content], 'user')).toEqual([]);
    expect(errorCodes(role, [...content], 'model')).toContain('role.child_not_allowed');
  });
});

describe('KK-P17a-4: genel kurallar', () => {
  it('citation.missing_id, link.protocol, text.forbidden_char hata', () => {
    expect(errorCodes('generic', [para(citation(null, 'Örnek'))])).toEqual(['citation.missing_id']);
    expect(errorCodes('generic', [para(citation(UUID, ' '))])).toEqual(['citation.missing_id']);
    expect(
      errorCodes('generic', [
        para(text('a', { type: 'link', attrs: { href: 'javascript:alert(1)' } })),
      ]),
    ).toEqual(['link.protocol']);
    expect(
      errorCodes('generic', [
        para(text('a', { type: 'link', attrs: { href: 'mailto:a@example.org' } })),
      ]),
    ).toEqual([]);
    expect(errorCodes('generic', [para(text('gizli\u200Bkarakter'))])).toEqual([
      'text.forbidden_char',
    ]);
  });

  it('sekme yalnız partiesGrid/subjectLine dışında uyarı', () => {
    const issues = sectionIssues('generic', [para(text('a\tb'))]);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['text.tab_not_allowed', 'warning']]);
    expect(sectionIssues('partiesGrid', [para(text('DAVACI\t: A'))])).toEqual([]);
  });

  it('birleşik hücre ve geçersiz başlık düzeyi hata', () => {
    const merged = table(2, 2);
    const rows = merged.content as Json[];
    const firstRow = rows[0] as Json;
    const cells = firstRow.content as Json[];
    cells[0] = { ...(cells[0] as Json), attrs: { colspan: 2, rowspan: 1, colwidth: null } };
    expect(errorCodes('generic', [merged])).toEqual(['table.merged_cell']);
    expect(errorCodes('generic', [heading('X', 3)])).toEqual(['schema.attr_invalid']);
  });

  it('section.empty ve placeholder.unfilled uyarıdır', () => {
    const empty = sectionIssues('generic', [para()]);
    expect(empty.map((i) => [i.code, i.severity])).toEqual([['section.empty', 'warning']]);
    const ph = sectionIssues('resultAndRequest', [P('[[Doldurulacak: tarih]]')]);
    expect(ph.map((i) => [i.code, i.severity])).toEqual([['placeholder.unfilled', 'warning']]);
    expect(sectionIssues('generic', [P('[[Doldurulacak]]')])).toEqual([]);
  });
});

describe('KK-P17a-4 KK-054-5: belge düzeyi', () => {
  it('petition-minimal ve petition-full hatasız', () => {
    for (const name of ['petition-minimal.json', 'petition-full.json', 'notice-generic.json']) {
      const issues = validateDoc(pm(fixture(name)), { kind: 'petition', profile: 'user' });
      expect(hasErrors(issues), name).toBe(false);
    }
  });

  it('blockId.duplicate ve blockId.missing hata', () => {
    const dup = pm(doc(section(ID, 'generic', P()), section(ID, 'generic', P())));
    expect(validateDoc(dup, { kind: 'free', profile: 'user' }).map((i) => i.code)).toEqual([
      'blockId.duplicate',
    ]);
    const missing = pm(
      doc({ type: 'section', attrs: { rev: 0, role: 'generic' }, content: [P()] }),
    );
    expect(validateDoc(missing, { kind: 'free', profile: 'user' }).map((i) => i.code)).toEqual([
      'blockId.missing',
    ]);
  });

  it('sıra ve tekil rol uyarıları', () => {
    const d = pm(
      doc(
        section('b-0000A1', 'generic', P()),
        section('b-0000A2', 'courtHeader', P()),
        section('b-0000A3', 'attorneySignature', P()),
        section('b-0000A4', 'courtHeader', P()),
      ),
    );
    const issues = validateDoc(d, { kind: 'petition', profile: 'user' });
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(issues.map((i) => i.code).sort()).toEqual(
      ['order.court_header_not_first', 'order.signature_not_last', 'role.duplicate'].sort(),
    );
    const notice = validateDoc(d, { kind: 'notice', profile: 'user' }).map((i) => i.code);
    expect(notice).not.toContain('order.court_header_not_first');
  });

  it('editor.maxBlocks sınırı: 200 blok geçer, 201 blok block_limit', () => {
    const big = fixture<{ type: string; content: Json[] }>('large-200-blocks.json');
    expect(hasErrors(validateDoc(pm(big), { kind: 'free', profile: 'user' }))).toBe(false);
    const over = { ...big, content: [...big.content, section('b-ZZZZZZ', 'generic', P())] };
    const issues = validateDoc(pm(over), { kind: 'free', profile: 'user' });
    expect(issues.map((i) => i.code)).toEqual(['limit.block_count']);
    expect(schemaInvalidReason(issues)).toBe('block_limit');
  });

  it('editor.maxDraftBytes sınırı: size_limit', () => {
    const d = fixture('petition-minimal.json');
    const r = validateDocJson(d, {
      kind: 'petition',
      profile: 'user',
      limits: { maxDraftBytes: 100 },
    });
    expect(r.doc).toBeNull();
    expect(r.issues.map((i) => i.code)).toEqual(['limit.draft_bytes']);
    expect(schemaInvalidReason(r.issues)).toBe('size_limit');
    const within = validateDoc(pm(d), {
      kind: 'petition',
      profile: 'user',
      limits: { maxDraftBytes: 100 },
    });
    expect(within.map((i) => i.code)).toContain('limit.draft_bytes');
  });

  it('DOC_SCHEMA_INVALID reason eşlemesi: role_rule, node_invalid; uyarı tek başına null', () => {
    const roleErr = validateDocJson(doc(section(ID, 'partiesGrid', list(true, 'a'))), {
      kind: 'petition',
      profile: 'user',
    });
    expect(schemaInvalidReason(roleErr.issues)).toBe('role_rule');
    const nodeErr = validateDocJson(doc(section(ID, 'generic', { type: 'image' })), {
      kind: 'petition',
      profile: 'user',
    });
    expect(schemaInvalidReason(nodeErr.issues)).toBe('node_invalid');
    const warnOnly = validateDocJson(doc(section(ID, 'generic', para())), {
      kind: 'free',
      profile: 'user',
    });
    expect(warnOnly.issues.map((i) => i.code)).toEqual(['section.empty']);
    expect(schemaInvalidReason(warnOnly.issues)).toBeNull();
  });

  it('hostile-input belgesi: gizli karakter hatası', () => {
    const h = fixture<{ doc: Json }>('hostile-input.json');
    const r = validateDocJson(h.doc, { kind: 'free', profile: 'user' });
    expect(r.issues.map((i) => i.code)).toContain('text.forbidden_char');
  });
});
