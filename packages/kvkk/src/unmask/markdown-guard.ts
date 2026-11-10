// MarkdownGuard (026 §9.3, 022 §6.2): karakter karakter çalışan durum makinesi; korumalı bölgede
// tokenlar çözülmez. Korumalı bölgeler: (a) satır başında ``` ile açılıp kapanan kod bloğu; (b) tek ters
// tırnakla satır içi kod (ters tırnak veya satır sonunda kapanır); (c) `](` ile başlayıp `)` ile biten
// bağlantı hedefi; (d) http:// veya https:// ile başlayan çıplak URL (boşluk, `)` veya `>` ile biter).
// Girintili kod ve ~~~ çitleri korumalı DEĞİLDİR (kabul edilmiş artık davranış).
import { asciiLower } from '../fold.ts';

export interface GuardState {
  fence: boolean;
  inline: boolean;
  link: boolean;
  url: boolean;
  atLineStart: boolean;
}

export function newGuardState(): GuardState {
  return { fence: false, inline: false, link: false, url: false, atLineStart: true };
}

export type Prefix = 'complete' | 'partial' | 'no';

/** `s[i..]` ASCII büyük/küçük harf duyarsız olarak `word` ile başlıyor mu; metin sonu öneki partial. */
export function prefixAt(s: string, i: number, word: string, final: boolean): Prefix {
  const avail = s.length - i;
  const n = Math.min(avail, word.length);
  if (asciiLower(s.slice(i, i + n)) !== word.slice(0, n)) return 'no';
  if (n === word.length) return 'complete';
  return final ? 'no' : 'partial';
}

const URL_PREFIXES = ['https://', 'http://'] as const;

/** URL öneki: en az biri complete ise uzunluğu; biri partial ise 'partial'; değilse 0. */
export function urlPrefixAt(s: string, i: number, final: boolean): number | 'partial' {
  let partial = false;
  for (const p of URL_PREFIXES) {
    const r = prefixAt(s, i, p, final);
    if (r === 'complete') return p.length;
    if (r === 'partial') partial = true;
  }
  return partial ? 'partial' : 0;
}

export function isProtected(st: GuardState): boolean {
  return st.fence || st.inline || st.link || st.url;
}
