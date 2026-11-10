// Yasal metin yer tutucuları (053-12 §3.3). İki tür vardır:
//  - Yapılandırma anahtarları (`{{retention.backupContentMaxDays}}`): `CONFIG_DEFAULTS` değeriyle
//    derleme/çizim anında doldurulur; metinde sayı kopyası tutulmaz (KK-053-12-12).
//  - Şirket/hukuk bilgileri (`{{SIRKET_UNVANI}}` vb.): yayın öncesi elle doldurulur; doldurulana kadar
//    metinde olduğu gibi görünür. Liste 'dadır.
import { CONFIG_DEFAULTS, type ConfigKey } from '@eda/contracts/config/defaults';

/** Hukuk/şirket tarafından doldurulacak yer tutucu adları. */
export const COMPANY_PLACEHOLDERS = [
  'SIRKET_UNVANI',
  'MERSIS_NO',
  'ADRES',
  'KEP_ADRESI',
  'ALAN',
  'VERI_MERKEZI_SAGLAYICISI',
  'EPOSTA_SAGLAYICISI',
  'EPOSTA_BOLGESI',
  'VERBIS_DURUMU',
  'YETKILI_MAHKEME',
  'YURURLUK_TARIHI',
  'GUNCELLEME_TARIHI',
] as const;

const TOKEN = /\{\{([A-Za-z_][A-Za-z0-9_.]*)\}\}/g;

function isConfigKey(key: string): key is ConfigKey {
  return Object.hasOwn(CONFIG_DEFAULTS, key);
}

/** Yapılandırma ve takvim yıllı yer tutucularını doldurur; şirket yer tutucularına dokunmaz. */
export function fillConfig(text: string, year: number = new Date().getFullYear()): string {
  return text.replace(TOKEN, (whole, key: string) => {
    if (key === 'YIL') return String(year);
    if (isConfigKey(key)) return String(CONFIG_DEFAULTS[key]);
    return whole;
  });
}

/** Metinde kalan doldurulmamış `{{...}}` yer tutucularının adları (yinelenmeden). */
export function remainingPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[1] ?? ''))].filter(Boolean);
}
