// Ön/arka ünlü uyumunu bozan sözcükler (026 §7.5 (2)); küçük BAŞLANGIÇ tablosu. Liste eksiktir; dil
// uzmanı doğrulaması bekler (026 Açık Sorular 10). Anahtarlar foldChars biçimindedir.

export const FRONT_HARMONY_EXCEPTIONS: ReadonlySet<string> = new Set([
  'rol',
  'saat',
  'harf',
  'kalp',
  'alkol',
  'gol',
  'kemal',
  'celal',
  'cemal',
  'nihal',
  'hilal',
]);
