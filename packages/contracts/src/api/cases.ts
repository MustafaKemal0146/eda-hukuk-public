// Dava klasörü uçları (041 §4; P20 ilk dilim): `GET/POST /api/v1/cases`, `GET/PATCH /api/v1/cases/{id}`.
// Başlık ve kod kullanıcı içeriğidir: log, span ve denetim metadata'sına YAZILMAZ (Y-63).
import { z } from 'zod';
import { CASE_STATUSES, CASE_VISIBILITIES } from '../enums.ts';

const IsoDateTime = z.iso.datetime({ offset: true });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CASE_TITLE_MAX = 200;

export const CaseInput = z.strictObject({
  title: z.string().trim().min(2).max(CASE_TITLE_MAX),
  officeFileCode: z.string().trim().max(40).nullable().optional(),
  esasNo: z
    .string()
    .trim()
    .max(32)
    .regex(/^[0-9]{4}\/[0-9]{1,7}( [A-ZÇĞİÖŞÜ.]{1,6})?$|^$/u, 'esas_no_format')
    .nullable()
    .optional(),
  visibility: z.enum(CASE_VISIBILITIES).default('org'),
  openedDate: IsoDate.nullable().optional(),
});
export type CaseInputValue = z.infer<typeof CaseInput>;

export const CasePatchInput = z.strictObject({
  title: z.string().trim().min(2).max(CASE_TITLE_MAX).optional(),
  officeFileCode: z.string().trim().max(40).nullable().optional(),
  esasNo: z.string().trim().max(32).nullable().optional(),
  /** Kapatma/arşivleme vekâlet sona erme tarihi ister (DB kısıtı); bu dilimde yalnız etkin/beklemede. */
  status: z.enum(['active', 'on_hold']).optional(),
});
export type CasePatchInputValue = z.infer<typeof CasePatchInput>;

export const CaseDto = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  officeFileCode: z.string().nullable(),
  esasNo: z.string().nullable(),
  status: z.enum(CASE_STATUSES),
  visibility: z.enum(CASE_VISIBILITIES),
  openedDate: IsoDate.nullable(),
  mine: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CaseDtoValue = z.infer<typeof CaseDto>;

export const ListCasesQuery = z.strictObject({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CASE_STATUSES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListCasesQueryValue = z.infer<typeof ListCasesQuery>;

export const CaseListResponse = z.strictObject({
  items: z.array(CaseDto),
  nextCursor: z.string().nullable(),
});
export type CaseListResponseValue = z.infer<typeof CaseListResponse>;
