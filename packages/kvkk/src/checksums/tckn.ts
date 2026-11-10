// T.C. kimlik no sağlaması (026 §6.2). Tek kaynak: ölçüm üreticisi de bu işlevi kullanır.

/** 11 hane, ilk hane 0 değil; 10. ve 11. hane algoritmayla. */
export function isValidTckn(s: string): boolean {
  if (!/^[1-9][0-9]{10}$/u.test(s)) return false;
  const d = [...s].map(Number);
  const at = (i: number): number => d[i] ?? 0;
  const odd = at(0) + at(2) + at(4) + at(6) + at(8);
  const even = at(1) + at(3) + at(5) + at(7);
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  return d10 === at(9) && (odd + even + at(9)) % 10 === at(10);
}

/** İlk 9 haneden geçerli TCKN kurar (sentetik üretici; 027 §3.3). */
export function tcknFromPrefix(first9: string): string {
  if (!/^[1-9][0-9]{8}$/u.test(first9)) throw new RangeError('tckn öneki 9 hane olmalı');
  const d = [...first9].map(Number);
  const at = (i: number): number => d[i] ?? 0;
  const odd = at(0) + at(2) + at(4) + at(6) + at(8);
  const even = at(1) + at(3) + at(5) + at(7);
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = (odd + even + d10) % 10;
  return `${first9}${d10}${d11}`;
}
