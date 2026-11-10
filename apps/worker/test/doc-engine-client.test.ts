// @tk TK-28
// P21 ilk dilimi: doc-engine istemcisi. Bearer ve 033 §7.4 başlıkları gönderilir; 413/422
// kalıcı ret, 5xx/bağlantı/şema dışı yanıt kesinti sayılır (işleyici erteler, durum değişmez).
import { describe, expect, it } from 'vitest';
import {
  createDocEngineClient,
  DocEngineRejectedError,
  DocEngineUnavailableError,
} from '../src/files/doc-engine.ts';

const JOB = '01990000-0000-7000-8000-000000000001';
const ok = {
  jobId: JOB,
  verdict: 'ok',
  rejectReason: null,
  fileType: 'docx',
  pageCount: null,
  hasTextLayer: true,
  text: 'Talep sonucu',
  textTruncated: false,
  pageOffsets: [],
  hiddenContent: { found: false, excludedFromText: false, items: [] },
  extractorVersion: 'eda-extract/0.0.0',
};

function client(respond: (init: RequestInit) => Response | Promise<Response>) {
  const seen: { url: string; init: RequestInit }[] = [];
  const c = createDocEngineClient({
    baseUrl: 'http://doc-engine:8002/',
    token: 'belirtec',
    timeoutMs: 1000,
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return respond(init);
    }) as unknown as typeof fetch,
  });
  return { c, seen };
}

const req = { jobId: JOB, fileType: 'docx' as const, maxPages: 500, body: Buffer.from('PK') };

describe('KK-P21-dosya: doc-engine istemcisi', () => {
  it('başlıklar ve Bearer gönderilir, yanıt şemayla doğrulanır', async () => {
    const { c, seen } = client(() => Response.json(ok));
    expect((await c.extract(req)).text).toBe('Talep sonucu');
    const h = seen[0]?.init.headers as Record<string, string>;
    expect(seen[0]?.url).toBe('http://doc-engine:8002/v1/extract');
    expect(h.authorization).toBe('Bearer belirtec');
    expect(h['X-Eda-File-Type']).toBe('docx');
    expect(h['X-Eda-Max-Pages']).toBe('500');
    expect(h['X-Eda-Job-Id']).toBe(JOB);
  });

  it('422 kalıcı ret; 503, bağlantı hatası ve şema dışı yanıt kesinti', async () => {
    await expect(
      client(() => new Response('{}', { status: 422 })).c.extract(req),
    ).rejects.toBeInstanceOf(DocEngineRejectedError);
    await expect(
      client(() => new Response('', { status: 503 })).c.extract(req),
    ).rejects.toBeInstanceOf(DocEngineUnavailableError);
    await expect(
      client(() => {
        throw new TypeError('fetch failed');
      }).c.extract(req),
    ).rejects.toMatchObject({ reason: 'connect' });
    await expect(
      client(() => Response.json({ ...ok, extra: 1 })).c.extract(req),
    ).rejects.toMatchObject({ reason: 'protocol' });
  });
});
