// @tk TK-16
// Başsız şema, blok kimliği ve metin temizliği (054 §2, §3; KK-054-1, -2, -3, -6).
import { describe, expect, it } from 'vitest';
import { buildEditorExtensions } from '../../src/schema/extensions.ts';
import { getEditorSchema } from '../../src/schema/get-schema.ts';
import { BLOCK_ID_PATTERN, isBlockId, newBlockId } from '../../src/schema/ids.ts';
import { parseDocJson, parseSectionJson } from '../../src/schema/parse-doc.ts';
import { hasForbiddenChars, sanitizeText } from '../../src/schema/sanitize-text.ts';
import {
  citation,
  doc,
  fixture,
  heading,
  type Json,
  list,
  para,
  section,
  table,
  text,
} from '../helpers.ts';

const ok = (content: Json[]) => doc(section('b-7Q2K9D', 'generic', ...content));
const codes = (json: unknown) => parseDocJson(json).issues.map((i) => i.code);

describe('KK-P17a-1 KK-054-1: getEditorSchema DOM olmadan çalışır', () => {
  it('KK-P17a-1: Node ortamında document/window yok; kök section+; trailingNode kapalı', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    const schema = getEditorSchema();
    expect(schema.topNodeType.name).toBe('doc');
    expect(schema.topNodeType.spec.content).toBe('section+');
    const names = buildEditorExtensions({ headless: true }).flatMap((e) =>
      e.name === 'starterKit' ? [] : [e.name],
    );
    expect(names).not.toContain('trailingNode');
    expect(Object.keys(schema.nodes).sort()).toEqual(
      [
        'bulletList',
        'citation',
        'doc',
        'hardBreak',
        'heading',
        'listItem',
        'orderedList',
        'paragraph',
        'section',
        'table',
        'tableCell',
        'tableHeader',
        'tableRow',
        'text',
      ].sort(),
    );
    expect(Object.keys(schema.marks).sort()).toEqual(
      ['bold', 'italic', 'link', 'strike', 'underline'].sort(),
    );
  });

  it('KK-P17a-1: kökte paragraph yok; createAndFill section üretir, paragraph eklemez', () => {
    const schema = getEditorSchema();
    const filled = schema.topNodeType.createAndFill();
    expect(filled?.firstChild?.type.name).toBe('section');
    expect(filled?.childCount).toBe(1);
    expect(codes(doc(para(text('kökte paragraf'))))).toEqual(['schema.node_invalid']);
  });

  it('KK-P17a-1: fikstürler şemadan geçer', () => {
    for (const name of [
      'petition-minimal.json',
      'petition-full.json',
      'notice-generic.json',
      'table-heavy.json',
      'citations-all-statuses.json',
      'large-200-blocks.json',
    ]) {
      expect(parseDocJson(fixture(name)).issues, name).toEqual([]);
    }
  });

  it.each([
    ['blockquote düğümü', ok([{ type: 'blockquote', content: [para(text('a'))] }])],
    ['codeBlock düğümü', ok([{ type: 'codeBlock', content: [text('a')] }])],
    ['horizontalRule düğümü', ok([{ type: 'horizontalRule' }])],
    ['image düğümü', ok([para({ type: 'image', attrs: { src: 'x' } })])],
    ['code işareti', ok([para(text('a', 'code'))])],
    ['highlight işareti', ok([para(text('a', 'highlight'))])],
    ['textStyle işareti', ok([para(text('a', { type: 'textStyle', attrs: { color: 'red' } }))])],
    ['izin dışı paragraph özniteliği', ok([{ type: 'paragraph', attrs: { style: 'x' } }])],
    [
      'izin dışı link özniteliği',
      ok([para(text('a', { type: 'link', attrs: { href: 'https://a', target: '_blank' } }))]),
    ],
    ['geçersiz rol', doc({ ...section('b-7Q2K9D', 'docketSubject', para(text('a'))) })],
    [
      'geçersiz rev',
      doc({
        type: 'section',
        attrs: { blockId: 'b-7Q2K9D', rev: -1, role: 'generic' },
        content: [para()],
      }),
    ],
    ['geçersiz blockId biçimi', doc(section('b-7Q2K9I', 'generic', para(text('a'))))],
    ['geçersiz hizalama', ok([{ type: 'paragraph', attrs: { align: 'start' } }])],
    ['sayfa sonu düğümü', ok([{ type: 'pageBreak' }])],
  ])('KK-P17a-1 KK-054-1: %s reddedilir', (_name, json) => {
    const issues = parseDocJson(json).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(parseDocJson(json).doc).toBeNull();
    for (const i of issues)
      expect(['schema.node_invalid', 'schema.attr_invalid']).toContain(i.code);
  });

  it('KK-P17a-1: fromJSON içerik ifadesini doğrulamaz; check() zorunlu ve hata node_invalid', () => {
    const schema = getEditorSchema();
    const bad = doc({
      type: 'section',
      attrs: { blockId: 'b-7Q2K9D', rev: 0, role: 'generic' },
      content: [text('çıplak metin')],
    });
    expect(() => schema.nodeFromJSON(bad)).not.toThrow();
    expect(() => schema.nodeFromJSON(bad).check()).toThrow();
    expect(codes(bad)).toEqual(['schema.node_invalid']);
  });
});

describe('KK-P17a-1 KK-054-2: üst düzey yalnız section', () => {
  it('KK-054-2: boş belge, section içinde section ve liste içinde liste geçersiz', () => {
    expect(codes(doc())).toEqual(['schema.node_invalid']);
    expect(codes(ok([section('b-8R3M0E', 'generic', para(text('iç'))) as Json]))).toEqual([
      'schema.node_invalid',
    ]);
    const nested = ok([
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [para(text('a')), list(true, 'iç')] }],
      },
    ]);
    expect(codes(nested)).toEqual(['list.nested']);
  });

  it('KK-054-2: izinli tüm düğümler ve işaretler kabul edilir', () => {
    const json = ok([
      heading('BAŞLIK'),
      para(
        text('kalın', 'bold'),
        text('eğik', 'italic'),
        text('altı', 'underline'),
        text('üstü', 'strike'),
        { type: 'hardBreak' },
        text('bağ', { type: 'link', attrs: { href: 'https://example.org' } }),
        citation('0192f1c2-7a4b-7c3e-9d10-2b3c4d5e6f70', 'Örnek künye'),
      ),
      list(true, 'a'),
      list(false, 'b'),
      table(2, 2),
    ]);
    expect(parseDocJson(json).issues).toEqual([]);
  });

  it('citation düğümü atomdur; metin olarak raw serileştirilir, durum metne girmez', () => {
    const parsed = parseDocJson(
      ok([
        para(
          text('Bkz. '),
          citation('0192f1c2-7a4b-7c3e-9d10-2b3c4d5e6f70', 'Örnek künye', 'verified'),
        ),
      ]),
    );
    const node = parsed.doc;
    expect(node?.textContent).toBe('Bkz. Örnek künye');
    expect(node?.textBetween(0, node.content.size, '\n')).not.toContain('verified');
    const schema = getEditorSchema();
    expect(schema.nodes.citation?.isAtom).toBe(true);
    expect(schema.nodes.citation?.isInline).toBe(true);
  });

  it('parseSectionJson tek bloğu ayrıştırır ve yolu bloğa göre verir', () => {
    expect(parseSectionJson(section('b-7Q2K9D', 'generic', para(text('a')))).doc?.type.name).toBe(
      'section',
    );
    const bad = parseSectionJson(
      section('b-7Q2K9D', 'generic', { type: 'paragraph', attrs: { x: 1 } }),
    );
    expect(bad.issues[0]?.path).toBe('content.0.attrs.x');
  });
});

describe('KK-P17a-2 KK-054-3: blockId biçimi ve newBlockId', () => {
  it('KK-P17a-2: üretilen kimlik desene uyar ve Crockford alfabesindedir', () => {
    for (let i = 0; i < 500; i++) {
      const id = newBlockId();
      expect(id).toMatch(BLOCK_ID_PATTERN);
      expect(isBlockId(id)).toBe(true);
    }
    expect(isBlockId('b-ILOU00')).toBe(false);
    expect(isBlockId(42)).toBe(false);
  });

  it('KK-P17a-2: çakışmada yeniden üretir', () => {
    const sequence = [new Uint8Array([0, 0, 0, 0, 0, 0]), new Uint8Array([1, 2, 3, 4, 5, 6])];
    let call = 0;
    const rng = () => sequence[Math.min(call++, sequence.length - 1)] as Uint8Array;
    const id = newBlockId(new Set(['b-000000']), rng);
    expect(id).toBe('b-123456');
    expect(call).toBe(2);
  });

  it('KK-P17a-2: küme dolarsa hata verir (sonsuz döngü yok)', () => {
    expect(() => newBlockId(new Set(['b-000000']), () => new Uint8Array(6))).toThrow();
  });
});

describe('KK-P17a-3 KK-054-6: sanitizeText', () => {
  const hostile = fixture<{ cases: { name: string; input: string; expected: string }[] }>(
    'hostile-input.json',
  );

  it.each(hostile.cases.map((c) => [c.name, c] as const))('KK-P17a-3: %s', (_name, c) => {
    expect(sanitizeText(c.input)).toBe(c.expected);
    expect(hasForbiddenChars(sanitizeText(c.input))).toBe(false);
  });

  it('KK-P17a-3: ayrışık İ tek karaktere iner (NFC)', () => {
    const decomposed = 'I\u0307STANBUL';
    expect(decomposed.length).toBe(9);
    const out = sanitizeText(decomposed);
    expect(out).toBe('İSTANBUL');
    expect(out.length).toBe(8);
  });

  it('KK-P17a-3: NBSP korunur', () => {
    expect(sanitizeText('m.\u00A05')).toBe('m.\u00A05');
  });

  it('KK-P17a-3: sekme yalnız partiesGrid ve subjectLine rollerinde korunur', () => {
    expect(sanitizeText('DAVACI\t: A', { role: 'partiesGrid' })).toBe('DAVACI\t: A');
    expect(sanitizeText('KONU\t: B', { role: 'subjectLine' })).toBe('KONU\t: B');
    expect(sanitizeText('a\tb', { role: 'generic' })).toBe('a b');
    expect(sanitizeText('a\tb')).toBe('a b');
  });

  it('KK-P17a-3: tek satırlık düğümde satır sonu boşluğa çevrilir; idempotent', () => {
    expect(sanitizeText('a\nb', { singleLine: true })).toBe('a b');
    const once = sanitizeText('x\u200BI\u0307\u202Ey');
    expect(sanitizeText(once)).toBe(once);
  });
});
