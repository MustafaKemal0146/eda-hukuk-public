// Adli tatil / ara verme dönemleri 2026–2028 (032 §10.4; 083 §8). 3 dal × 3 yıl = 9 satır;
// `period = [Y-07-20, Y-09-01)`. `iik` ve `mediation` için satır yoktur (032 §10.4). Hukuk onayı bekliyor.
//
// Alan -> kolon eşlemesi (030 §5, `app.judicial_recesses`):
//   branch -> branch, year -> year, period -> period (`toDateRangeLiteral` ile `[start,endExclusive)`),
//   legalBasis -> legal_basis. `id`, `created_at` DB varsayılanıdır; `verified_by` / `verified_at` NULL.
import { DEADLINE_BRANCHES } from '@eda/contracts/enums';
import { z } from 'zod';
import { DateRangeSchema, deepFreeze } from '../../catalog-common.ts';
import { HOLIDAY_YEARS } from './holidays.ts';

export const JudicialRecessRowSchema = z
  .strictObject({
    branch: z.enum(DEADLINE_BRANCHES),
    // `judicial_recesses_year_chk`: year BETWEEN 2000 AND 2100.
    year: z.number().int().min(2000).max(2100),
    period: DateRangeSchema,
    legalBasis: z.string().min(1),
  })
  .refine((r) => r.period.start.startsWith(`${r.year}-`), {
    message: 'Dönem başlangıcı satırın yılında olmalıdır.',
  });

export type JudicialRecessRow = Readonly<z.infer<typeof JudicialRecessRowSchema>>;

// 032 §10.4 adli tatil tablosu. İYUK hücresindeki "(mahkeme bazında admin_recess_exempt istisnası)"
// notu kolon değeri değil, `courts.admin_recess_exempt` göndermesidir; dayanak metnine alınmadı.
const BRANCH_BASIS = [
  { branch: 'hmk', legalBasis: 'HMK m.102' },
  { branch: 'cmk', legalBasis: 'CMK m.331' },
  { branch: 'iyuk', legalBasis: 'İYUK m.61' },
] as const;

const RECESS_START_MMDD = '07-20';
const RECESS_END_EXCLUSIVE_MMDD = '09-01';

function buildRows(): JudicialRecessRow[] {
  const rows: JudicialRecessRow[] = [];
  for (const year of HOLIDAY_YEARS) {
    for (const b of BRANCH_BASIS) {
      rows.push({
        branch: b.branch,
        year,
        period: {
          start: `${year}-${RECESS_START_MMDD}`,
          endExclusive: `${year}-${RECESS_END_EXCLUSIVE_MMDD}`,
        },
        legalBasis: b.legalBasis,
      });
    }
  }
  return rows;
}

/** 9 satır; yıl sırasıyla, yıl içinde `hmk`, `cmk`, `iyuk`. */
export const JUDICIAL_RECESSES: readonly JudicialRecessRow[] = deepFreeze(buildRows());
