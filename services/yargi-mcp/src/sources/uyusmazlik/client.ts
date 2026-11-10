// Uyuşmazlık Mahkemesi istemcisi (021 §5.7.3). Canlı biçim (2026-10-10): eski `POST /Arama/Search`
// ucu kaldırılmış; arama ana sayfadaki WebForms formuyla yapılır: `GET /` gizli alanları verir, `POST /`
// (`application/x-www-form-urlencoded`) `txtSearch` + `rblSearchScope` (`All` | `EsasNo` | `KararNo`) ile
// sonuç tablosunu döndürür. Sayfalama form geri gönderimiyle olduğundan yalnız ilk sayfa kullanılır.
// Belge: tablodaki göreli PDF yolu, `GET https://kararlar.uyusmazlik.gov.tr/<yol>`. TLS doğrulaması açık.
import type { McpPriority } from '@eda/contracts/mcp';
import { responseBytes } from '../../http/fetch.ts';
import { SourceError } from '../errors.ts';
import type { UpstreamGateway } from '../gateway.ts';
import { UYUSMAZLIK_BASE, uyusmazlikPublicUrl } from './document-id.ts';
import {
  parseFormTokens,
  parseSearchPage,
  type UyusmazlikFormTokens,
  type UyusmazlikPage,
} from './parse.ts';

export const SEARCH_SCOPES = ['All', 'EsasNo', 'KararNo'] as const;
export type UyusmazlikScope = (typeof SEARCH_SCOPES)[number];

/** Form alanları portalın gönderdiği sırayla; `chkCaseSensitive` işaretsiz olduğundan gönderilmez. */
export function buildSearchForm(
  tokens: UyusmazlikFormTokens,
  text: string,
  scope: UyusmazlikScope,
): string {
  return new URLSearchParams([
    ['__VIEWSTATE', tokens.viewState],
    ['__VIEWSTATEGENERATOR', tokens.viewStateGenerator],
    ['__EVENTVALIDATION', tokens.eventValidation],
    ['txtSearch', text],
    ['rblSearchScope', scope],
    ['btnSearch', 'Ara'],
  ]).toString();
}

export async function uyusmazlikFormTokens(
  gateway: UpstreamGateway,
  priority: McpPriority,
): Promise<UyusmazlikFormTokens> {
  const res = await gateway.request({
    source: 'uyusmazlik',
    bucket: 'uyusmazlik',
    priority,
    kind: 'search',
    method: 'GET',
    url: `${UYUSMAZLIK_BASE}/`,
    headers: {},
    body: null,
  });
  const tokens = parseFormTokens(res.body);
  if (!tokens) throw gateway.reportParseError('uyusmazlik');
  return tokens;
}

export async function uyusmazlikSearch(
  gateway: UpstreamGateway,
  tokens: UyusmazlikFormTokens,
  text: string,
  scope: UyusmazlikScope,
  priority: McpPriority,
): Promise<UyusmazlikPage> {
  const res = await gateway.request({
    source: 'uyusmazlik',
    bucket: 'uyusmazlik',
    priority,
    kind: 'search',
    method: 'POST',
    url: `${UYUSMAZLIK_BASE}/`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildSearchForm(tokens, text, scope),
  });
  const page = parseSearchPage(res.body);
  if (!page) throw gateway.reportParseError('uyusmazlik');
  return page;
}

export type UyusmazlikDocument = { mimeType: 'text/html' | 'application/pdf'; bytes: Uint8Array };

const PDF_MAGIC = '%PDF-';

export async function uyusmazlikGetDocument(
  gateway: UpstreamGateway,
  documentId: string,
  priority: McpPriority,
): Promise<UyusmazlikDocument> {
  const res = await gateway.request({
    source: 'uyusmazlik',
    bucket: 'uyusmazlik',
    priority,
    kind: 'doc',
    method: 'GET',
    url: uyusmazlikPublicUrl(documentId),
    headers: {},
    body: null,
  });
  const bytes = responseBytes(res);
  if (Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString('latin1') === PDF_MAGIC) {
    return { mimeType: 'application/pdf', bytes };
  }
  if (/^text\/html\b/i.test(res.headers['content-type'] ?? '')) {
    // IIS'in eksik dosya için 200 + hata sayfası döndürmesine karşı: belge değil.
    if (/<title>[^<]*(404|bulunamad|not found)/i.test(res.body)) {
      throw new SourceError('SOURCE_DOCUMENT_NOT_FOUND', null, { source: 'uyusmazlik' });
    }
    return { mimeType: 'text/html', bytes };
  }
  throw gateway.reportParseError('uyusmazlik');
}
