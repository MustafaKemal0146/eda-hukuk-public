// DOCX yazıcı (bağımlılıksız): açık OOXML + "store" (sıkıştırmasız) ZIP. Kâğıt A4, kenar boşlukları
// 25/20/20/20 mm; yazı tipi, punto ve satır aralığı belge düzeninden (varsayılan Times New Roman 12 pt, 1,5). `[[Doldurulacak: ...]]`
// işaretleri sarı vurgulu çıkar. Çıktıya durum/beyan notu eklenmez (Y-88). Sunucu tarafı doc-engine
// hattı (UDF/PDF) P19c'dedir; bu yazıcı tarayıcıda hızlı DOCX içindir.
import { DEFAULT_DOC_LAYOUT, type DocLayout } from '@eda/editor/schema';
import type { Block, Run } from './doc-convert.ts';
import { FONT_NAMES } from './page-layout.ts';

const enc = new TextEncoder();

// --- ZIP ---------------------------------------------------------------------------------------

let CRC_TABLE: Uint32Array | null = null;
export function crc32(bytes: Uint8Array): number {
  if (CRC_TABLE === null) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type Entry = { name: string; data: Uint8Array };

export function zipStore(entries: readonly Entry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = (46 << 9) | (1 << 5) | 1; // 2026-01-01 (sabit; yeniden üretilebilir çıktı)
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 ad
    local.setUint16(8, 0, true); // store
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, e.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, DOS_TIME, true);
    cd.setUint16(14, DOS_DATE, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, e.data.length, true);
    cd.setUint32(24, e.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + e.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

// --- OOXML -------------------------------------------------------------------------------------

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PLACEHOLDER = /(\[\[[^[\]\n]{1,200}\]\])/g;

/** Çalıştırma özellikleri belge düzeninden: yüz adı ve yarım punto cinsinden boyut. */
type RunStyle = { font: string; sz: number };

function runStyleOf(layout: DocLayout): RunStyle {
  const [name] = FONT_NAMES[layout.fontFamily];
  return {
    font: `<w:rFonts w:ascii="${esc(name)}" w:hAnsi="${esc(name)}" w:cs="${esc(name)}"/>`,
    sz: layout.fontSizePt * 2,
  };
}

function runXml(r: Run, style: RunStyle, extra = ''): string {
  return r.text
    .split(PLACEHOLDER)
    .filter((t) => t !== '')
    .map((t) => {
      const hl = PLACEHOLDER.test(t) ? '<w:highlight w:val="yellow"/>' : '';
      PLACEHOLDER.lastIndex = 0;
      const props = `${style.font}${r.marks.includes('bold') || extra.includes('b') ? '<w:b/>' : ''}${
        r.marks.includes('italic') ? '<w:i/>' : ''
      }${r.marks.includes('underline') ? '<w:u w:val="single"/>' : ''}<w:sz w:val="${style.sz}"/>${hl}`;
      const parts = t.split('\n');
      const body = parts
        .map((part, i) => {
          const tabbed = part
            .split('\t')
            .map(
              (seg, j) => `${j > 0 ? '<w:tab/>' : ''}<w:t xml:space="preserve">${esc(seg)}</w:t>`,
            )
            .join('');
          return `${i > 0 ? '<w:br/>' : ''}${tabbed}`;
        })
        .join('');
      return `<w:r><w:rPr>${props}</w:rPr>${body}</w:r>`;
    })
    .join('');
}

const JC = { left: 'left', center: 'center', right: 'right', justify: 'both' } as const;

function paragraphXml(b: Block, layout: DocLayout): string {
  const style = runStyleOf(layout);
  // `w:line` 240 = tek aralık; 1,15 -> 276, 1,5 -> 360.
  const spacing = `<w:spacing w:after="120" w:line="${Math.round(layout.lineHeight * 240)}" w:lineRule="auto"/>`;
  if (b.kind === 'h') {
    return `<w:p><w:pPr><w:keepNext/>${spacing}</w:pPr>${b.runs.map((r) => runXml(r, style, 'b')).join('')}</w:p>`;
  }
  if (b.kind === 'li') {
    const marker = b.ordered ? `${b.index}. ` : '• ';
    return `<w:p><w:pPr>${spacing}<w:ind w:left="567" w:hanging="283"/><w:jc w:val="both"/></w:pPr>${runXml(
      {
        text: marker,
        marks: [],
      },
      style,
    )}${b.runs.map((r) => runXml(r, style)).join('')}</w:p>`;
  }
  const jc = JC[b.align ?? 'justify'];
  const indent = b.align === null || b.align === 'justify' ? '<w:ind w:firstLine="709"/>' : '';
  return `<w:p><w:pPr>${spacing}${indent}<w:jc w:val="${jc}"/></w:pPr>${b.runs.map((r) => runXml(r, style)).join('')}</w:p>`;
}

export function buildDocxBytes(
  title: string,
  blocks: readonly Block[],
  layout: DocLayout = DEFAULT_DOC_LAYOUT,
): Uint8Array {
  const titleP = title.trim()
    ? paragraphXml(
        { kind: 'p', align: 'center', runs: [{ text: title.trim(), marks: ['bold'] }] },
        layout,
      )
    : '';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${titleP}${blocks
    .map((b) => paragraphXml(b, layout))
    .join(
      '',
    )}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1417" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'word/document.xml', data: enc.encode(document) },
  ]);
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function downloadDocx(
  title: string,
  blocks: readonly Block[],
  fileName: string,
  layout: DocLayout = DEFAULT_DOC_LAYOUT,
): void {
  const bytes = buildDocxBytes(title, blocks, layout);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: DOCX_MIME }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName}.docx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
