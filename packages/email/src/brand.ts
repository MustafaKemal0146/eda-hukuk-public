// Marka sabitleri (045 §7.2, §8.3; Açık Sorular 6). Logo metin başlıktır (uzak görsel yok). Şirket
// unvanı şirket kuruluşundan sonra belirlenir: değer çağırandan gelir; yoksa alt bilgide satır çıkmaz
// (uydurma unvan yazılmaz).
export const PRODUCT_NAME = 'E.D.A. Hukuk';

/** Destek ve yanıt adresi (`Reply-To`; 045 §8.3). */
export function supportAddress(appDomain: string): string {
  return `destek@${appDomain}`;
}

/** Şirket unvanı yer tutucusu (045 Açık Sorular 6). */
export const COMPANY_NAME_PLACEHOLDER = '{SIRKET_UNVANI}';
