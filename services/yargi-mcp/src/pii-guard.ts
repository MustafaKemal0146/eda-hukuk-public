// PII savunma derinliği (021 §5.13): sorguda TCKN/VKN (algoritma), IBAN (mod-97), telefon, e-posta
// veya maske token'ı varsa canlı çağrı yapılmaz. Asıl kapı api'dedir (021 §6.3).
// AS-P11-05: 021 bu algılayıcıları @eda/kvkk'dan ister; yargi-mcp bağımlılık kuralı (013 §19 k.9)
// genişletilene kadar desenler burada, kvkk ile aynı algoritmalarla.

const MASK_TOKEN = /\[[A-Z_]+_[A-Z2-7]{4,6}\]/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?<!\d)(?:\+?90[\s-]?)?0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/;
const IBAN = /\bTR\d{2}(?:\s?[0-9A-Z]{4}){5}\s?[0-9A-Z]{2}\b/i;

export function isTckn(s: string): boolean {
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = [...s].map(Number);
  const odd = (d[0] ?? 0) + (d[2] ?? 0) + (d[4] ?? 0) + (d[6] ?? 0) + (d[8] ?? 0);
  const even = (d[1] ?? 0) + (d[3] ?? 0) + (d[5] ?? 0) + (d[7] ?? 0);
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d10 === d[9] && d11 === d[10];
}

export function isVkn(s: string): boolean {
  if (!/^\d{10}$/.test(s)) return false;
  const d = [...s].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = ((d[i] ?? 0) + 9 - i) % 10;
    let p = (t * 2 ** (9 - i)) % 9;
    if (t !== 0 && p === 0) p = 9;
    sum += p;
  }
  return (10 - (sum % 10)) % 10 === d[9];
}

export function isIban(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^TR\d{24}$/.test(s)) return false;
  const moved = `${s.slice(4)}${s.slice(0, 4)}`.replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  let rem = 0;
  for (const ch of moved) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

export function containsPii(text: string): boolean {
  if (MASK_TOKEN.test(text) || EMAIL.test(text) || PHONE.test(text)) return true;
  const iban = IBAN.exec(text);
  if (iban && isIban(iban[0])) return true;
  for (const m of text.matchAll(/(?<!\d)\d{10,11}(?!\d)/g)) {
    if (isTckn(m[0]) || isVkn(m[0])) return true;
  }
  return false;
}
