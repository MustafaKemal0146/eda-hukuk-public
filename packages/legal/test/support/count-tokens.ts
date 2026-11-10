// Sabit token sayacı fixture'ı (034 §7.2-6; P14a.6): sözcük başına ceil(karakter / 4). Boşlukla
// birleştirmede toplamsaldır; parçalayıcı testleri sonucu elle doğrulayabilsin diye TEI yerine kullanılır.
import type { CountTokens } from '../../src/sections/index.ts';

export function tokensOf(text: string): number {
  let n = 0;
  for (const w of text.match(/\S+/g) ?? []) n += Math.ceil([...w].length / 4);
  return n;
}

export const fixtureCountTokens: CountTokens = async (texts) => texts.map(tokensOf);

/** Çağrı sayısını da tutan sayaç (toplu ölçüm sayısı denetimi için). */
export function countingCounter(): { count: CountTokens; calls: () => number } {
  let calls = 0;
  return {
    count: async (texts) => {
      calls += 1;
      return texts.map(tokensOf);
    },
    calls: () => calls,
  };
}
