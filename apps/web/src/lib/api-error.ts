// api hata zarfı (002 §20: `{ error: { code, message, requestId, ... } }`) okuyucusu. Sunucu iletisi
// Türkçe ve düzelticidir; tarayıcı ham gövdeyi göstermez, yalnız ileti + destek kodu (requestId).

export type ApiErrorInfo = {
  code: string;
  /** Sunucunun Türkçe iletisi; zarf okunamadıysa `null` (çağıran genel metni gösterir). */
  message: string | null;
  requestId: string | null;
  status: number | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Zarf gövdesini (JSON metni veya nesne) okur; tanınmazsa `null`. */
export function parseErrorEnvelope(
  body: unknown,
  status: number | null = null,
): ApiErrorInfo | null {
  let value: unknown = body;
  if (typeof body === 'string') {
    try {
      value = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const e = value.error;
  if (typeof e.code !== 'string') return null;
  return {
    code: e.code,
    message: typeof e.message === 'string' && e.message !== '' ? e.message : null,
    requestId: typeof e.requestId === 'string' ? e.requestId : null,
    status,
  };
}

export class ApiError extends Error {
  readonly info: ApiErrorInfo;
  constructor(info: ApiErrorInfo) {
    super(info.code);
    this.name = 'ApiError';
    this.info = info;
  }
}

/** Herhangi bir hatadan gösterilebilir bilgi: ApiError, AI SDK APICallError (gövde iletide) veya ağ hatası. */
export function errorInfoOf(err: unknown): ApiErrorInfo {
  if (err instanceof ApiError) return err.info;
  if (err instanceof Error) {
    const parsed = parseErrorEnvelope(err.message);
    if (parsed) return parsed;
  }
  return { code: 'CLIENT_UNKNOWN', message: null, requestId: null, status: null };
}
