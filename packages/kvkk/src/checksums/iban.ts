// TR IBAN sağlaması (026 §6.2): mod-97, blok blok (taşma yok).
import { asciiUpper } from '../fold.ts';

function mod97(numeric: string): number {
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

function toNumeric(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += c >= 0x41 && c <= 0x5a ? String(c - 55) : ch;
  }
  return out;
}

/** Boşluk/tire atılır, ASCII büyük harfe getirilir; TR + 24 hane ve mod-97 = 1. */
export function isValidIban(raw: string): boolean {
  const s = asciiUpper(raw.replace(/[\s.-]/gu, ''));
  if (!/^TR[0-9]{24}$/u.test(s)) return false;
  return mod97(toNumeric(s.slice(4) + s.slice(0, 4))) === 1;
}

/** Sentetik IBAN: banka kodu (5) + rezerv/hesap (17) -> kontrol haneli TR IBAN (027 §3.3). */
export function ibanFromParts(bank5: string, rest17: string): string {
  if (!/^[0-9]{5}$/u.test(bank5) || !/^[0-9]{17}$/u.test(rest17)) {
    throw new RangeError('iban parçaları geçersiz');
  }
  const bban = `${bank5}${rest17}`;
  const check = 98 - mod97(toNumeric(`${bban}TR00`));
  return `TR${check < 10 ? `0${check}` : check}${bban}`;
}
