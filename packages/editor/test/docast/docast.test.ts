// @tk TK-16
// DocAST dönüştürücüleri (054 §11; KK-054-22, KK-054-23).
import type { DocAstBlock, DocAstDocument, DocAstPara } from '@eda/contracts/docast';
import { DocAst } from '@eda/contracts/docast';
import { ImportReport } from '@eda/contracts/document-io';
import type { SectionRole } from '@eda/contracts/enums';
import { describe, expect, it } from 'vitest';
import { fromDocAst } from '../../src/docast/from-docast.ts';
import { ROLE_DEFAULTS } from '../../src/docast/role-defaults.ts';
import { DocAstError, type ToDocAstContext, toDocAst } from '../../src/docast/to-docast.ts';
import { parseDocJson } from '../../src/schema/parse-doc.ts';
import { hasErrors, validateDoc } from '../../src/validate/index.ts';
import { citation, doc, fixture, type Json, para, pm, section, text } from '../helpers.ts';

const UUID1 = '0192f1c2-7a4b-7c3e-9d10-2b3c4d5e6f01';

const ctx = (over: Partial<ToDocAstContext> = {}): ToDocAstContext => ({
  kind: 'petition',
  title: 'Örnek dava dilekçesi',
  citations: new Map([[UUID1, { kunyeText: 'Örnek künye (DB biçimi)' }]]),
  letterhead: null,
  includeLetterhead: false,
  ...over,
});

let seq = 0;
const ids = () => {
  seq = 0;
  return (existing: ReadonlySet<string>) => {
    let id: string;
    do {
      seq++;
      id = `b-${String(seq).padStart(6, '0')}`;
    } while (existing.has(id));
    return id;
  };
};

const paraOf = (t: string, align: DocAstPara['align'] = 'justify'): DocAstBlock => ({
  type: 'paragraph',
  align,
  indent: 'first_line',
  hangingMm: null,
  tabStopsMm: [],
  runs: [
    {
      kind: 'text',
      text: t,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      href: null,
    },
  ],
});
const headingOf = (t: string): DocAstBlock => ({
  type: 'heading',
  level: 1,
  align: 'left',
  runs: [
    {
      kind: 'text',
      text: t,
      bold: true,
      italic: false,
      underline: false,
      strike: false,
      href: null,
    },
  ],
});

function flat(blocks: DocAstBlock[], kind: DocAstDocument['kind'] = 'petition'): DocAstDocument {
  return DocAst.parse({
    schemaVersion: 1,
    kind,
    title: 'İçe aktarılan',
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
        id: 'b-000001',
        role: 'freeSection',
        blocks,
        layout: 'flow',
        boxWidthMm: null,
        keepTogether: false,
      },
    ],
  });
}

describe('KK-P17a-9 KK-054-22: toDocAst', () => {
  it('KK-P17a-9: deterministik (aynı girdi aynı bayt) ve DocAst şemasına uyar', () => {
    const a = JSON.stringify(toDocAst(pm(fixture('petition-full.json')), ctx()));
    const b = JSON.stringify(toDocAst(pm(fixture('petition-full.json')), ctx()));
    expect(a).toBe(b);
    expect(DocAst.safeParse(JSON.parse(a)).success).toBe(true);
  });

  it('KK-P17a-9: rol yerleşimleri 054 §11.3 tablosuyla', () => {
    const ast = toDocAst(pm(fixture('petition-full.json')), ctx());
    const byRole = new Map(ast.sections.map((s) => [s.role, s]));
    const sign = byRole.get('attorneySignature');
    expect([sign?.layout, sign?.boxWidthMm, sign?.keepTogether]).toEqual(['right_box', 70, true]);
    const ch = byRole.get('courtHeader')?.blocks[0];
    expect(ch?.type === 'paragraph' && [ch.align, ch.indent]).toEqual(['center', 'none']);
    const pg = byRole.get('partiesGrid')?.blocks[0];
    expect(pg?.type === 'paragraph' && [pg.indent, pg.hangingMm, pg.tabStopsMm]).toEqual([
      'hanging',
      30,
      [30],
    ]);
    const ne = byRole.get('numberedExplanations')?.blocks;
    expect(
      ne?.[0]?.type === 'heading' && [
        ne[0].align,
        ne[0].runs.every((r) => r.kind !== 'text' || r.bold),
      ],
    ).toEqual(['left', true]);
    const tbl = ne?.find((b) => b.type === 'table');
    expect(tbl?.type === 'table' && [tbl.borders, tbl.columnWidthsMm]).toEqual([
      'grid',
      [82.5, 82.5],
    ]);
    const body = ne?.find((b) => b.type === 'paragraph');
    expect(body?.type === 'paragraph' && [body.align, body.indent]).toEqual([
      'justify',
      'first_line',
    ]);
  });

  it('KK-P17a-9: atıf metni DB kaydından; kayıt yoksa raw; durum basılmaz', () => {
    const d = doc(
      section(
        'b-7Q2K9D',
        'generic',
        para(
          text('A '),
          citation(UUID1, 'ham künye', 'not_found'),
          text(' B '),
          citation('0192f1c2-7a4b-7c3e-9d10-2b3c4d5e6f02', 'ham künye 2', 'verified'),
        ),
      ),
    );
    const ast = toDocAst(pm(d), ctx());
    const json = JSON.stringify(ast);
    expect(json).toContain('Örnek künye (DB biçimi)');
    expect(json).toContain('ham künye 2');
    expect(json).not.toContain('ham künye"');
    for (const status of ['not_found', 'verified', 'pending']) expect(json).not.toContain(status);
  });

  it('KK-P17a-9 KK-054-22: e-imza ibaresi reddedilir (büyük İ dahil)', () => {
    const bad = ['(e-İmzalıdır)', 'e-imzalidir', 'Elektronik olarak imzalanmıştır.'];
    for (const phrase of bad) {
      const d = doc(
        section('b-7Q2K9D', 'attorneySignature', para(text('Davacı Vekili')), para(text(phrase))),
      );
      expect(() => toDocAst(pm(d), ctx()), phrase).toThrow(DocAstError);
      try {
        toDocAst(pm(d), ctx());
      } catch (e) {
        expect((e as DocAstError).issue.code).toBe('docast.forbidden_phrase');
        expect((e as DocAstError).issue.blockId).toBe('b-7Q2K9D');
      }
    }
    const ok = doc(section('b-7Q2K9D', 'attorneySignature', para(text('İmza – Kaşe'))));
    expect(() => toDocAst(pm(ok), ctx())).not.toThrow();
  });

  it('antet yalnız includeLetterhead ve enabled iken; boş satırlar atılır, en çok 8', () => {
    const letterhead = {
      enabled: true,
      firmName: 'Örnek Hukuk Bürosu',
      addressLines: ['Örnek Mah. 1', ''],
      phone: '0000',
      email: 'ornek@example.org',
      lines: ['a', 'b', 'c', 'd', 'e', 'f'],
    };
    const d = pm(fixture('petition-minimal.json'));
    expect(toDocAst(d, ctx({ letterhead, includeLetterhead: false })).header).toBeNull();
    expect(
      toDocAst(d, ctx({ letterhead: { ...letterhead, enabled: false }, includeLetterhead: true }))
        .header,
    ).toBeNull();
    const header = toDocAst(d, ctx({ letterhead, includeLetterhead: true })).header;
    expect(header?.lines).toEqual([
      'Örnek Hukuk Bürosu',
      'Örnek Mah. 1',
      'Tel: 0000 · E-posta: ornek@example.org',
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });
});

describe('KK-P17a-9 KK-054-23: fromDocAst', () => {
  const petitionFlow: DocAstBlock[] = [
    paraOf('ÖRNEK NÖBETÇİ ASLİYE HUKUK MAHKEMESİ’NE', 'center'),
    paraOf('DAVACI\t: Örnek Kişi A'),
    paraOf('VEKİLİ\t: Av. Örnek Avukat'),
    paraOf('DAVALI\t: Örnek Kişi B'),
    paraOf('KONU\t: Örnek konu.'),
    paraOf('Dava Değeri: [[Doldurulacak: değer]]'),
    paraOf('AÇIKLAMALAR', 'center'),
    paraOf('Örnek olay.'),
    paraOf('Davacı vekili şunu belirtir: örnek.'),
    headingOf('Hukuki Nedenler'),
    paraOf('Örnek dayanak.'),
    headingOf('DELİL LİSTESİ'),
    paraOf('Örnek belge.'),
    headingOf('NETİCE-İ TALEP'),
    paraOf('Örnek talep.'),
    paraOf('[[Doldurulacak: tarih]]', 'right'),
    headingOf('EKLER'),
    paraOf('Örnek ek.'),
    paraOf('Davacı Vekili', 'center'),
    paraOf('Av. Örnek Avukat', 'center'),
  ];

  it('KK-P17a-9 KK-054-23: rol tanıma tablosu (tam eşleşme) ve freeSection düşüşü', () => {
    const { doc: out, report } = fromDocAst(flat(petitionFlow), {
      kind: 'petition',
      newBlockId: ids(),
    });
    const sections = out.content ?? [];
    expect(sections.map((s) => s.attrs?.role)).toEqual([
      'courtHeader',
      'partiesGrid',
      'subjectLine',
      'numberedExplanations',
      'legalGrounds',
      'evidenceList',
      'resultAndRequest',
      'freeSection',
      'attorneySignature',
    ]);
    // Gövdedeki "Davacı vekili ...:" cümlesi taraf satırı sayılmaz; tarih satırı sonuç bölümünde kalır.
    expect(sections[3]?.content).toHaveLength(3);
    expect(sections[6]?.content).toHaveLength(3);
    expect(sections[3]?.content?.[0]?.type).toBe('heading');
    expect(report.recognizedRoles.map((r) => r.role)).toHaveLength(8);
    expect(report.freeSectionCount).toBe(1);
    expect(sections.every((s) => s.attrs?.rev === 1)).toBe(true);
    expect(ImportReport.safeParse(report).success).toBe(true);
    const parsed = parseDocJson(out);
    expect(parsed.issues).toEqual([]);
    expect(hasErrors(validateDoc(pm(out), { kind: 'petition', profile: 'user' }))).toBe(false);
  });

  it('KK-054-23: kısmi/benzer başlık eşleşmez; kind ≠ petition yalnız freeSection', () => {
    const { doc: partial } = fromDocAst(flat([headingOf('AÇIKLAMALAR VE EKLER'), paraOf('x')]), {
      kind: 'petition',
      newBlockId: ids(),
    });
    expect(partial.content?.map((s) => s.attrs?.role)).toEqual(['freeSection']);
    const { doc: memo, report } = fromDocAst(flat(petitionFlow, 'memo'), {
      kind: 'memo',
      newBlockId: ids(),
    });
    const roles = new Set(memo.content?.map((s) => s.attrs?.role));
    expect([...roles]).toEqual(['freeSection']);
    // Başlıkla ayrılan gruplar ayrı freeSection.
    expect(memo.content).toHaveLength(5);
    expect(report.recognizedRoles).toEqual([]);
  });

  it('KK-054-23: gizli içerik doc-engine raporundan sayılır; görünmez karakterler temizlenir', () => {
    const { doc: out, report } = fromDocAst(
      flat([paraOf('Gizli\u200B \u202Emetin\u202C')], 'free'),
      {
        kind: 'free',
        newBlockId: ids(),
        engineReport: {
          hiddenContentSkipped: 3,
          droppedFeatures: [{ feature: 'image', count: 2 }],
          warnings: [],
        },
      },
    );
    expect(report.hiddenContentSkipped).toBe(3);
    expect(report.droppedFeatures).toEqual([{ feature: 'image', count: 2 }]);
    expect(JSON.stringify(out)).toContain('Gizli metin');
    expect(parseDocJson(out).issues).toEqual([]);
  });

  it('KK-054-23: desteklenmeyen yapı metin korunarak paragrafa iner; geçersiz bağlantı düşer', () => {
    const wide: DocAstBlock = {
      type: 'table',
      borders: 'grid',
      columnWidthsMm: Array.from({ length: 9 }, () => 10),
      rows: [
        {
          cells: Array.from({ length: 9 }, (_v, i) => ({
            header: false,
            paragraphs: [
              {
                align: 'left' as const,
                runs: [
                  {
                    kind: 'text' as const,
                    text: `h${i}`,
                    bold: false,
                    italic: false,
                    underline: false,
                    strike: false,
                    href: null,
                  },
                ],
              },
            ],
          })),
        },
      ],
    };
    const link: DocAstBlock = {
      ...(paraOf('bağlantı') as DocAstBlock & { type: 'paragraph' }),
      runs: [
        {
          kind: 'text',
          text: 'bağlantı',
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          href: 'javascript:alert(1)',
        },
      ],
    };
    const { doc: out, report } = fromDocAst(flat([wide, link], 'free'), {
      kind: 'free',
      newBlockId: ids(),
    });
    const json = JSON.stringify(out);
    for (let i = 0; i < 9; i++) expect(json).toContain(`h${i}`);
    expect(json).not.toContain('javascript:');
    expect(report.droppedFeatures).toEqual([
      { feature: 'link_protocol', count: 1 },
      { feature: 'table_over_limit', count: 1 },
    ]);
    expect(parseDocJson(out).issues).toEqual([]);
  });

  it('künye adayları yalnız today verilince sayılır; boş akış tek freeSection', () => {
    const { report } = fromDocAst(flat([paraOf('Metin')], 'free'), {
      kind: 'free',
      newBlockId: ids(),
    });
    expect(report.citationCandidates).toBe(0);
    const empty = fromDocAst(flat([], 'free'), { kind: 'free', newBlockId: ids() });
    expect(empty.doc.content?.map((s) => s.attrs?.role)).toEqual(['freeSection']);
    expect(parseDocJson(empty.doc).issues).toEqual([]);
  });
});

// ---------- Gidiş-dönüş denkliği (054 §11.5) ----------

type Node = { type: string; attrs?: Json; content?: Node[]; text?: string; marks?: Json[] };

function normalize(json: unknown, citations: ReadonlyMap<string, { kunyeText: string }>): unknown {
  const parsed = parseDocJson(json);
  if (parsed.doc === null) throw new Error('şema hatası');
  const root = parsed.doc.toJSON() as Node;
  const walk = (n: Node, role: SectionRole | null): Node => {
    const r = n.type === 'section' ? ((n.attrs?.role as SectionRole) ?? null) : role;
    const out: Node = { type: n.type };
    if (n.type === 'citation') {
      const id = n.attrs?.citationId as string;
      return {
        type: 'text',
        text: citations.get(id)?.kunyeText ?? String(n.attrs?.raw),
        ...(n.marks ? { marks: n.marks } : {}),
      };
    }
    if (n.text !== undefined) out.text = n.text.replace(/ {2,}/g, ' ');
    if (n.marks !== undefined && n.type === 'text') out.marks = n.marks;
    if (n.attrs !== undefined) {
      const attrs: Json = { ...n.attrs };
      delete attrs.rev;
      delete attrs.blockId;
      delete attrs.colwidth;
      if (n.type === 'section' && attrs.role === 'generic') attrs.role = 'freeSection';
      if (n.type === 'paragraph' && attrs.align === null && r !== null)
        attrs.align = ROLE_DEFAULTS[r].align;
      out.attrs = attrs;
    }
    if (n.content !== undefined) {
      const kids = n.content.map((c) => walk(c, r));
      const merged: Node[] = [];
      for (const k of kids) {
        const last = merged.at(-1);
        if (
          last?.type === 'text' &&
          k.type === 'text' &&
          JSON.stringify(last.marks) === JSON.stringify(k.marks)
        ) {
          last.text = `${last.text ?? ''}${k.text ?? ''}`.replace(/ {2,}/g, ' ');
        } else {
          merged.push({ ...k });
        }
      }
      out.content = merged;
    }
    if (n.type === 'heading') {
      out.content = out.content?.map((c) => {
        const marks = c.marks?.filter((m) => m.type !== 'bold');
        const { marks: _m, ...rest } = c;
        return marks !== undefined && marks.length > 0 ? { ...rest, marks } : rest;
      });
    }
    return out;
  };
  return walk(root, null);
}

describe('KK-P17a-9 KK-054-22: gidiş-dönüş denkliği (054 §11.5)', () => {
  it.each(['petition-full.json', 'petition-minimal.json'])(
    'KK-P17a-9: %s -> toDocAst -> fromDocAst normalleştirilmiş eşit',
    (name) => {
      const c = ctx();
      const original = fixture(name);
      const ast = toDocAst(pm(original), c);
      const back = fromDocAst(ast, { kind: 'petition', newBlockId: ids() }).doc;
      expect(normalize(back, c.citations)).toEqual(normalize(original, c.citations));
    },
  );

  it('KK-P17a-9: notice gidiş-dönüşte yalnız freeSection, metin kaybı yok', () => {
    const c = ctx({ kind: 'notice' });
    const original = fixture('notice-generic.json');
    const back = fromDocAst(toDocAst(pm(original), c), { kind: 'notice', newBlockId: ids() }).doc;
    expect(pm(back).textContent.replace(/\s+/g, ' ')).toBe(
      pm(original).textContent.replace(/\s+/g, ' ').replace(/\t/g, ' '),
    );
  });
});
