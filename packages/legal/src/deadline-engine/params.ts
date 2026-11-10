// Kural parametreleri (083 §2.2). Zod şeması `@eda/contracts/api/deadlines`'tadır (tek kaynak);
// bu dosya motorun kural yükleyicisini ve 083 §2.2 ön ayar profillerini taşır. Profiller DB'de
// tutulmaz: yalnız katalog yazımı ve test/doğrulama sabitidir; satırda tam anahtar kümesi bulunur.
import {
  DeadlineRuleParams,
  type DeadlineRuleParamsValue,
  DeadlineRuleRecord,
  type DeadlineRuleRecordValue,
} from '@eda/contracts/api/deadlines';

export type { DeadlineRuleParamsValue, DeadlineRuleRecordValue };
export { DeadlineRuleParams, DeadlineRuleRecord };

export type DeadlineEngineErrorCode = 'rule_invalid' | 'chain_limit_exceeded' | 'rule_mismatch';

/** Motorun iç hatası: veri bozukluğu veya sözleşme ihlali (sessiz devam yok; 083 Not 6). */
export class DeadlineEngineError extends Error {
  readonly code: DeadlineEngineErrorCode;
  constructor(code: DeadlineEngineErrorCode, message: string) {
    super(message);
    this.name = 'DeadlineEngineError';
    this.code = code;
  }
}

/**
 * Kural satırını doğrular ve motora yükler. Bozuk satır (ör. N6: `recess_applies = true`,
 * `recessBranch = null`) yüklenmez: `DeadlineEngineError('rule_invalid')` (KK-083-1, KK-083-3).
 */
export function parseDeadlineRule(row: unknown): DeadlineRuleRecordValue {
  const parsed = DeadlineRuleRecord.safeParse(row);
  if (!parsed.success) {
    const code =
      row !== null && typeof row === 'object' && 'code' in row ? String(row.code) : '(bilinmiyor)';
    throw new DeadlineEngineError('rule_invalid', `Süre kuralı satırı geçersiz: ${code}`);
  }
  return parsed.data;
}

/** 083 §2.2 ön ayar tablosunun strateji anahtarları (`periodNature`, etiketler, takma adlar hariç). */
export type ProfileParams = Pick<
  DeadlineRuleParamsValue,
  | 'startNextDay'
  | 'holidayShift'
  | 'saturdayPolicy'
  | 'endTime'
  | 'recessBranch'
  | 'recessExtension'
  | 'optionalExtension'
>;

export const PROFILE_IDS = [
  'P-HMK',
  'P-HMK-NR',
  'P-CMK',
  'P-IYUK',
  'P-IIK',
  'P-IIK-GM',
  'P-MED-SURE',
  'P-MED-BASVURU',
] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

const day = (value: number) => ({ value, unit: 'day' }) as const;
const SHIFT = {
  startNextDay: true,
  holidayShift: 'next_working_day',
  saturdayPolicy: 'shift',
  endTime: 'office_close',
} as const;

/**
 * 083 §2.2 ön ayarları. `P-MED-SURE` `optionalExtension` kurala göre 1 veya 2 haftadır; burada
 * `null` yazılır ve katalog satırı değeri verir. Hukuk onayı bekliyor (T-2, T-3, T-7, T-12, T-13).
 */
export const PROFILES: Readonly<Record<ProfileId, ProfileParams>> = {
  'P-HMK': { ...SHIFT, recessBranch: 'hmk', recessExtension: day(7), optionalExtension: null },
  'P-HMK-NR': { ...SHIFT, recessBranch: null, recessExtension: null, optionalExtension: null },
  'P-CMK': { ...SHIFT, recessBranch: 'cmk', recessExtension: day(3), optionalExtension: null },
  'P-IYUK': { ...SHIFT, recessBranch: 'iyuk', recessExtension: day(7), optionalExtension: null },
  'P-IIK': { ...SHIFT, recessBranch: null, recessExtension: null, optionalExtension: null },
  'P-IIK-GM': { ...SHIFT, recessBranch: 'hmk', recessExtension: day(7), optionalExtension: null },
  'P-MED-SURE': {
    startNextDay: true,
    holidayShift: 'none',
    saturdayPolicy: 'workday',
    endTime: 'end_of_day',
    recessBranch: null,
    recessExtension: null,
    optionalExtension: null,
  },
  'P-MED-BASVURU': {
    ...SHIFT,
    recessBranch: null,
    recessExtension: null,
    optionalExtension: null,
  },
};
