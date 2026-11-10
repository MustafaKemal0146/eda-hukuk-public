// Vergi kimlik no sağlaması (026 §6.2). GİB algoritması dış bilgidir; resmî kaynakla doğrulanacak
//. Ölçüm üreticisi aynı işlevi kullandığından yanlış algoritma ölçümde fark edilmez.

function checkDigit(first9: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const t = ((first9[i] ?? 0) + 9 - i) % 10;
    let p = (t * 2 ** (9 - i)) % 9;
    if (t !== 0 && p === 0) p = 9;
    sum += p;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidVkn(s: string): boolean {
  if (!/^[0-9]{10}$/u.test(s)) return false;
  const d = [...s].map(Number);
  return checkDigit(d) === d[9];
}

/** İlk 9 haneden geçerli VKN kurar (sentetik üretici). */
export function vknFromPrefix(first9: string): string {
  if (!/^[0-9]{9}$/u.test(first9)) throw new RangeError('vkn öneki 9 hane olmalı');
  return `${first9}${checkDigit([...first9].map(Number))}`;
}
