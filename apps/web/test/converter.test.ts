// Dönüştürücü: UDF ve DOCX yazıcı çıktıları okuyucudan aynı bloklarla geri gelir (gidiş-dönüş).
import { describe, expect, it } from 'vitest';
import { blocksToHtml } from '../src/features/converter/blocks-html.ts';
import { readDocx } from '../src/features/converter/docx-reader.ts';
import {
  buildUdfBytes,
  buildUdfXml,
  parseUdfXml,
  readUdf,
} from '../src/features/converter/udf-codec.ts';
import { parseXml } from '../src/features/converter/xml-lite.ts';
import { zipNames } from '../src/features/converter/zip-reader.ts';
import type { Block } from '../src/features/studio/doc-convert.ts';
import { buildDocxBytes } from '../src/features/studio/docx-writer.ts';

const BLOCKS: Block[] = [
  { kind: 'p', align: 'center', runs: [{ text: 'KİRA BEDELİNİN TESPİTİ', marks: ['bold'] }] },
  {
    kind: 'p',
    align: null,
    runs: [
      { text: 'DAVACI', marks: ['bold'] },
      { text: '\t: Ahmet "Yılmaz" & <Ortakları> \u{1D49C}', marks: [] },
    ],
  },
  { kind: 'p', align: 'right', runs: [{ text: 'sağa dayalı', marks: ['italic', 'underline'] }] },
  { kind: 'li', ordered: true, index: 1, runs: [{ text: 'birinci', marks: [] }] },
  { kind: 'li', ordered: true, index: 2, runs: [{ text: 'ikinci', marks: [] }] },
  { kind: 'li', ordered: false, index: 0, runs: [{ text: 'madde', marks: [] }] },
];

const text = (blocks: readonly Block[]) => blocks.map((b) => b.runs.map((r) => r.text).join(''));

describe('UDF', () => {
  it('yazılan paket content.xml taşır ve geri okunur', async () => {
    const bytes = buildUdfBytes('', BLOCKS);
    expect(zipNames(bytes)).toEqual(['content.xml']);
    const { blocks } = await readUdf(bytes);
    expect(text(blocks)).toEqual(text(BLOCKS));
    expect(blocks[0]).toMatchObject({ kind: 'p', align: 'center' });
    expect(blocks[0]?.runs[0]?.marks).toEqual(['bold']);
    expect(blocks[2]).toMatchObject({ align: 'right' });
    expect(blocks[3]).toMatchObject({ kind: 'li', ordered: true, index: 1 });
    expect(blocks[4]).toMatchObject({ kind: 'li', ordered: true, index: 2 });
    expect(blocks[5]).toMatchObject({ kind: 'li', ordered: false });
  });

  it('başlık verilirse ilk paragraf olur', () => {
    const { blocks } = parseUdfXml(buildUdfXml('Başlık', BLOCKS));
    expect(text(blocks)[0]).toBe('Başlık');
  });

  it('havuz ofsetleri UTF-16 kod birimidir (dört baytlık karakter iki birim)', () => {
    const xml = buildUdfXml('', [
      { kind: 'p', align: null, runs: [{ text: '\u{1D49C}a', marks: [] }] },
    ]);
    expect(xml).toContain('length="3"');
  });

  it('UDF olmayan paketi reddeder', async () => {
    await expect(readUdf(buildDocxBytes('', BLOCKS))).rejects.toThrow();
  });
});

describe('DOCX', () => {
  it('yazılan docx geri okunur', async () => {
    const { blocks } = await readDocx(buildDocxBytes('', BLOCKS));
    expect(blocks[0]?.runs[0]?.marks).toEqual(['bold']);
    expect(blocks[0]).toMatchObject({ kind: 'p', align: 'center' });
    expect(text(blocks)[1]).toContain('Ahmet "Yılmaz" & <Ortakları> \u{1D49C}');
    expect(blocks[2]?.runs[0]?.marks).toEqual(['italic', 'underline']);
  });
});

describe('PDF HTML', () => {
  it('metni kaçışlar ve listeleri gruplar', () => {
    const html = blocksToHtml(BLOCKS);
    expect(html).toContain('&lt;Ortakları&gt;');
    expect(html).toContain('<ol><li>birinci</li><li>ikinci</li></ol>');
    expect(html).toContain('<ul><li>madde</li></ul>');
    expect(html).not.toContain('<Ortakları>');
  });
});

describe('xml-lite', () => {
  it('varlıkları çözer, CDATA ve yorumu işler', () => {
    const n = parseXml(
      '<?xml version="1.0"?><a x="1 &amp; 2"><!-- y --><b>&lt;&#65;&#x42;<![CDATA[<c>]]></b></a>',
    );
    expect(n.attrs.x).toBe('1 & 2');
    expect(n.children[0]?.text).toBe('<AB<c>');
  });
  it('DOCTYPE ve kapanmamış öğeyi reddeder', () => {
    expect(() => parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')).toThrow();
    expect(() => parseXml('<a><b></a>')).toThrow();
  });
});

describe('UDF kaynak sınırı', () => {
  it('aynı havuz aralığını tekrar tekrar gösteren dosya belleği şişiremez', () => {
    const pool = 'x'.repeat(1000);
    const runs = '<content startOffset="0" length="1000"/>'.repeat(6000);
    const xml = `<?xml version="1.0" encoding="UTF-8" ?><template format_id="1.8"><content><![CDATA[${pool}]]></content><elements resolver="hvl-default"><paragraph>${runs}</paragraph></elements></template>`;
    expect(() => parseUdfXml(xml)).toThrow();
  });
});
