// Mevzuat canlı istemcisi (021 §5.7.4 aday 1: Bedesten mevzuat uçları). 2026-10-10 canlı doğrulandı:
// `POST /mevzuat/searchDocuments` (`mevzuatNo`, `mevzuatAdi`, `mevzuatTurList`) → `data.mevzuatList[]`;
// `POST /mevzuat/getDocumentContent` `{documentType:"MEVZUAT", id:<mevzuatId>}` → base64 HTML konsolide metin.
// Uç bilgisi saidsurucu/mevzuat-mcp (MIT) incelemesinden; kod kopyalanmadı (021 §5.16).
import type { McpPriority } from '@eda/contracts/mcp';
import { z } from 'zod';
import { BEDESTEN_BASE, BEDESTEN_HEADERS } from '../bedesten/client.ts';
import { SourceError } from '../errors.ts';
import type { UpstreamGateway } from '../gateway.ts';

const Metadata = z.object({ FMTY: z.string().nullish(), FMC: z.string().nullish() }).passthrough();

export const MevzuatItem = z
  .object({
    mevzuatId: z.string(),
    mevzuatNo: z.number().int(),
    mevzuatAdi: z.string(),
    mevzuatTur: z.object({ id: z.number().int(), name: z.string() }).passthrough(),
    mevzuatTertip: z.number().int(),
    resmiGazeteTarihi: z.string().nullish(),
    guncellemeTarihi: z.string().nullish(),
  })
  .passthrough();
export type MevzuatItemValue = z.infer<typeof MevzuatItem>;

const SearchResponse = z.object({
  data: z
    .object({ mevzuatList: z.array(MevzuatItem).nullish(), total: z.number().nullish() })
    .passthrough()
    .nullable(),
  metadata: Metadata.nullish(),
});

const DocResponse = z.object({
  data: z
    .object({ content: z.string().nullish(), mimeType: z.string().nullish() })
    .passthrough()
    .nullable(),
  metadata: Metadata.nullish(),
});

export type MevzuatSearchBody = {
  pageSize: number;
  pageNumber: number;
  mevzuatNo?: string;
  mevzuatAdi?: string;
  mevzuatTurList?: string[];
};

function parse<T>(gateway: UpstreamGateway, schema: z.ZodType<T>, body: string): T {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw gateway.reportParseError('mevzuat');
  }
  const r = schema.safeParse(json);
  if (!r.success) throw gateway.reportParseError('mevzuat');
  return r.data;
}

export async function mevzuatSearch(
  gateway: UpstreamGateway,
  data: MevzuatSearchBody,
  priority: McpPriority,
): Promise<{ total: number | null; items: MevzuatItemValue[] }> {
  const res = await gateway.request({
    source: 'mevzuat',
    bucket: 'bedesten',
    priority,
    kind: 'search',
    method: 'POST',
    url: `${BEDESTEN_BASE}/mevzuat/searchDocuments`,
    headers: BEDESTEN_HEADERS,
    body: JSON.stringify({ data, applicationName: 'UyapMevzuat', paging: true }),
  });
  const { data: d, metadata } = parse(gateway, SearchResponse, res.body);
  if (metadata?.FMTY === 'ERROR') {
    if (metadata.FMC === 'ADALET_EMPTY_EXCEPTION') return { total: 0, items: [] };
    throw new SourceError('SOURCE_UNAVAILABLE', 'upstream_4xx', { source: 'mevzuat' });
  }
  return { total: d?.total ?? null, items: d?.mevzuatList ?? [] };
}

export async function mevzuatGetDocument(
  gateway: UpstreamGateway,
  mevzuatId: string,
  priority: McpPriority,
): Promise<Buffer> {
  const res = await gateway.request({
    source: 'mevzuat',
    bucket: 'bedesten',
    priority,
    kind: 'doc',
    method: 'POST',
    url: `${BEDESTEN_BASE}/mevzuat/getDocumentContent`,
    headers: BEDESTEN_HEADERS,
    body: JSON.stringify({
      data: { documentType: 'MEVZUAT', id: mevzuatId },
      applicationName: 'UyapMevzuat',
      paging: true,
    }),
  });
  const { data: d, metadata } = parse(gateway, DocResponse, res.body);
  if (metadata?.FMC === 'ADALET_RECORD_NOT_FOUND_EXCEPTION') {
    throw new SourceError('SOURCE_DOCUMENT_NOT_FOUND', null, { source: 'mevzuat' });
  }
  if (metadata?.FMTY === 'ERROR') {
    throw new SourceError('SOURCE_UNAVAILABLE', 'upstream_4xx', { source: 'mevzuat' });
  }
  if (!d?.content || d.mimeType !== 'text/html') throw gateway.reportParseError('mevzuat');
  return Buffer.from(d.content, 'base64');
}
