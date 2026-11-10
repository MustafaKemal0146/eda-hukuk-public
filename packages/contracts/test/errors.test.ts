// @tk TK-28
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ApiErrorEnvelope,
  AppError,
  AppErrorContractError,
  ERROR_ACTIONS,
  ERROR_CATALOG,
  ERROR_CODE_PATTERN,
  ERROR_CODES,
  ERROR_MESSAGES_TR,
  ERROR_META_KEYS,
  ERROR_PREFIXES,
  ERROR_REASON_PATTERN,
  type ErrorCode,
  type ErrorSpec,
  errorMessageTr,
  fieldIssueOf,
  httpStatusOf,
  isErrorCode,
  prefixOf,
  StreamErrorMeta,
  toEnvelope,
} from '../src/errors/index.ts';

type Canon = { prefixes: string[]; codes: Record<string, number | null> };
const canon = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'canon-errors.json'), 'utf8'),
) as Canon;

const specs = Object.entries(ERROR_CATALOG) as [ErrorCode, ErrorSpec][];
const REQUEST_ID = '0192f1c2-7a4b-7c3e-9d10-2b3c4d5e6f70';

describe('KK-P01b-3 KK-002-14 önekler ve kodlar', () => {
  it('KK-P01b-3: önek kümesi 23 elemanlı, tekrarsız ve 002 §20 ile birebir', () => {
    expect(ERROR_PREFIXES).toHaveLength(23);
    expect(new Set(ERROR_PREFIXES).size).toBe(23);
    expect([...ERROR_PREFIXES]).toEqual(canon.prefixes);
  });

  it('KK-P01b-3: prefixOf en uzun eşleşmeyi seçer', () => {
    expect(prefixOf('AI_POLICY_NO_PROVIDER')).toBe('AI_POLICY_');
    expect(prefixOf('AUTH_FORBIDDEN')).toBe('AUTH_');
    expect(prefixOf('VALIDATION_FAILED')).toBe('VALIDATION_');
    expect(prefixOf('AI_UNKNOWN')).toBeNull();
    expect(prefixOf('AUTHZ_ROLE_INSUFFICIENT')).toBeNull();
    expect(prefixOf('AUTH_')).toBeNull();
  });

  it.each(ERROR_CODES)('KK-002-14: %s biçimli ve kapalı önek kümesinden', (code) => {
    expect(code).toMatch(ERROR_CODE_PATTERN);
    expect(prefixOf(code)).not.toBeNull();
  });

  it('KK-002-14: kodlar tekrarsız ve isErrorCode ile tanınır', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(isErrorCode('INTERNAL_ERROR')).toBe(true);
    expect(isErrorCode('INTERNAL_UNEXPECTED')).toBe(false);
  });

  it('KK-P01b-3: 002 §20 kodlarının tamamı katalogda', () => {
    const missing = Object.keys(canon.codes).filter((c) => !isErrorCode(c));
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(canon.codes))(
    'KK-P01b-3 KK-002-14: %s HTTP durumu 002 §20 ile aynı',
    (code, status) => {
      expect(isErrorCode(code)).toBe(true);
      if (isErrorCode(code)) expect(httpStatusOf(code)).toBe(status);
    },
  );

  it('KK-P01b-3: yalnız TOOL_ kodlarının HTTP yüzü yok', () => {
    for (const [code, spec] of specs) {
      expect(spec.http === null, code).toBe(code.startsWith('TOOL_'));
    }
  });
});

describe('KK-P01b-3 katalog tutarlılığı (044 §4-§6)', () => {
  it('KK-P01b-3: reason biçimi, eylem ve meta anahtarları kapalı kümelerden', () => {
    for (const [code, spec] of specs) {
      for (const r of spec.reasons ?? []) expect(r, code).toMatch(ERROR_REASON_PATTERN);
      for (const a of spec.actions ?? []) expect(ERROR_ACTIONS, code).toContain(a);
      for (const m of spec.meta ?? []) expect(ERROR_META_KEYS, code).toContain(m);
      expect(new Set(spec.reasons ?? []).size, code).toBe((spec.reasons ?? []).length);
    }
  });

  it('KK-P01b-3: 429 ve 503 kodları Retry-After taşır; retryAfterSec meta anahtarı izinli', () => {
    for (const [code, spec] of specs) {
      if (spec.http === 429 || spec.http === 503) expect(spec.retryAfter, code).toBeDefined();
      if (spec.retryAfter !== undefined) expect(spec.meta ?? [], code).toContain('retryAfterSec');
    }
    expect(ERROR_CATALOG.QUOTA_CONCURRENCY_LIMIT.retryAfter).toBe('optional');
    expect(ERROR_CATALOG.VALIDATION_IDEMPOTENCY_IN_PROGRESS.retryAfter).toBe('required');
  });

  it('KK-P01b-3: reason metinleri yalnız kodun reason kümesindeki değerler için', () => {
    for (const [code, spec] of specs) {
      for (const r of Object.keys(spec.messageByReason ?? {})) {
        expect(spec.reasons ?? [], code).toContain(r);
      }
    }
  });
});

describe('KK-P01b-3 KK-002-14 KK-044-13 Türkçe mesajlar', () => {
  const texts = Object.entries(ERROR_MESSAGES_TR).flatMap(([code, entry]) => {
    const byReason: Readonly<Record<string, string | undefined>> =
      'byReason' in entry ? entry.byReason : {};
    return [
      [code, entry.message] as const,
      ...Object.entries(byReason).map(([r, t]) => [`${code}.${r}`, t ?? ''] as const),
    ];
  });

  it.each(texts)('KK-P01b-3: %s metni değişken içermez', (_key, text) => {
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(200);
    expect(text).not.toMatch(/[{}%$<>]/);
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/deepseek|azure|openai|mistral|anthropic|claude|vertex/i);
  });

  it('KK-044-13: her kodun tek varsayılan metni var', () => {
    expect(Object.keys(ERROR_MESSAGES_TR).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('KK-044-6: CASE_ACCESS_DENIED ve CASE_NOT_FOUND metni aynı', () => {
    expect(errorMessageTr('CASE_ACCESS_DENIED')).toBe(errorMessageTr('CASE_NOT_FOUND'));
  });
});

describe('KK-P01b-3 KK-044-3 ApiErrorEnvelope (044 §3)', () => {
  const valid = {
    error: {
      code: 'AI_POLICY_NO_PROVIDER',
      message: errorMessageTr('AI_POLICY_NO_PROVIDER'),
      reason: 'no_provider_for_class',
      actions: ['new_public_conversation', 'remove_personal_data', 'notify_org_admin'],
      meta: null,
      requestId: REQUEST_ID,
    },
  };

  it('KK-044-3: 044 §3 örneği geçerli', () => {
    expect(ApiErrorEnvelope.safeParse(valid).success).toBe(true);
  });

  it('KK-044-3: fields taşıyan VALIDATION_FAILED geçerli', () => {
    const body = {
      error: {
        code: 'VALIDATION_FAILED',
        message: errorMessageTr('VALIDATION_FAILED'),
        reason: null,
        actions: [],
        fields: [{ path: 'body.decisionDate', issue: 'invalid_date' }],
        requestId: REQUEST_ID,
      },
    };
    expect(ApiErrorEnvelope.safeParse(body).success).toBe(true);
  });

  it.each([
    ['kökte success', { ...valid, success: false }],
    ['katalog dışı kod', { error: { ...valid.error, code: 'INTERNAL_UNEXPECTED' } }],
    ['status_code alanı', { error: { ...valid.error, status_code: 409 } }],
    ['details alanı', { error: { ...valid.error, details: {} } }],
    ['bilinmeyen eylem', { error: { ...valid.error, actions: ['retry_now'] } }],
    ['requestId yok', { error: { ...valid.error, requestId: undefined } }],
    ['geçersiz requestId', { error: { ...valid.error, requestId: '<script>' } }],
    ['boş mesaj', { error: { ...valid.error, message: '' } }],
    ['reason biçimi', { error: { ...valid.error, reason: 'No Provider' } }],
    [
      'fields issue kümesi dışı',
      {
        error: { ...valid.error, fields: [{ path: 'body.x', issue: 'bad' }] },
      },
    ],
  ])('KK-044-3: geçersiz zarf reddedilir (%s)', (_label, body) => {
    expect(ApiErrorEnvelope.safeParse(body).success).toBe(false);
  });

  it('KK-044-8: akış hata meta verisi katalog kodu taşır', () => {
    const meta = { status: 'error', errorCode: 'LLM_PROVIDER_ERROR', requestId: REQUEST_ID };
    expect(StreamErrorMeta.safeParse(meta).success).toBe(true);
    expect(StreamErrorMeta.safeParse({ ...meta, errorCode: 'PROVIDER_UNAVAILABLE' }).success).toBe(
      false,
    );
  });
});

describe('KK-P01b-3 KK-044-3 AppError', () => {
  it('KK-P01b-3: katalog kodu ve reason ile kurulur, zarfa çevrilir', () => {
    const err = new AppError('INTERNAL_MAINTENANCE', {
      reason: 'maintenance_mode',
      meta: { retryAfterSec: 60 },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('INTERNAL_MAINTENANCE');
    const envelope = toEnvelope(err, REQUEST_ID);
    expect(ApiErrorEnvelope.parse(envelope)).toEqual(envelope);
    expect(envelope.error.message).toBe(
      ERROR_MESSAGES_TR.INTERNAL_MAINTENANCE.byReason.maintenance_mode,
    );
    expect(envelope.error.reason).toBe('maintenance_mode');
    expect(envelope.error.meta).toEqual({ retryAfterSec: 60 });
    expect(envelope.error.fields).toBeUndefined();
    expect(httpStatusOf(err.code)).toBe(503);
  });

  it('KK-P01b-3: varsayılanlar reason null, actions boş, meta null', () => {
    const envelope = toEnvelope(new AppError('VALIDATION_ROUTE_NOT_FOUND'), REQUEST_ID);
    expect(envelope.error).toEqual({
      code: 'VALIDATION_ROUTE_NOT_FOUND',
      message: errorMessageTr('VALIDATION_ROUTE_NOT_FOUND'),
      reason: null,
      actions: [],
      meta: null,
      requestId: REQUEST_ID,
    });
  });

  it('KK-044-4: fields yalnız VALIDATION_FAILED; değer taşımaz', () => {
    const err = new AppError('VALIDATION_FAILED', {
      fields: [{ path: 'body.tckn', issue: 'invalid_format' }],
    });
    expect(toEnvelope(err, REQUEST_ID).error.fields).toEqual([
      { path: 'body.tckn', issue: 'invalid_format' },
    ]);
  });

  it('KK-P01b-3: katalog dışı kod tip hatası ve çalışma zamanı hatası', () => {
    // @ts-expect-error katalog dışı kod derlenmez
    expect(() => new AppError('INTERNAL_UNEXPECTED')).toThrow(AppErrorContractError);
  });

  it('KK-P01b-3 KK-044-3: kataloğa uymayan reason reddedilir', () => {
    // @ts-expect-error AUTH_FORBIDDEN reason kümesinde yok
    expect(() => new AppError('AUTH_FORBIDDEN', { reason: 'no_provider_for_class' })).toThrow(
      AppErrorContractError,
    );
    // @ts-expect-error reason kümesi olmayan kod reason almaz
    expect(() => new AppError('ORG_NOT_MEMBER', { reason: 'policy_denied' })).toThrow(
      AppErrorContractError,
    );
  });

  it('KK-044-3: kataloğa uymayan actions, meta ve fields reddedilir', () => {
    // @ts-expect-error AUTH_UNAUTHENTICATED yalnız login eylemi alır
    expect(() => new AppError('AUTH_UNAUTHENTICATED', { actions: ['reload'] })).toThrow(
      AppErrorContractError,
    );
    // @ts-expect-error FILE_TOO_LARGE meta anahtarı yalnız maxBytes
    expect(() => new AppError('FILE_TOO_LARGE', { meta: { fileName: 'x' } })).toThrow(
      AppErrorContractError,
    );
    expect(() => new AppError('FILE_TOO_LARGE', { meta: { maxBytes: 'a'.repeat(65) } })).toThrow(
      AppErrorContractError,
    );
    // @ts-expect-error fields yalnız VALIDATION_FAILED
    expect(() => new AppError('VALIDATION_CONFLICT', { fields: [] })).toThrow(
      AppErrorContractError,
    );
    const tooMany = Array.from({ length: 51 }, () => ({
      path: 'body.x',
      issue: 'required' as const,
    }));
    expect(() => new AppError('VALIDATION_FAILED', { fields: tooMany })).toThrow(
      AppErrorContractError,
    );
  });

  it('KK-P01b-3: hata iletisi değer taşımaz', () => {
    const secret = `gizli-deger-${'x'.repeat(64)}`;
    let error: unknown;
    try {
      new AppError('FILE_TOO_LARGE', { meta: { maxBytes: secret } });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AppErrorContractError);
    expect((error as Error).message).toContain('FILE_TOO_LARGE');
    expect((error as Error).message).not.toContain('gizli-deger');
  });

  it('KK-P01b-3: Zod sorun kodu fields issue kümesine eşlenir', () => {
    expect(fieldIssueOf({ code: 'too_big' })).toBe('too_large');
    expect(fieldIssueOf({ code: 'unrecognized_keys' })).toBe('unrecognized_key');
    expect(fieldIssueOf({ code: 'invalid_type', input: undefined })).toBe('required');
    expect(fieldIssueOf({ code: 'custom' })).toBe('invalid_format');
  });
});
