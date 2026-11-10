// `stripTokens` (026 §9.5): token ve ardından gelen kesmeli eki siler (yerine tek boşluk), ardışık
// boşlukları daraltır. Canlı kaynak sorgularında (Y-36) ve arama aracı girdilerinde kullanılır.
import { tokenRegex } from '../tokens/grammar.ts';

const TOKEN_WITH_SUFFIX = new RegExp(`${tokenRegex().source}(?:['’]\\p{L}{1,12})?`, 'gu');

export function stripTokens(text: string): { text: string; removed: number } {
  let removed = 0;
  const replaced = text.replace(TOKEN_WITH_SUFFIX, () => {
    removed += 1;
    return ' ';
  });
  if (removed === 0) return { text, removed: 0 };
  return { text: replaced.replace(/[ \t]+/gu, ' ').trim(), removed };
}
