// doc-engine istemcisi (033 §7.4; P21 ilk dilimi): `POST /v1/extract`, Bearer belirteci
// (`DOC_ENGINE_TOKEN_FILE`). doc-engine yalnız `docproc` ağındadır. Yanıt strict Zod şemasıyla
// doğrulanır. Altyapı kesintisi (bağlantı, 5xx, zaman aşımı, 401) `DocEngineUnavailableError`'dır:
// işleyici durumu değiştirmez, işi erteler. Belge içeriği hata/günlük metnine yazılmaz.
import {
  EXTRACT_HEADERS,
  ExtractResult,
  type ExtractResultDto,
} from '@eda/contracts/doc-engine/extract';

export class DocEngineUnavailableError extends Error {
  override name = 'DocEngineUnavailableError';
  readonly reason: 'connect' | 'timeout' | 'status' | 'protocol';
  constructor(reason: DocEngineUnavailableError['reason']) {
    super(`doc-engine kullanılamıyor: ${reason}`);
    this.reason = reason;
  }
}

/** doc-engine girdiyi kalıcı olarak reddetti (413/422); evrak `failed` olur. */
export class DocEngineRejectedError extends Error {
  override name = 'DocEngineRejectedError';
  readonly status: number;
  constructor(status: number) {
    super(`doc-engine isteği reddetti: ${status}`);
    this.status = status;
  }
}

export interface DocEngineClient {
  extract(req: {
    readonly jobId: string;
    readonly fileType: 'pdf' | 'docx' | 'txt';
    readonly maxPages: number;
    readonly body: Buffer;
  }): Promise<ExtractResultDto>;
}

export function createDocEngineClient(opts: {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
}): DocEngineClient {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/v1/extract`;
  return {
    async extract(req) {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${opts.token}`,
            'content-type': 'application/octet-stream',
            [EXTRACT_HEADERS.jobId]: req.jobId,
            [EXTRACT_HEADERS.fileType]: req.fileType,
            [EXTRACT_HEADERS.maxPages]: String(req.maxPages),
          },
          body: new Uint8Array(req.body),
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        throw new DocEngineUnavailableError(
          name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'connect',
        );
      }
      if (res.status === 413 || res.status === 422) {
        await res.body?.cancel();
        throw new DocEngineRejectedError(res.status);
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new DocEngineUnavailableError('status');
      }
      const parsed = ExtractResult.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new DocEngineUnavailableError('protocol');
      return parsed.data;
    },
  };
}
