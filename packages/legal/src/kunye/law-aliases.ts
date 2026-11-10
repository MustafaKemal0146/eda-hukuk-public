// Kanun kısaltmaları sözlüğü (081 §6; 025 §8.1 `LAW_ABBR`). Görüntü kısaltması çıktıda yazılan
// biçimdir; takma adlar yalnız ayrıştırmada tanınır. `strict`: kısaltma "m." olmadan da madde atfı
// sayılır (A2; çift anlamsız kısaltmalar). §6.2 satırları hukuk onayı bekler (081 Açık Sorular).
// Kanun adları burada tutulmaz: ad mevzuat kaynağından gelir (P15 kuralı).
import { tr_normalize } from '../text/normalize.ts';

export type LawAlias = {
  lawNo: string | null;
  /** Görüntü kısaltması; yoksa "{no} s. K." biçimi kullanılır. */
  display: string | null;
  aliases: readonly string[];
  strict: boolean;
  /** Kanun numarası olmayan metin (AİHS): madde atfı korpusta yoksa yalnız `raw`. */
  lawType: 'kanun' | 'anayasa' | 'sozlesme';
  /** 081 §6.2 satırı: hukuk onayı bekliyor. */
  unverified: boolean;
};

const k = (
  lawNo: string,
  display: string | null,
  aliases: readonly string[] = [],
  strict = false,
): LawAlias => ({ lawNo, display, aliases, strict, lawType: 'kanun', unverified: false });

/** 081 §6.1 ana sözlük. */
const MAIN: readonly LawAlias[] = [
  {
    lawNo: '2709',
    display: 'AY',
    aliases: ['Anayasa'],
    strict: false,
    lawType: 'anayasa',
    unverified: false,
  },
  k('6100', 'HMK', [], true),
  k('1086', 'HUMK'),
  k('5271', 'CMK', [], true),
  k('2577', 'İYUK', ['IYUK'], true),
  k('2004', 'İİK', ['IIK'], true),
  k('6098', 'TBK', [], true),
  k('818', 'BK'),
  k('4721', 'TMK', [], true),
  k('743', 'MK'),
  k('5237', 'TCK', [], true),
  k('6102', 'TTK', [], true),
  k('6698', 'KVKK'),
  k('1136', 'Av.K.', ['AvK']),
  k('6325', 'HUAK'),
  k('7036', 'İşMK', ['IsMK']),
  k('4857', 'İşK', ['İş K.']),
  k('7201', 'Tebligat K.', ['TebK']),
  k('5846', 'FSEK'),
  k('213', 'VUK', [], true),
  k('492', 'Harçlar K.'),
  k('6216', 'AYM K.'),
  k('5070', 'EİK'),
  k('2429', null),
];

/** 081 §6.2 yaygın kısaltmalar ve kısaltması olmayanlar (hukuk onayı bekliyor). */
const COMMON: readonly LawAlias[] = [
  k('5510', null, ['SSGSSK']),
  k('6331', 'İSG K.', ['İSGK']),
  k('6502', 'TKHK'),
  k('193', 'GVK'),
  k('5520', 'KVK'),
  k('3065', 'KDVK'),
  k('6284', null),
  k('5395', 'ÇKK'),
  k('6769', 'SMK'),
  k('3194', 'İmar K.'),
  k('5411', 'Bankacılık K.'),
  k('6362', 'SPKn', ['SPK']),
  k('4054', 'RKHK'),
  k('5253', 'Dernekler K.'),
  k('5737', 'Vakıflar K.'),
  k('5326', 'Kabahatler K.'),
  k('4686', 'MTK'),
  k('2872', 'Çevre K.'),
  k('2942', 'Kamulaştırma K.'),
  k('634', 'KMK'),
  k('657', 'DMK'),
  k('2575', 'Danıştay K.'),
  k('2797', 'Yargıtay K.'),
  k('5684', 'Sigortacılık K.'),
  k('5718', 'MÖHUK'),
  k('5018', 'KMYKK'),
  k('6085', 'Sayıştay K.'),
  k('2247', null),
  k('4734', null),
  k('4735', null),
  k('2886', null, ['Dİ K.']),
  k('2918', 'KTK'),
  k('5275', 'CGTİHK'),
  k('6458', 'YUKK'),
  k('5651', null),
  k('6356', 'STİSK'),
  k('1512', 'Noterlik K.'),
  k('2644', 'Tapu K.'),
  k('6750', null),
  k('6183', 'AATUHK'),
  k('6754', 'Bilirkişilik K.'),
  {
    lawNo: null,
    display: 'AİHS',
    aliases: ['Sözleşme'],
    strict: false,
    lawType: 'sozlesme',
    unverified: false,
  },
];

export const LAW_ALIASES: readonly LawAlias[] = [
  ...MAIN,
  ...COMMON.map((a) => ({ ...a, unverified: true })),
];

/** Normalize edilmiş kısaltma → sözlük kaydı. "Sözleşme" ve "Anayasa" yalnız A5/A1 bağlamında anlamlıdır. */
const BY_ABBR = new Map<string, LawAlias>();
for (const a of LAW_ALIASES) {
  for (const name of [a.display, ...a.aliases]) {
    if (name !== null) BY_ABBR.set(tr_normalize(name), a);
  }
}

export function lawByAbbr(abbr: string): LawAlias | null {
  return BY_ABBR.get(tr_normalize(abbr)) ?? null;
}

export function lawByNo(lawNo: string): LawAlias | null {
  return LAW_ALIASES.find((a) => a.lawNo === lawNo) ?? null;
}

/** Görüntü kısaltması; sözlükte yoksa "6098 s. K." (081 §4.3). */
export function lawDisplay(lawNo: string): string {
  return lawByNo(lawNo)?.display ?? `${lawNo} s. K.`;
}

/** Ayrıştırıcı için normalize kısaltmalar (uzundan kısaya: "av.k." "ak"tan önce denenir). */
export function abbrPatternSource(strictOnly: boolean): string {
  const names = [...BY_ABBR.entries()]
    .filter(([n, a]) => (strictOnly ? a.strict : true) && n !== 'sözleşme' && n !== 'anayasa')
    .map(([n]) => n)
    .sort((x, y) => y.length - x.length);
  return names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}
