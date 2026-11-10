// Türkçe'ye özgü harf denetimi (023 §4.2 `fold` bacağı koşulu (a)): sorgu Türkçe karakter içermiyorsa
// kullanıcı katlanmış yazıyor olabilir; katlanmış (`tr_fold`) bacak devreye girer. Saf.

const TURKISH_SPECIFIC = /[çğıöşüÇĞİÖŞÜ]/u;

export function hasTurkishSpecificChars(s: string): boolean {
  return TURKISH_SPECIFIC.test(s);
}
