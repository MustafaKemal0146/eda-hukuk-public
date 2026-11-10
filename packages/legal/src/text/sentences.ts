// Cümle bölücü (034 §6.5, §7.2; 023 §2). Kısaltma korumalıdır: `m.`, `s.`, `No.`, `E.`, `K.`, `md.`,
// `vb.`, `bkz.`, `Dr.`, `Av.` ve tek harfli kısaltmalar ile sıra sayıları (`9. Hukuk Dairesi`) cümle
// sonu sayılmaz. Çıktı metni kayıpsız ve ardışık örter: her aralık bir cümle ve ardındaki boşluktur,
// `spans.map(s => text.slice(s.start, s.end)).join('') === text`. Saf işlev.
import { tr_normalize } from './normalize.ts';

export type TextSpan = { start: number; end: number };

/** 034 §6.5 kısaltma listesi (`tr_normalize` biçiminde, noktasız). Tek harfli belirteçler ayrıca korunur. */
export const SENTENCE_ABBREVIATIONS: ReadonlySet<string> = new Set([
  'm',
  's',
  'no',
  'e',
  'k',
  'md',
  'vb',
  'bkz',
  'dr',
  'av',
]);

/** Cümle sonu işareti, ardından isteğe bağlı kapanış tırnağı/parantez ve en az bir boşluk. */
const TERMINATOR = /[.!?…]+["'”’)\]]*(\s+)/gu;
/** Yeni cümle büyük harf, rakam veya açılış tırnağı/parantezle başlar. */
const SENTENCE_START = /^["'“‘([]?[\p{Lu}\d]/u;

function isProtected(text: string, dotAt: number): boolean {
  if (text[dotAt] !== '.') return false;
  const before = /(?:^|[^\p{L}\d])([\p{L}\d]+)$/u.exec(text.slice(Math.max(0, dotAt - 24), dotAt));
  const token = before?.[1];
  if (token === undefined) return false;
  if (/^\d+$/u.test(token)) return true; // sıra sayısı: "9. Hukuk Dairesi"
  if (/^\p{L}$/u.test(token)) return true; // tek harf: "T.", "B. No"
  return SENTENCE_ABBREVIATIONS.has(tr_normalize(token));
}

export function splitSentences(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let start = 0;
  TERMINATOR.lastIndex = 0;
  for (let m = TERMINATOR.exec(text); m !== null; m = TERMINATOR.exec(text)) {
    const end = m.index + m[0].length;
    if (end >= text.length) break;
    if (!SENTENCE_START.test(text.slice(end, end + 2))) continue;
    // Yalnız tek nokta ile biten belirteç kısaltma olabilir ("vb." evet, "vb.." hayır).
    const punct = /^[.!?…]+/u.exec(m[0])?.[0] ?? '';
    if (punct === '.' && isProtected(text, m.index)) continue;
    spans.push({ start, end });
    start = end;
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans;
}
