// HTML → Markdown (turndown) ve PDF → metin (unpdf), 021 §5.8. Bağlantı hedefleri atılır, betik/stil/
// görsel/form silinir; NFC; ardışık boş satırlar teke. OCR yok: metin katmanı yoksa text_unavailable.
// AS-P11-08: 021 içerik kapsayıcısı seçimi için cheerio ister; bağımlılık eklenmediğinden turndown'un
// `remove` kuralları kullanılır (Bedesten belgeleri tek gövdeli HTML'dir).
import TurndownService from 'turndown';
import { extractText } from 'unpdf';

function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**',
    br: '\n',
  });
  td.remove(['script', 'style', 'iframe', 'img', 'form', 'input', 'button', 'select', 'textarea']);
  td.remove(['noscript', 'head', 'meta', 'link', 'object', 'embed', 'svg']);
  td.addRule('linkTextOnly', { filter: 'a', replacement: (content) => content });
  td.addRule('tableCell', {
    filter: ['td', 'th'],
    replacement: (content) => `${content.replace(/\n+/g, ' ').trim()} `,
  });
  td.addRule('tableRow', { filter: 'tr', replacement: (content) => `${content.trim()}\n` });
  td.addRule('table', { filter: 'table', replacement: (content) => `\n\n${content}\n\n` });
  // Hukuk metninde "1." / "-" satır başları özgün kalmalı: Markdown kaçışı uygulanmaz.
  td.escape = (s: string) => s;
  return td;
}

let turndown: TurndownService | null = null;

export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ ]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlToMarkdown(html: string): string {
  turndown ??= createTurndown();
  return normalizeText(turndown.turndown(html));
}

/** Bayt dizisini çöz: UTF-8 bozuksa windows-1254 (eski Word çıktıları). */
export function decodeHtml(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const bad = utf8.split('�').length - 1;
  if (bad <= 2) return utf8;
  return new TextDecoder('windows-1254').decode(bytes);
}

export type PdfText = { text: string; status: 'ok' | 'text_unavailable' };

/** 021 §5.8: < 200 karakter veya sayfa başına < 20 karakter → text_unavailable. */
export async function pdfToText(bytes: Uint8Array): Promise<PdfText> {
  let pages: string[];
  let totalPages: number;
  try {
    const out = await extractText(new Uint8Array(bytes), { mergePages: false });
    pages = out.text;
    totalPages = out.totalPages;
  } catch {
    return { text: '', status: 'text_unavailable' };
  }
  const joined = normalizeText(pages.join('\n\n').replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2'));
  const perPage = totalPages > 0 ? joined.length / totalPages : 0;
  if (joined.length < 200 || perPage < 20) return { text: '', status: 'text_unavailable' };
  return { text: joined, status: 'ok' };
}
