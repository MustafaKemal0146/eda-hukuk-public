// Bedesten belge kimliği (021 §5.6): canlı gözlemde 7–10 haneli sayı (ör. 979779300). Kimlik URL değildir;
// kamu bağlantısının host'u sabittir. Yol/şema/sorgu/kaçış içeren her değer reddedilir (KK-021-11).
const BEDESTEN_ID = /^[0-9]{4,15}$/;

export function isValidBedestenId(id: string): boolean {
  return BEDESTEN_ID.test(id);
}

export const BEDESTEN_PUBLIC_BASE = 'https://mevzuat.adalet.gov.tr/ictihat/';

export function bedestenPublicUrl(id: string): string {
  const url = new URL(`${BEDESTEN_PUBLIC_BASE}${id}`);
  // İkinci denetim: host ve yol öneki sabit kalmalı.
  if (url.host !== 'mevzuat.adalet.gov.tr' || url.pathname !== `/ictihat/${id}`) {
    throw new Error('belge kimliği geçersiz');
  }
  return url.toString();
}
