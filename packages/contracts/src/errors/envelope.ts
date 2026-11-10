// REST hata zarfı (044 §3, 002 §20), Better Auth hata gövdesi (044 §7) ve akış hata meta verisi
// (044 §9.2). Zarf kökünde `error` dışında alan yoktur.
import { z } from 'zod';
import { ERROR_ACTIONS } from './actions.ts';
import { ERROR_CODES } from './codes.ts';

/**
 * `reason` biçimi. 044 §2.1 deseni `^[a-z][a-z0-9_]{1,63}$`; `BILLING_PAYMENT_FAILED`
 * `3ds_failed` değeri rakamla başladığı için ilk karakterde rakama izin verilir (AS önerisi).
 */
export const ERROR_REASON_PATTERN = /^[a-z0-9][a-z0-9_]{1,63}$/;

/** `fields[].issue` kapalı kümesi (044 §5.2). */
export const ERROR_FIELD_ISSUES = [
  'required',
  'invalid_type',
  'invalid_format',
  'invalid_enum',
  'invalid_date',
  'too_short',
  'too_long',
  'too_small',
  'too_large',
  'unrecognized_key',
  'invalid_range',
  'invalid_uuid',
  'not_allowed',
] as const;
export type ErrorFieldIssue = (typeof ERROR_FIELD_ISSUES)[number];

/** En çok alan hatası sayısı (044 §5.2). */
export const ERROR_FIELDS_MAX = 50;

export const ErrorMetaValue = z.union([
  z.string().max(64),
  z.number().int(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(64)).max(50),
]);
export type ErrorMetaValue = z.infer<typeof ErrorMetaValue>;

export const ErrorField = z.object({
  path: z.string().max(200),
  issue: z.enum(ERROR_FIELD_ISSUES),
});
export type ErrorField = z.infer<typeof ErrorField>;

export const ApiErrorEnvelope = z
  .object({
    error: z
      .object({
        code: z.enum(ERROR_CODES),
        message: z.string().min(1).max(300),
        reason: z.string().regex(ERROR_REASON_PATTERN).nullable(),
        actions: z.array(z.enum(ERROR_ACTIONS)),
        fields: z.array(ErrorField).max(ERROR_FIELDS_MAX).optional(),
        meta: z
          .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/), ErrorMetaValue)
          .nullable()
          .optional(),
        requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
      })
      .strict(),
  })
  .strict();
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelope>;

/** `/api/auth/*` gövdesi: Better Auth biçimi; hook kaynaklı hatalarda `code` katalogdandır. */
export const AuthErrorBody = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
    message: z.string().min(1).max(300),
  })
  .strict();
export type AuthErrorBody = z.infer<typeof AuthErrorBody>;

/** Akış içi hata: `message-metadata` taşıyıcısı (044 §9.2). */
export const StreamErrorMeta = z
  .object({
    status: z.literal('error'),
    errorCode: z.enum(ERROR_CODES),
    requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  })
  .strict();
export type StreamErrorMeta = z.infer<typeof StreamErrorMeta>;

const ZOD_TO_FIELD_ISSUE: Readonly<Record<string, ErrorFieldIssue>> = {
  invalid_type: 'invalid_type',
  invalid_format: 'invalid_format',
  invalid_value: 'invalid_enum',
  invalid_union: 'invalid_type',
  too_small: 'too_small',
  too_big: 'too_large',
  unrecognized_keys: 'unrecognized_key',
  not_multiple_of: 'invalid_format',
};

/**
 * Zod sorun kodunu `fields[].issue` kümesine eşler (044 §5.2); eşlenemeyen `invalid_format`.
 * Girdi `undefined` ise (alan eksik) `required` döner.
 */
export function fieldIssueOf(issue: { code: string; input?: unknown }): ErrorFieldIssue {
  if (issue.code === 'invalid_type' && 'input' in issue && issue.input === undefined) {
    return 'required';
  }
  return ZOD_TO_FIELD_ISSUE[issue.code] ?? 'invalid_format';
}
