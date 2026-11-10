// Portal HTTP taşıyıcısı (021 §5.12–§5.13): Node 24 yerleşik fetch; vekil NODE_USE_ENV_PROXY=1 +
// HTTPS_PROXY (egress-portal) ile, kodda vekil yok. redirect:'error', zaman aşımı, yanıt boyutu sınırı.
import { SourceError } from '../sources/errors.ts';

export type UpstreamRequest = {
  method: 'GET' | 'POST';
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string | null;
  timeoutMs: number;
  maxBytes: number;
};

export type UpstreamResponse = {
  status: number;
  /** Yalnız ilgili başlıklar (küçük harf ad): retry-after, content-type. */
  headers: Readonly<Record<string, string>>;
  body: string;
  /** Ham gövde (PDF gibi ikili yanıtlar için). Yoksa `body` UTF-8 kabul edilir. */
  bytes?: Uint8Array;
};

/** Yanıtın ham baytları: ikili gövde varsa o, yoksa metin gövdenin UTF-8 kodlaması. */
export function responseBytes(res: UpstreamResponse): Uint8Array {
  return res.bytes ?? Buffer.from(res.body, 'utf8');
}

export function isBinaryContentType(contentType: string | undefined): boolean {
  return /^application\/(pdf|octet-stream)\b/i.test(contentType ?? '');
}

export type Transport = (req: UpstreamRequest) => Promise<UpstreamResponse>;

/** Arama ≤ 2 MB, belge ≤ 20 MB (021 §5.12; sabit). */
export const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

const KEPT_HEADERS = ['retry-after', 'content-type'] as const;

export function createFetchTransport(fetchImpl: typeof fetch = fetch): Transport {
  return async (req) => {
    let res: Response;
    try {
      res = await fetchImpl(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        redirect: 'error',
        signal: AbortSignal.timeout(req.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && err.name === 'TimeoutError';
      throw new SourceError('SOURCE_UNAVAILABLE', timeout ? 'timeout' : 'network');
    }
    const headers: Record<string, string> = {};
    for (const name of KEPT_HEADERS) {
      const v = res.headers.get(name);
      if (v !== null) headers[name] = v;
    }
    const bytes = await readLimited(res, req.maxBytes);
    // İkili belge (PDF) metne çevrilmez: bellekte iki kopya tutulmaz.
    const binary = isBinaryContentType(headers['content-type']);
    return { status: res.status, headers, body: binary ? '' : bytes.toString('utf8'), bytes };
  };
}

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new SourceError('SOURCE_UNAVAILABLE', 'upstream_4xx');
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new SourceError('SOURCE_UNAVAILABLE', 'upstream_4xx');
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof SourceError) throw err;
    const timeout = err instanceof Error && err.name === 'TimeoutError';
    throw new SourceError('SOURCE_UNAVAILABLE', timeout ? 'timeout' : 'network');
  }
  return Buffer.concat(chunks);
}
