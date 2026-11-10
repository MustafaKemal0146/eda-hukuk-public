// MVP süre kuralı kataloğu TASLAĞI (083 §7; 27 kural, `version = 1`, hepsi `verified_by = NULL`).
// Kod, ad, dayanak, süre, başlangıç olayı, profil, süre türü ve güven 083 §7 tablosundan; params
// 083 §2.2 profillerinden; takma adlar 083 §7.1 örnekleri + kural adıdır (başka ifade uydurulmadı).
// `app.deadline_rules` seed'inin tek kaynağıdır (P03c `@eda/db` seed eşler; 032 §10.5 geçici
// taslağı kaldırıldı). Hukuk onayı bekliyor: hiçbir kural
// doğrulanmış sayılmaz ve prod'da seçilemez (Y-80, Y-83).
import type {
  DeadlineBranch,
  DeadlinePeriodUnit,
  DeadlineStartEvent,
  PeriodNature,
} from '@eda/contracts/enums';
import {
  type DeadlineRuleParamsValue,
  type DeadlineRuleRecordValue,
  PROFILES,
  type ProfileId,
} from '../params.ts';

export const RULE_CONFIDENCE_LEVELS = ['A', 'B', 'C'] as const;
export type RuleConfidenceLevel = (typeof RULE_CONFIDENCE_LEVELS)[number];

/** 083 §7 başlangıç değeri `effective_during = [2024-01-01,)`. */
export const CATALOG_EFFECTIVE_FROM = '2024-01-01';
export const CATALOG_NOTE_PREFIX = 'Taslak - doğrulanmadı';

export type DeadlineRuleCatalogEntry = {
  readonly no: number;
  readonly code: string;
  readonly branch: DeadlineBranch;
  readonly title: string;
  readonly lawRef: string;
  readonly durationValue: number;
  readonly durationUnit: DeadlinePeriodUnit;
  readonly startEvents: readonly DeadlineStartEvent[];
  readonly profile: ProfileId;
  readonly periodNature: PeriodNature;
  readonly confidence: RuleConfidenceLevel;
  readonly aliases: readonly string[];
  readonly startEventLabels: Partial<Record<DeadlineStartEvent, string>>;
  readonly optionalExtensionWeeks: number | null;
  readonly extraNote: string | null;
};

type Row = Omit<
  DeadlineRuleCatalogEntry,
  'aliases' | 'startEventLabels' | 'optionalExtensionWeeks' | 'extraNote'
> & {
  aliases?: readonly string[];
  startEventLabels?: Partial<Record<DeadlineStartEvent, string>>;
  optionalExtensionWeeks?: number;
  extraNote?: string;
};

const T5 = 'T-5: ara verme uzamasının alternatif okuması 08.09 (31.08 + 7 yerine)';
const MED_LABEL = { learning: 'Arabulucu görevlendirme tarihi' } as const;

function entry(r: Row): DeadlineRuleCatalogEntry {
  return {
    ...r,
    aliases: [...(r.aliases ?? []), r.title],
    startEventLabels: r.startEventLabels ?? {},
    optionalExtensionWeeks: r.optionalExtensionWeeks ?? null,
    extraNote: r.extraNote ?? null,
  };
}

/** 27 kural; sıra 083 §7 tablosuyla aynıdır. */
export const DEADLINE_RULE_CATALOG: readonly DeadlineRuleCatalogEntry[] = [
  entry({
    no: 1,
    code: 'hmk_cevap_dilekcesi',
    branch: 'hmk',
    title: 'Cevap dilekçesi verme süresi',
    lawRef: 'HMK m.127 (yazılı); m.317 (basit)',
    durationValue: 2,
    durationUnit: 'week',
    startEvents: ['service'],
    profile: 'P-HMK',
    periodNature: 'procedural',
    confidence: 'B',
    aliases: ['cevap dilekçesi', 'cevap süresi'],
  }),
  entry({
    no: 2,
    code: 'hmk_replik_dilekcesi',
    branch: 'hmk',
    title: 'Cevaba cevap (replik) dilekçesi süresi',
    lawRef: 'HMK m.136',
    durationValue: 2,
    durationUnit: 'week',
    startEvents: ['service'],
    profile: 'P-HMK',
    periodNature: 'procedural',
    confidence: 'B',
  }),
  entry({
    no: 3,
    code: 'hmk_duplik_dilekcesi',
    branch: 'hmk',
    title: 'Cevaba cevaba cevap (düplik) dilekçesi süresi',
    lawRef: 'HMK m.136',
    durationValue: 2,
    durationUnit: 'week',
    startEvents: ['service'],
    profile: 'P-HMK',
    periodNature: 'procedural',
    confidence: 'B',
  }),
  entry({
    no: 4,
    code: 'hmk_istinaf_basvuru',
    branch: 'hmk',
    title: 'İstinaf başvuru süresi',
    lawRef: 'HMK m.345',
    durationValue: 2,
    durationUnit: 'week',
    startEvents: ['service', 'pronouncement'],
    profile: 'P-HMK',
    periodNature: 'procedural',
    confidence: 'B',
    aliases: ['istinaf', 'istinaf başvurusu', 'istinaf süresi'],
  }),
  entry({
    no: 5,
    code: 'hmk_istinaf_cevap',
    branch: 'hmk',
    title: 'İstinaf başvurusuna cevap süresi',
    lawRef: 'HMK m.347',
    durationValue: 2,
    durationUnit: 'week',
    startEvents: ['service'],
    profile: 'P-HMK',
    periodNature: 'procedural',
    confidence: 'C',
    aliases: ['istinaf cevap', 'istinafa cevap'],
  }),
  entry({
    no: 6,
    code: 'hmk_temyiz_basvuru',
    branch: 'hmk',
    title: 'Temyiz başvuru süresi',
    lawRef: 'HMK m.361',
    durationValue: 2,
    durationUnit: 'week',
    startEvents: ['service', 'pronouncement'],
    profile: 'P-HMK',
    periodNature: 'procedural',
    confidence: 'B',
    aliases: ['temyiz', 'temyiz başvurusu'],
  }),
  entry({
    no: 7,
    code: 'hmk_bilirkisi_raporuna_itiraz',
    branch: 'hmk',
    title: 'Bilirkişi raporuna itiraz süresi',
    lawRef: 'HMK m.281',
    durationValue: 2,
    durationUnit: 'week',
    startEvents: ['service'],
    profile: 'P-HMK',
    periodNature: 'procedural',
    confidence: 'C',
    aliases: ['bilirkişi itirazı', 'bilirkişi raporuna itiraz'],
  }),
  entry({
    no: 8,
    code: 'hmk_ihtiyati_tedbir_itiraz',
    branch: 'hmk',
    title: 'İhtiyati tedbir kararına itiraz süresi',
    lawRef: 'HMK m.394',
    durationValue: 1,
    durationUnit: 'week',
    startEvents: ['service', 'pronouncement'],
    profile: 'P-HMK-NR',
    periodNature: 'procedural',
    confidence: 'C',
    extraNote: 'adli tatile tabi olmayan iş (HMK m.103)',
  }),
  entry({
    no: 9,
    code: 'hmk_ise_iade_dava',
    branch: 'hmk',
    title: 'İşe iade davası açma süresi (arabuluculuk son tutanağından)',
    lawRef: '4857 s. İş K. m.20',
    durationValue: 2,
    durationUnit: 'week',
    startEvents: ['learning'],
    profile: 'P-HMK-NR',
    periodNature: 'forfeiture',
    confidence: 'B',
    startEventLabels: { learning: 'Son tutanak düzenleme tarihi' },
    extraNote: 'adli tatile tabi olmayan iş (HMK m.103: iş sözleşmesi davaları); T-7',
  }),
  entry({
    no: 10,
    code: 'iik_odeme_emrine_itiraz',
    branch: 'iik',
    title: 'Ödeme emrine itiraz süresi',
    lawRef: 'İİK m.62',
    durationValue: 7,
    durationUnit: 'day',
    startEvents: ['service'],
    profile: 'P-IIK',
    periodNature: 'procedural',
    confidence: 'C',
    aliases: ['ödeme emrine itiraz'],
  }),
  entry({
    no: 11,
    code: 'iik_imzaya_itiraz',
    branch: 'iik',
    title: 'İmzaya itiraz süresi',
    lawRef: 'İİK m.60',
    durationValue: 5,
    durationUnit: 'day',
    startEvents: ['service'],
    profile: 'P-IIK',
    periodNature: 'procedural',
    confidence: 'C',
  }),
  entry({
    no: 12,
    code: 'iik_sikayet',
    branch: 'iik',
    title: 'İcra işlemine şikâyet süresi',
    lawRef: 'İİK m.16',
    durationValue: 7,
    durationUnit: 'day',
    startEvents: ['learning'],
    profile: 'P-IIK',
    periodNature: 'procedural',
    confidence: 'C',
  }),
  entry({
    no: 13,
    code: 'iik_ihtiyati_haciz_itiraz',
    branch: 'iik',
    title: 'İhtiyati haciz kararına itiraz süresi',
    lawRef: 'İİK m.265',
    durationValue: 7,
    durationUnit: 'day',
    startEvents: ['service', 'learning'],
    profile: 'P-IIK',
    periodNature: 'procedural',
    confidence: 'C',
  }),
  entry({
    no: 14,
    code: 'iik_itirazin_iptali_davasi',
    branch: 'iik',
    title: 'İtirazın iptali davası açma süresi',
    lawRef: 'İİK m.67',
    durationValue: 12,
    durationUnit: 'month',
    startEvents: ['service'],
    profile: 'P-IIK-GM',
    periodNature: 'forfeiture',
    confidence: 'C',
    aliases: ['itirazın iptali'],
    extraNote: 'genel mahkemede dava: adli tatil HMK tablosundan (recessBranch hmk); T-7',
  }),
  entry({
    no: 15,
    code: 'iik_icra_mahkemesi_istinaf',
    branch: 'iik',
    title: 'İcra mahkemesi kararına istinaf süresi',
    lawRef: 'İİK m.363',
    durationValue: 10,
    durationUnit: 'day',
    startEvents: ['service', 'pronouncement'],
    profile: 'P-IIK',
    periodNature: 'procedural',
    confidence: 'C',
    extraNote: 'T-12: icra mahkemesi işlerinin adli tatile tabi olmadığı görüşü doğrulanmadı',
  }),
  entry({
    no: 16,
    code: 'iyuk_dava_acma_idare',
    branch: 'iyuk',
    title: 'İdari dava açma süresi (idare mahkemesi)',
    lawRef: 'İYUK m.7',
    durationValue: 60,
    durationUnit: 'day',
    startEvents: ['service'],
    profile: 'P-IYUK',
    periodNature: 'forfeiture',
    confidence: 'B',
    aliases: ['idari dava açma', 'iptal davası'],
    extraNote: `${T5}; T-7`,
  }),
  entry({
    no: 17,
    code: 'iyuk_dava_acma_vergi',
    branch: 'iyuk',
    title: 'Vergi davası açma süresi',
    lawRef: 'İYUK m.7',
    durationValue: 30,
    durationUnit: 'day',
    startEvents: ['service'],
    profile: 'P-IYUK',
    periodNature: 'forfeiture',
    confidence: 'C',
    extraNote: `${T5}; T-7`,
  }),
  entry({
    no: 18,
    code: 'iyuk_yd_itiraz',
    branch: 'iyuk',
    title: 'Yürütmenin durdurulması kararına itiraz süresi',
    lawRef: 'İYUK m.27',
    durationValue: 7,
    durationUnit: 'day',
    startEvents: ['service'],
    profile: 'P-IYUK',
    periodNature: 'procedural',
    confidence: 'C',
    extraNote: T5,
  }),
  entry({
    no: 19,
    code: 'iyuk_istinaf',
    branch: 'iyuk',
    title: 'İdari yargı istinaf süresi',
    lawRef: 'İYUK m.45',
    durationValue: 30,
    durationUnit: 'day',
    startEvents: ['service'],
    profile: 'P-IYUK',
    periodNature: 'procedural',
    confidence: 'C',
    extraNote: `İYUK m.45 7589 s. K. ile değişti; ${T5}`,
  }),
  entry({
    no: 20,
    code: 'iyuk_temyiz',
    branch: 'iyuk',
    title: 'İdari yargı temyiz süresi',
    lawRef: 'İYUK m.46',
    durationValue: 30,
    durationUnit: 'day',
    startEvents: ['service'],
    profile: 'P-IYUK',
    periodNature: 'procedural',
    confidence: 'C',
    extraNote: `İYUK m.46 7589 s. K. ile değişti; ${T5}`,
  }),
  entry({
    no: 21,
    code: 'cmk_istinaf',
    branch: 'cmk',
    title: 'Ceza istinaf süresi',
    lawRef: 'CMK m.273',
    durationValue: 7,
    durationUnit: 'day',
    startEvents: ['pronouncement', 'service'],
    profile: 'P-CMK',
    periodNature: 'procedural',
    confidence: 'C',
    aliases: ['ceza istinaf'],
    extraNote: 'T-4; T-14: tutuklu işlerde süre işleyişi ayrıca kontrol edilir',
  }),
  entry({
    no: 22,
    code: 'cmk_temyiz',
    branch: 'cmk',
    title: 'Ceza temyiz süresi',
    lawRef: 'CMK m.291',
    durationValue: 15,
    durationUnit: 'day',
    startEvents: ['pronouncement', 'service'],
    profile: 'P-CMK',
    periodNature: 'procedural',
    confidence: 'C',
    extraNote: 'T-4; T-14: tutuklu işlerde süre işleyişi ayrıca kontrol edilir',
  }),
  entry({
    no: 23,
    code: 'cmk_itiraz_sulh_ceza',
    branch: 'cmk',
    title: 'Sulh ceza hâkimliği kararına itiraz süresi',
    lawRef: 'CMK m.268',
    durationValue: 7,
    durationUnit: 'day',
    startEvents: ['service', 'learning'],
    profile: 'P-CMK',
    periodNature: 'procedural',
    confidence: 'C',
    extraNote: 'T-4; T-14: tutuklu işlerde süre işleyişi ayrıca kontrol edilir',
  }),
  entry({
    no: 24,
    code: 'cmk_kyok_itiraz',
    branch: 'cmk',
    title: 'Kovuşturmaya yer olmadığı kararına itiraz süresi',
    lawRef: 'CMK m.173',
    durationValue: 15,
    durationUnit: 'day',
    startEvents: ['service'],
    profile: 'P-CMK',
    periodNature: 'procedural',
    confidence: 'C',
    extraNote: 'T-4',
  }),
  entry({
    no: 25,
    code: 'med_dava_sarti_genel',
    branch: 'mediation',
    title: 'Dava şartı arabuluculuk süreci (genel)',
    lawRef: '6325 s. K. m.18/A-9; 7036 m.3',
    durationValue: 3,
    durationUnit: 'week',
    startEvents: ['learning'],
    profile: 'P-MED-SURE',
    periodNature: 'process',
    confidence: 'A',
    aliases: ['arabuluculuk süresi'],
    startEventLabels: MED_LABEL,
    optionalExtensionWeeks: 1,
    extraNote:
      'kira, ortaklığın giderilmesi, kat mülkiyeti, komşu hakkı uyuşmazlıkları (6325 m.18/B) bu kuralın kapsamındadır; T-13',
  }),
  entry({
    no: 26,
    code: 'med_dava_sarti_ticari',
    branch: 'mediation',
    title: 'Dava şartı arabuluculuk süreci (ticari)',
    lawRef: 'TTK m.5/A',
    durationValue: 6,
    durationUnit: 'week',
    startEvents: ['learning'],
    profile: 'P-MED-SURE',
    periodNature: 'process',
    confidence: 'A',
    startEventLabels: MED_LABEL,
    optionalExtensionWeeks: 2,
    extraNote: 'T-13',
  }),
  entry({
    no: 27,
    code: 'is_ise_iade_arabulucu_basvuru',
    branch: 'mediation',
    title: 'İşe iadede arabulucuya başvuru süresi',
    lawRef: '4857 s. İş K. m.20',
    durationValue: 1,
    durationUnit: 'month',
    startEvents: ['service'],
    profile: 'P-MED-BASVURU',
    periodNature: 'forfeiture',
    confidence: 'C',
    aliases: ['arabulucuya başvuru'],
    extraNote: 'T-13',
  }),
];

export function catalogParams(e: DeadlineRuleCatalogEntry): DeadlineRuleParamsValue {
  const profile = PROFILES[e.profile];
  return {
    ...profile,
    optionalExtension:
      e.optionalExtensionWeeks === null
        ? profile.optionalExtension
        : { value: e.optionalExtensionWeeks, unit: 'week' },
    periodNature: e.periodNature,
    startEventLabels: { ...e.startEventLabels },
    aliases: [...e.aliases],
  };
}

export function catalogNotes(e: DeadlineRuleCatalogEntry): string {
  const base = `${CATALOG_NOTE_PREFIX}; güven ${e.confidence}`;
  return e.extraNote === null ? base : `${base}; ${e.extraNote}`;
}

/**
 * Katalog girdisini motorun kural satırına çevirir (`verified_by = NULL`; doğrulama yalnız insan
 * eliyle ve yeni seed sürümüyle işlenir, 083 §10).
 */
export function catalogRuleRecord(e: DeadlineRuleCatalogEntry): DeadlineRuleRecordValue {
  const params = catalogParams(e);
  return {
    code: e.code,
    version: 1,
    branch: e.branch,
    title: e.title,
    lawRef: e.lawRef,
    durationValue: e.durationValue,
    durationUnit: e.durationUnit,
    startEvents: [...e.startEvents],
    recessApplies: params.recessBranch !== null,
    params,
    effectiveDuring: { start: CATALOG_EFFECTIVE_FROM, endExclusive: null },
    verifiedBy: null,
    verifiedAt: null,
    supersededAt: null,
  };
}
