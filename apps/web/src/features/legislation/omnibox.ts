// Mevzuat arama kutusu sınıflandırması (053-05 §3.2): madde atfı ve kanun numarası istemcide çözülür,
// ağ araması yapılmaz; diğer metin `POST /legislation/search`'e gider. Madde atfı ayrıştırıcısı ve kanun
// kısaltma sözlüğü tek kaynaktan: `@eda/legal` (081 §6, 025 §8.1). Atıf yalnız girdinin tamamıysa
// doğrudan açılır; cümle içindeki atıf içerik araması sayılır (kullanıcı beklentisi belirsiz).
import { ARTICLE_NO_URL_PATTERN, LAW_TYPE_URL, type LawTypeUrl } from '@eda/contracts/api';
import type { LawType } from '@eda/contracts/enums';
import { extractAll, lawByAbbr } from '@eda/legal/kunye';
import { tr_fold } from '@eda/legal/text';

/** ASCII harf büyütme (`i` → `I`); Türkçe yerel ayar burada bilerek kullanılmaz (URL biçimi ASCII). */
function asciiUpper(c: string): string {
  return c.replace(/[a-z]/g, (x) => String.fromCharCode(x.charCodeAt(0) - 32));
}

export type OmniboxResult =
  | { kind: 'article'; lawNo: string; articleNo: string }
  | { kind: 'law'; lawNo: string }
  | { kind: 'search' };

/** Ayrıştırıcı madde anahtarı ("49", "49/A", "G5", "E3", "M18") → URL biçimi. */
export function articleKeyToUrl(key: string): string | null {
  const url = key.replace('/', '-');
  return ARTICLE_NO_URL_PATTERN.test(url) ? url : null;
}

/** "geçici 5", "ek 3", "49/A", "18 mükerrer", "m. 352" … → URL biçimi; geçersizse `null`. */
export function articleUrlFromInput(input: string): string | null {
  const f = tr_fold(input.trim())
    .replace(/^(?:m|md|madde)\.?\s*/, '')
    .replace(/\.$/, '');
  let m = /^(?:gecici|g)\s*(?:m\.?\s*|madde\s*)?(\d{1,4})$/.exec(f);
  if (m) return `G${Number(m[1])}`;
  m = /^(?:ek|e)\s*(?:m\.?\s*|madde\s*)?(\d{1,4})$/.exec(f);
  if (m) return `E${Number(m[1])}`;
  m = /^(?:(\d{1,4})\s*mukerrer|m\s*(\d{1,4}))$/.exec(f);
  if (m) return `M${Number(m[1] ?? m[2])}`;
  m = /^(\d{1,4})(?:\s*[/-]\s*([a-z]))?$/.exec(f);
  if (m) return `${Number(m[1])}${m[2] ? `-${asciiUpper(m[2])}` : ''}`;
  return null;
}

export function classifyOmnibox(input: string, today: string): OmniboxResult {
  const text = input.trim().replace(/[.;,]+$/, '');
  if (text === '') return { kind: 'search' };
  const { citations } = extractAll(text, { today });
  const only = citations.length === 1 ? citations[0] : undefined;
  const article = only?.kind === 'article' ? only.article : null;
  const whole =
    only !== undefined &&
    text.slice(0, only.span.start).trim() === '' &&
    /^(?:vd\.?)?$/.test(text.slice(only.span.end).trim());
  if (whole && article?.lawNo) {
    const first = article.articles[0];
    const url = first ? articleKeyToUrl(first.key) : null;
    if (url) return { kind: 'article', lawNo: article.lawNo, articleNo: url };
  }
  const f = tr_fold(text);
  const numbered = /^(\d{3,5})(?:\s*(?:s\.|sayili)(?:\s*(?:k\.|kanun))?)?$/.exec(f);
  if (numbered?.[1]) return { kind: 'law', lawNo: numbered[1] };
  const abbr = lawByAbbr(text);
  if (abbr?.lawNo) return { kind: 'law', lawNo: abbr.lawNo };
  return { kind: 'search' };
}

function withType(path: string, type: LawType | null): string {
  if (type === null || type === 'law' || type === 'constitution') return path;
  const tur: LawTypeUrl = LAW_TYPE_URL[type];
  return `${path}?tur=${tur}`;
}

export function lawHref(lawNo: string, type: LawType | null = null): string {
  return withType(`/mevzuat/${encodeURIComponent(lawNo)}`, type);
}

export function articleHref(lawNo: string, articleNo: string, type: LawType | null = null): string {
  return withType(`/mevzuat/${encodeURIComponent(lawNo)}/${encodeURIComponent(articleNo)}`, type);
}
