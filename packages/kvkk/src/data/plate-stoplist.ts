// Plaka algılayıcısı durdurma listesi (026 §6.3). Hukuk onayı bekliyor.
// İki harfli birim/kısaltmalar plaka harf grubu sayılmaz (zor negatif: "10 TL 5000", "34 KG 1000").

export const PLATE_STOPLIST: ReadonlySet<string> = new Set([
  'TL',
  'TC',
  'KG',
  'KM',
  'MM',
  'CM',
  'MB',
  'GB',
  'TB',
  'KB',
  'TV',
  'EK',
  'MD',
]);
