// Doğrusal belirteç taraması (026 §6.4, §10.3 kural 5): sözcük = gövde + ('|’ + ek)?; şekil sınıfları
// özgün (NFC) harflerle çalışır: TITLE, UPPER, INITIAL.
import { TR_LOWER_CLASS, TR_UPPER_CLASS } from '../fold.ts';

export type Shape = 'TITLE' | 'UPPER' | 'INITIAL' | 'OTHER';

export interface Word {
  /** Tarama akışı ofsetleri. */
  start: number;
  end: number;
  text: string;
  body: string;
  bodyEnd: number;
  /** Kesme dahil ek (varsa). */
  suffix: string;
  shape: Shape;
}

const WORD = /[\p{L}][\p{L}.'’-]{0,24}/gu;
const TITLE = new RegExp(`^[${TR_UPPER_CLASS}][${TR_LOWER_CLASS}]{1,19}$`, 'u');
const UPPER = new RegExp(`^[${TR_UPPER_CLASS}]{2,20}$`, 'u');
const INITIAL = new RegExp(`^[${TR_UPPER_CLASS}]\\.$`, 'u');

export function shapeOf(body: string): Shape {
  if (TITLE.test(body)) return 'TITLE';
  if (UPPER.test(body)) return 'UPPER';
  if (INITIAL.test(body)) return 'INITIAL';
  return 'OTHER';
}

export function isNameShape(s: Shape): boolean {
  return s === 'TITLE' || s === 'UPPER' || s === 'INITIAL';
}

export function tokenizeWords(orig: string): Word[] {
  const out: Word[] = [];
  for (const m of orig.matchAll(WORD)) {
    const text = m[0];
    const start = m.index;
    let ap = -1;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text.charAt(i);
      if (ch === "'" || ch === '’') {
        ap = i;
        break;
      }
    }
    let body = ap >= 0 ? text.slice(0, ap) : text;
    let suffix = ap >= 0 ? text.slice(ap) : '';
    // Sondaki noktalama gövdeye ait değildir ("Yılmaz." cümle sonu); baş harf (A.) korunur.
    if (
      suffix === '' &&
      body.length > 2 &&
      body.endsWith('.') &&
      !body.slice(0, -1).includes('.')
    ) {
      body = body.slice(0, -1);
    }
    if (suffix.endsWith('.') || suffix.endsWith('-')) suffix = suffix.slice(0, -1);
    out.push({
      start,
      end: start + (ap >= 0 ? ap + suffix.length : text.length),
      text,
      body,
      bodyEnd: start + body.length,
      suffix,
      shape: shapeOf(body),
    });
  }
  return out;
}
