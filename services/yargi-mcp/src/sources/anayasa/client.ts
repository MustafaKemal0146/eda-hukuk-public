// AYM karar bilgi bankası istemcisi (021 §5.7.2). Canlı biçim (2026-10-10):
// `POST https://<host>/api/core/public/search`, JSON gövde (alanlar dize): `kararTipi`, `query`, `esasNo`,
// `kararNo`, `basvuruNo`, `kararTarihiStart|End` (YYYY-MM-DD), `page` (0 tabanlı), `size`; yanıt
// `{ total, page, page_size, data[] }`. Tekil karar `{ id, kararTipi, size }` ile aynı uçtan döner ve tam
// metni `icerik` (HTML) alanında taşır. İndirme ucu (`download-decision`) portalda CAPTCHA doğrulamasına
// bağlı olduğundan KULLANILMAZ (021 §5.13).
import type { McpPriority } from '@eda/contracts/mcp';
import { z } from 'zod';
import type { UpstreamGateway } from '../gateway.ts';
import { AYM_SEARCH_PATH } from './codes.ts';

const NullableText = z.string().nullish();

export const AymItem = z
  .object({
    kararTipi: z.string(),
    id: z.string().min(1),
    esasNo: NullableText,
    kararNo: NullableText,
    basvuruNo: NullableText,
    kararTarihi: NullableText,
    resmiGazeteTarihi: NullableText,
    resmiGazeteSayisi: z.union([z.number(), z.string()]).nullish(),
    kararKonusu: NullableText,
    icerik: NullableText,
    kararTuruDosyaSonucuLabel: NullableText,
    kararTuruBasvuruSonucuLabel: NullableText,
    kararVerenBirimLabel: NullableText,
    normDenetimiIncelemeGerekceleri: z
      .array(
        z
          .object({
            maddeNumaralari: z
              .array(
                z
                  .object({
                    maddeNumarasi: NullableText,
                    fikra: NullableText,
                    bent: NullableText,
                    altBent: NullableText,
                  })
                  .passthrough(),
              )
              .nullish(),
            dayanakAnayasaHukumList: z
              .array(z.object({ hukum: NullableText }).passthrough())
              .nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();
export type AymItemValue = z.infer<typeof AymItem>;

const SearchResponse = z
  .object({ total: z.number().int().nullish(), data: z.array(AymItem).nullish() })
  .passthrough();

/** Gövde alanları portalın kendi istemcisindeki gibi dizedir; anahtar sırası sabittir (fixture eşlemesi). */
export type AymSearchBody = {
  kararTipi?: string;
  query?: string;
  esasNo?: string;
  kararNo?: string;
  basvuruNo?: string;
  kararTarihiStart?: string;
  kararTarihiEnd?: string;
  id?: string;
  page?: string;
  size: string;
};

const KEY_ORDER: readonly (keyof AymSearchBody)[] = [
  'kararTipi',
  'id',
  'query',
  'esasNo',
  'kararNo',
  'basvuruNo',
  'kararTarihiStart',
  'kararTarihiEnd',
  'page',
  'size',
];

export function buildAymPayload(body: AymSearchBody): string {
  const out: Record<string, string> = {};
  for (const k of KEY_ORDER) {
    const v = body[k];
    if (v !== undefined) out[k] = v;
  }
  return JSON.stringify(out);
}

export const AYM_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
} as const;

export type AymSearchResult = { total: number | null; items: AymItemValue[] };

export async function aymSearch(
  gateway: UpstreamGateway,
  host: string,
  body: AymSearchBody,
  priority: McpPriority,
  kind: 'search' | 'doc' = 'search',
): Promise<AymSearchResult> {
  const res = await gateway.request({
    source: 'anayasa',
    bucket: 'anayasa',
    priority,
    kind,
    method: 'POST',
    url: `https://${host}${AYM_SEARCH_PATH}`,
    headers: AYM_HEADERS,
    body: buildAymPayload(body),
  });
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw gateway.reportParseError('anayasa');
  }
  const parsed = SearchResponse.safeParse(json);
  if (!parsed.success) throw gateway.reportParseError('anayasa');
  return { total: parsed.data.total ?? null, items: parsed.data.data ?? [] };
}
