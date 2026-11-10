// Kayıtlı portal yanıtları (021 §7.1, SOURCE_FIXTURE_MODE=replay; yalnız development/test).
// Dosya: test/fixtures/<kaynak>/<senaryo>.json = { meta, response }. Eşleme anahtarı yöntem + URL + gövde.
// İkili yanıt (PDF) `response.body_base64` alanında saklanır; `body` o durumda boştur.
// Kayıtlar resmî kamu karar/mevzuat yanıtlarıdır (portal tarafında anonimleştirilmiş); müvekkil verisi yok.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { SourceError } from '../sources/errors.ts';
import { isBinaryContentType, type Transport, type UpstreamRequest } from './fetch.ts';

export const FixtureFile = z.object({
  meta: z.object({
    recorded_at: z.string(),
    method: z.enum(['GET', 'POST']),
    url: z.string().url(),
    request_body: z.string().nullable(),
    status: z.number().int(),
    synthetic: z.boolean(),
    note: z.string().nullable(),
  }),
  response: z.object({
    status: z.number().int(),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
    body_base64: z.string().optional(),
  }),
});
export type FixtureFileValue = z.infer<typeof FixtureFile>;

export function fixtureKey(req: Pick<UpstreamRequest, 'method' | 'url' | 'body'>): string {
  return createHash('sha256')
    .update(`${req.method} ${req.url}\n${req.body ?? ''}`)
    .digest('hex');
}

function listJson(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return listJson(p);
    return n.endsWith('.json') ? [p] : [];
  });
}

/** Ağa hiç çıkmaz; eşleşmeyen istek SOURCE_UNAVAILABLE (network) olur. */
export function createReplayTransport(fixturesDir: string): Transport {
  const map = new Map<string, FixtureFileValue['response']>();
  for (const file of listJson(fixturesDir)) {
    const parsed = FixtureFile.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) continue;
    const { meta, response } = parsed.data;
    map.set(fixtureKey({ method: meta.method, url: meta.url, body: meta.request_body }), response);
  }
  return async (req) => {
    const hit = map.get(fixtureKey(req));
    if (!hit) throw new SourceError('SOURCE_UNAVAILABLE', 'network');
    if (hit.body_base64 !== undefined) {
      return {
        status: hit.status,
        headers: hit.headers,
        body: '',
        bytes: new Uint8Array(Buffer.from(hit.body_base64, 'base64')),
      };
    }
    return { status: hit.status, headers: hit.headers, body: hit.body };
  };
}

/** Kayıt: gerçek taşıyıcıyı sarar, her yanıtı `<dir>/<senaryo>.json` dosyasına yazar. */
export function createRecordingTransport(
  inner: Transport,
  target: (req: UpstreamRequest) => { file: string; note: string | null },
  now: () => Date = () => new Date(),
): Transport {
  return async (req) => {
    const res = await inner(req);
    const { file, note } = target(req);
    const binary = res.bytes !== undefined && isBinaryContentType(res.headers['content-type']);
    const response: FixtureFileValue['response'] = binary
      ? {
          status: res.status,
          headers: { ...res.headers },
          body: '',
          body_base64: Buffer.from(res.bytes ?? new Uint8Array()).toString('base64'),
        }
      : { status: res.status, headers: { ...res.headers }, body: res.body };
    const out: FixtureFileValue = {
      meta: {
        recorded_at: now().toISOString(),
        method: req.method,
        url: req.url,
        request_body: req.body,
        status: res.status,
        synthetic: false,
        note,
      },
      response,
    };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    return res;
  };
}
