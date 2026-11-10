// Kaynaklar arası ortak normalize yardımcıları (021 §5.5): başlık, numara kanonik biçimi, özet.
import { htmlToMarkdown } from '../transform/convert.ts';

/** Sunucu üretimi başlık: "Yargıtay 9. Hukuk Dairesi E. 2024/1234 K. 2024/5678". */
export function decisionTitle(
  court: string,
  chamber: string | null,
  esasNo: string | null,
  kararNo: string | null,
): string {
  return [court, chamber, esasNo ? `E. ${esasNo}` : null, kararNo ? `K. ${kararNo}` : null]
    .filter((p): p is string => p !== null && p !== '')
    .join(' ');
}

/** "2024/0123" → "2024/123" (034 §8.2); biçim dışıysa null. */
export function canonNo(s: string | null | undefined): string | null {
  const m = /^(\d{4})\s*\/\s*0*(\d{1,7})$/.exec(s?.trim() ?? '');
  if (!m?.[1] || !m[2] || m[2] === '0') return null;
  return `${m[1]}/${m[2]}`;
}

/** Özet alanı en çok 300 karakter (021 §5.5). */
export const SNIPPET_MAX = 300;

/** HTML parçası → tek satır düz metin; ≤ 300 karakter, sözcük sınırında "…" ile kesilir. */
export function htmlSnippet(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = htmlToMarkdown(html)
    .replace(/[*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) return null;
  if (text.length <= SNIPPET_MAX) return text;
  const cut = text.lastIndexOf(' ', SNIPPET_MAX - 1);
  return `${text.slice(0, cut > SNIPPET_MAX / 2 ? cut : SNIPPET_MAX - 1).trimEnd()}…`;
}
