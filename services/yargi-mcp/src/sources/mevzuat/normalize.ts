// Mevzuat türü eşlemesi ve LegislationHit üretimi (021 §5.4, §5.6). Tür adları/kimlikleri 2026-10-10
// canlı gözlem: KANUN 1, TUZUK 2, YONETMELIK 3, KHK 4, KKY 7, TEBLIGLER 9, CB_KARARNAME 19, CB_KARAR 20.
// AS-P11-10: diğer tür kodları (CB yönetmeliği vb.) "diger"e düşer; tam liste P15'te doğrulanır.

import type { McpLawType } from '@eda/contracts/enums';
import type { LegislationHitValue } from '@eda/contracts/mcp';
import type { MevzuatItemValue } from './client.ts';

/** law_type → Bedesten `mevzuatTurList` değeri (diger: süzgeç yok). */
export const LAW_TYPE_TO_TUR: Readonly<Record<Exclude<McpLawType, 'diger'>, string>> = {
  kanun: 'KANUN',
  khk: 'KHK',
  cbk: 'CB_KARARNAME',
  tuzuk: 'TUZUK',
  yonetmelik: 'YONETMELIK',
  teblig: 'TEBLIGLER',
};

const TUR_TO_LAW_TYPE = new Map<string, McpLawType>([
  ['KANUN', 'kanun'],
  ['KHK', 'khk'],
  ['CB_KARARNAME', 'cbk'],
  ['TUZUK', 'tuzuk'],
  ['YONETMELIK', 'yonetmelik'],
  ['KKY', 'yonetmelik'],
  ['TEBLIGLER', 'teblig'],
]);

export function lawTypeOf(turName: string): McpLawType {
  return TUR_TO_LAW_TYPE.get(turName) ?? 'diger';
}

export function mevzuatRef(item: MevzuatItemValue): string {
  return `${item.mevzuatTur.id}.${item.mevzuatTertip}.${item.mevzuatNo}`;
}

/** Kamu bağlantısı: host sabit, sorgu yalnız sayısal kimliklerden (021 §5.6). */
export function mevzuatUrl(item: MevzuatItemValue): string {
  const u = new URL('https://www.mevzuat.gov.tr/mevzuat');
  u.searchParams.set('MevzuatNo', String(item.mevzuatNo));
  u.searchParams.set('MevzuatTur', String(item.mevzuatTur.id));
  u.searchParams.set('MevzuatTertip', String(item.mevzuatTertip));
  return u.toString();
}

export function legislationHit(item: MevzuatItemValue, retrievedAt: string): LegislationHitValue {
  const name = item.mevzuatAdi.replace(/\s+/g, ' ').trim();
  return {
    source: 'mevzuat',
    law_no: String(item.mevzuatNo),
    law_type: lawTypeOf(item.mevzuatTur.name),
    law_name: name,
    mevzuat_ref: mevzuatRef(item),
    article_no: null,
    title: name,
    snippet: null,
    url: mevzuatUrl(item),
    // AS-P11-10: Bedesten `guncellemeTarihi` sistem kayıt güncellemesidir, değişiklik tarihi değildir.
    last_amended_at: null,
    retrieved_at: retrievedAt,
  };
}
