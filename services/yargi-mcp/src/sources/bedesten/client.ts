// Bedesten emsal karar istemcisi (021 §5.7.1). Uç ve gövde biçimi 2026-10-10 canlı denemelerle doğrulandı:
// arama `data.emsalKararList[]` + `total` + `start`; belge `data.content` (base64) + `data.mimeType`;
// uygulama hatası HTTP 200 + `metadata.FMTY = "ERROR"` (ör. ADALET_RECORD_NOT_FOUND_EXCEPTION).
// Uç/parametre bilgisi saidsurucu/yargi-mcp (MIT) incelemesinden; kod kopyalanmadı (021 §5.16).
import type { McpPriority } from '@eda/contracts/mcp';
import { z } from 'zod';
import { SourceError } from '../errors.ts';
import type { UpstreamGateway } from '../gateway.ts';

export const BEDESTEN_BASE = 'https://bedesten.adalet.gov.tr';

/** API'nin çalışma koşulu olan başlıklar (021 §5.13; resmî erişim başvurusunda beyan edilir). */
export const BEDESTEN_HEADERS = {
  AdaletApplicationName: 'UyapMevzuat',
  'Content-Type': 'application/json; charset=utf-8',
  Origin: 'https://mevzuat.adalet.gov.tr',
  Referer: 'https://mevzuat.adalet.gov.tr/',
} as const;

const Metadata = z.object({ FMTY: z.string().nullish(), FMC: z.string().nullish() }).passthrough();

export const BedestenDecisionItem = z
  .object({
    documentId: z.string(),
    itemType: z.object({ name: z.string() }).passthrough(),
    birimAdi: z.string().nullish(),
    esasNoYil: z.number().nullish(),
    esasNoSira: z.number().nullish(),
    kararNoYil: z.number().nullish(),
    kararNoSira: z.number().nullish(),
    kararTuru: z.string().nullish(),
    kararTarihi: z.string().nullish(),
    kararTarihiStr: z.string().nullish(),
    kesinlesmeDurumu: z.string().nullish(),
    kararNo: z.string().nullish(),
    esasNo: z.string().nullish(),
  })
  .passthrough();
export type BedestenDecisionItemValue = z.infer<typeof BedestenDecisionItem>;

const SearchResponse = z.object({
  data: z
    .object({
      emsalKararList: z.array(BedestenDecisionItem).nullish(),
      total: z.number().nullish(),
      start: z.number().nullish(),
    })
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

export type BedestenSearchBody = {
  pageSize: number;
  pageNumber: number;
  itemTypeList: string[];
  phrase: string;
  birimAdi?: string;
  kararTarihiStart?: string;
  kararTarihiEnd?: string;
};

export type BedestenSearchResult = {
  total: number | null;
  start: number | null;
  items: BedestenDecisionItemValue[];
};

function parseJson(gateway: UpstreamGateway, body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw gateway.reportParseError('bedesten');
  }
}

/** Arama gövdesi: `sortFields` gönderilmez → portal alaka sırasıyla döner (AS-P11-07). */
export function buildSearchPayload(data: BedestenSearchBody): string {
  return JSON.stringify({ data, applicationName: 'UyapMevzuat', paging: true });
}

export async function bedestenSearch(
  gateway: UpstreamGateway,
  data: BedestenSearchBody,
  priority: McpPriority,
): Promise<BedestenSearchResult> {
  const res = await gateway.request({
    source: 'bedesten',
    bucket: 'bedesten',
    priority,
    kind: 'search',
    method: 'POST',
    url: `${BEDESTEN_BASE}/emsal-karar/searchDocuments`,
    headers: BEDESTEN_HEADERS,
    body: buildSearchPayload(data),
  });
  const parsed = SearchResponse.safeParse(parseJson(gateway, res.body));
  if (!parsed.success) throw gateway.reportParseError('bedesten');
  const { data: d, metadata } = parsed.data;
  if (metadata?.FMTY === 'ERROR') {
    if (metadata.FMC === 'ADALET_EMPTY_EXCEPTION') return { total: 0, start: 0, items: [] };
    throw new SourceError('SOURCE_UNAVAILABLE', 'upstream_4xx', { source: 'bedesten' });
  }
  if (!d) return { total: 0, start: 0, items: [] };
  return { total: d.total ?? null, start: d.start ?? null, items: d.emsalKararList ?? [] };
}

export type BedestenDocument = { mimeType: 'text/html' | 'application/pdf'; bytes: Buffer };

export async function bedestenGetDocument(
  gateway: UpstreamGateway,
  documentId: string,
  priority: McpPriority,
): Promise<BedestenDocument> {
  const res = await gateway.request({
    source: 'bedesten',
    bucket: 'bedesten',
    priority,
    kind: 'doc',
    method: 'POST',
    url: `${BEDESTEN_BASE}/emsal-karar/getDocumentContent`,
    headers: BEDESTEN_HEADERS,
    body: JSON.stringify({ data: { documentId }, applicationName: 'UyapMevzuat' }),
  });
  const parsed = DocResponse.safeParse(parseJson(gateway, res.body));
  if (!parsed.success) throw gateway.reportParseError('bedesten');
  const { data: d, metadata } = parsed.data;
  if (metadata?.FMC === 'ADALET_RECORD_NOT_FOUND_EXCEPTION') {
    throw new SourceError('SOURCE_DOCUMENT_NOT_FOUND', null, { source: 'bedesten' });
  }
  if (metadata?.FMTY === 'ERROR') {
    throw new SourceError('SOURCE_UNAVAILABLE', 'upstream_4xx', { source: 'bedesten' });
  }
  if (!d?.content) throw gateway.reportParseError('bedesten');
  const mime = d.mimeType ?? '';
  if (mime !== 'text/html' && mime !== 'application/pdf')
    throw gateway.reportParseError('bedesten');
  return { mimeType: mime, bytes: Buffer.from(d.content, 'base64') };
}
