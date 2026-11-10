// Token grameri (026 §4.1, 022 §6.2): "[" TIP "_" HASH "]"; HASH = [A-Z2-7]{4} | [A-Z2-7]{6}.
// Büyük/küçük harf toleransı yalnız ASCII katlamayla (A-Z <-> a-z); toLowerCase/toUpperCase yok.
import { asciiUpper } from '../fold.ts';
import { TIPS, type Tip } from '../types.ts';

/** En uzun token: `[TARIH_DOGUM_XXXXXX]`. */
export const TOKEN_MAX_LEN = 2 + 'TARIH_DOGUM'.length + 1 + 6;

const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function asciiCaseClass(ch: string): string {
  const up = asciiUpper(ch);
  if (up === ch && (ch < 'A' || ch > 'Z')) return ch === '_' ? '_' : ch;
  const low = String.fromCharCode(up.charCodeAt(0) + 0x20);
  return `[${up}${low}]`;
}

const TIP_ALT = TIPS.map((t) => [...t].map(asciiCaseClass).join('')).join('|');
const HASH_CLASS = '[A-Za-z2-7]';

/** Geri çözme grameri: tam token (4 veya 6 karakter karma). */
export function tokenRegex(): RegExp {
  return new RegExp(`\\[(?:${TIP_ALT})_(?:${HASH_CLASS}{6}|${HASH_CLASS}{4})\\]`, 'gu');
}

/** Kaçışlama grameri (026 §7.6.2): `\[(TIP)_[A-Z2-7]{4,6}\]`, ASCII büyük/küçük harf duyarsız. */
export function escapeRegex(): RegExp {
  return new RegExp(`\\[(?:${TIP_ALT})_${HASH_CLASS}{4,6}\\]`, 'gu');
}

function isHashChar(ch: string): boolean {
  return B32_CHARS.includes(asciiUpper(ch)) && ch.length === 1;
}

export type TokenMatch =
  | { kind: 'complete'; end: number; tip: Tip; token: string }
  | { kind: 'partial' }
  | { kind: 'no' };

/** Kanonik yazım: TIP ve HASH ASCII büyük harf. */
export function canonicalToken(raw: string): string {
  return asciiUpper(raw);
}

/**
 * `s[i] === '['` konumunda token grameri sınaması. `final` false iken metin sonu, gramerle hâlâ uyumlu
 * bir önekte biterse `partial` döner (akış tamponu, 026 §9.2).
 */
export function matchTokenAt(s: string, i: number, final: boolean): TokenMatch {
  if (s.charAt(i) !== '[') return { kind: 'no' };
  let partial = false;
  for (const tip of TIPS) {
    let j = i + 1;
    let ok = true;
    for (let k = 0; k < tip.length; k += 1, j += 1) {
      if (j >= s.length) {
        if (!final) partial = true;
        ok = false;
        break;
      }
      if (asciiUpper(s.charAt(j)) !== tip.charAt(k)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (j >= s.length) {
      if (!final) partial = true;
      continue;
    }
    if (s.charAt(j) !== '_') continue;
    j += 1;
    let n = 0;
    while (n < 6 && j + n < s.length && isHashChar(s.charAt(j + n))) n += 1;
    const after = j + n;
    if ((n === 4 || n === 6) && after < s.length && s.charAt(after) === ']') {
      return {
        kind: 'complete',
        end: after + 1,
        tip,
        token: `[${tip}_${asciiUpper(s.slice(j, after))}]`,
      };
    }
    if (after >= s.length && !final) partial = true;
  }
  return partial ? { kind: 'partial' } : { kind: 'no' };
}
