// Uygulama hatası: yalnız katalog kodlarını kabul eder; `reason`, `actions`, `meta` ve `fields`
// kataloğa göre derleme zamanında (tipler) ve çalışma zamanında (kurucu) doğrulanır (044 §2.3,
// §5; KK-044-3). Hata nesnesi değer taşımaz; Error `message` alanı yalnız koddur.
import {
  type ActionOf,
  ERROR_CATALOG,
  type ErrorCode,
  type ErrorHttpStatus,
  type ErrorSpec,
  type MetaKeyOf,
  type ReasonOf,
} from './catalog.ts';
import { isErrorCode } from './codes.ts';
import { ApiErrorEnvelope, ERROR_FIELDS_MAX, ErrorField, ErrorMetaValue } from './envelope.ts';

type FieldsFor<C extends ErrorCode> = C extends 'VALIDATION_FAILED' ? readonly ErrorField[] : never;

export type AppErrorMeta<C extends ErrorCode> = Readonly<
  Partial<Record<MetaKeyOf<C>, ErrorMetaValue>>
>;

export type AppErrorOptions<C extends ErrorCode> = {
  reason?: ReasonOf<C> | null;
  actions?: readonly ActionOf<C>[];
  meta?: AppErrorMeta<C> | null;
  /** Yalnız `VALIDATION_FAILED`. */
  fields?: FieldsFor<C>;
  /** Yalnız log içindir; yanıta yazılmaz (044 Tuzak 10). */
  cause?: unknown;
};

/** Katalog sözleşmesine aykırı `AppError` kurulumu. İleti yalnız kod ve alan adını içerir. */
export class AppErrorContractError extends TypeError {
  override name = 'AppErrorContractError';
}

function specOf(code: ErrorCode): ErrorSpec {
  return ERROR_CATALOG[code];
}

function fail(code: string, part: string): never {
  throw new AppErrorContractError(`AppError(${code}): ${part} katalogla uyuşmuyor`);
}

function validate(code: unknown, options: AppErrorOptions<ErrorCode>): void {
  if (!isErrorCode(code)) {
    throw new AppErrorContractError('AppError: katalog dışı hata kodu');
  }
  const spec = specOf(code);
  const { reason, actions, meta, fields } = options;
  if (reason !== undefined && reason !== null && !(spec.reasons ?? []).includes(reason)) {
    fail(code, 'reason');
  }
  if (actions !== undefined) {
    const allowed = spec.actions ?? [];
    if (actions.some((a) => !allowed.includes(a)) || new Set(actions).size !== actions.length) {
      fail(code, 'actions');
    }
  }
  if (meta !== undefined && meta !== null) {
    const allowed: readonly string[] = spec.meta ?? [];
    for (const [key, value] of Object.entries(meta)) {
      if (!allowed.includes(key) || !ErrorMetaValue.safeParse(value).success) fail(code, 'meta');
    }
  }
  if (fields !== undefined) {
    if (code !== 'VALIDATION_FAILED' || fields.length > ERROR_FIELDS_MAX) fail(code, 'fields');
    for (const field of fields) {
      if (!ErrorField.safeParse(field).success) fail(code, 'fields');
    }
  }
}

export class AppError<C extends ErrorCode = ErrorCode> extends Error {
  override name = 'AppError';
  readonly code: C;
  readonly reason: ReasonOf<C> | null;
  readonly actions: readonly ActionOf<C>[];
  readonly meta: AppErrorMeta<C> | null;
  readonly fields: readonly ErrorField[] | undefined;

  constructor(code: C, options: AppErrorOptions<C> = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    validate(code, options as AppErrorOptions<ErrorCode>);
    this.code = code;
    this.reason = options.reason ?? null;
    this.actions = options.actions ?? [];
    this.meta = options.meta ?? null;
    this.fields = options.fields;
  }
}

/** Kodun HTTP durumu (002 §20); `TOOL_*` gibi HTTP yüzü olmayan kodlarda `null`. */
export function httpStatusOf(code: ErrorCode): ErrorHttpStatus | null {
  return specOf(code).http;
}

/** Kod (ve varsa `reason`) için Türkçe kullanıcı metni (messages.tr.ts). */
export function errorMessageTr(code: ErrorCode, reason?: string | null): string {
  const spec = specOf(code);
  const byReason =
    reason === undefined || reason === null ? undefined : spec.messageByReason?.[reason];
  return byReason ?? spec.message;
}

/** `AppError`'u 044 §3 zarfına çevirir; çıktı `ApiErrorEnvelope` şemasıyla doğrulanır. */
export function toEnvelope(err: AppError, requestId: string): ApiErrorEnvelope {
  return ApiErrorEnvelope.parse({
    error: {
      code: err.code,
      message: errorMessageTr(err.code, err.reason),
      reason: err.reason,
      actions: [...err.actions],
      ...(err.fields === undefined ? {} : { fields: err.fields.map((f) => ({ ...f })) }),
      meta: err.meta === null ? null : { ...err.meta },
      requestId,
    },
  });
}
