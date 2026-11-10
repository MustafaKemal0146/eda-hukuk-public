// E-posta normalleştirici (042 §2.6 `user.create.before`, Tuzak 5; 030 `users_email_chk`). Yalnız
// yazdırılabilir ASCII kabul edilir; büyük harf yalnız ASCII aralığında (A-Z) küçültülür. Türkçe yerel
// ayarlı dönüşüm ve DB `lower()` KULLANILMAZ (`İ`/`ı` tuzağı; Y-104). ASCII dışı girdi `null` döner.

const PRINTABLE_ASCII = /^[\x21-\x7E]+$/;
const ASCII_UPPER = /[A-Z]/g;
const CASE_OFFSET = 32;

/** Baştaki/sondaki boşlukları kırpar; ASCII dışı veya boşsa `null`, aksi hâlde ASCII küçük harf. */
export function normalizeEmail(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '' || !PRINTABLE_ASCII.test(trimmed)) return null;
  return trimmed.replace(ASCII_UPPER, (c) => String.fromCharCode(c.charCodeAt(0) + CASE_OFFSET));
}

/** Girdi ASCII e-posta kuralına uyuyor mu (normalleştirmeden önce). */
export function isAsciiEmail(input: string): boolean {
  return normalizeEmail(input) !== null;
}
