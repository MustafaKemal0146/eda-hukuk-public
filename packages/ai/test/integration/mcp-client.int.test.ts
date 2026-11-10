// @tk TK-28
// KK-P11-20 / KK-021-9 / KK-021-10 / P11 K3: ince istemci gerçek yargi-mcp'ye (SOURCE_FIXTURE_MODE=replay,
// gerçek valkey-cache `eda_mcp`) karşı: JWT, _meta, tools/list sırası, tipli sarmalayıcılar ve hata
// eşlemesi (021 §6.4). TEST yığınında `pnpm --filter @eda/ai test:int` (infra/scripts/dev/test-db.sh).
import { MCP_TOOL_NAMES } from '@eda/contracts/mcp';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createServiceJwtSigner,
  createYargiMcpClient,
  getDecisionLive,
  getLegislationLive,
  searchDecisionsLive,
  searchLegislationLive,
  sourceStatus,
  type YargiMcpClient,
} from '../../src/mcp/index.ts';
import { ed25519Pair, startYargiMcp, type YargiMcpProcess } from '../mcp-helpers.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    valkeyCache: { url: string; mcpPasswordFile: string };
  }
}

const nulls = { chamber: null, date_from: null, date_to: null, esas_no: null, karar_no: null };
const opts = { priority: 'interactive' as const };

describe('KK-P11-20 / KK-021-9 / KK-021-10: yargi-mcp istemcisi (replay, valkey-cache)', () => {
  const keys = ed25519Pair();
  let server: YargiMcpProcess;
  let client: YargiMcpClient;

  beforeAll(async () => {
    const target = inject('valkeyCache');
    if (target.url === '' || target.mcpPasswordFile === '') {
      throw new Error(
        'entegrasyon testi için VALKEY_CACHE_URL ve VALKEY_CACHE_MCP_PASSWORD_FILE gerekli',
      );
    }
    server = await startYargiMcp(keys.publicKeyPem, target);
    const signer = await createServiceJwtSigner({
      privateKeyPem: keys.privateKeyPem,
      audience: 'yargi-mcp',
    });
    client = await createYargiMcpClient({ url: server.url, audience: 'yargi-mcp', signer });
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  it('tools/list adları ve sırası sözleşmeyle aynıdır', async () => {
    expect(await client.listToolNames()).toEqual([...MCP_TOOL_NAMES]);
  });

  it('searchDecisionsLive kayıtlı Bedesten yanıtını normalize döndürür', async () => {
    const r = await searchDecisionsLive(
      client,
      {
        source: 'bedesten',
        query: 'tahliye taahhüdü',
        court_types: ['yargitay'],
        ...nulls,
        page: 1,
        page_size: 10,
      },
      opts,
    );
    if (!r.ok) throw new Error(`beklenmeyen hata: ${r.error.code}`);
    expect(r.value.results).toHaveLength(10);
    expect(r.value.results[0]?.court).toBe('Yargıtay');
    expect(r.value.status).toBe('ok');
  });

  it('getDecisionLive bölümlü karar metni döndürür; ikinci çağrı tampondan', async () => {
    const args = { source: 'bedesten' as const, document_id: '979779300', section: null };
    const r = await getDecisionLive(client, args, opts);
    if (!r.ok) throw new Error(`beklenmeyen hata: ${r.error.code}`);
    expect(r.value.text_status).toBe('ok');
    expect(r.value.total_sections).toBeGreaterThan(2);
    expect(r.value.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    const again = await getDecisionLive(client, { ...args, section: 1 }, opts);
    expect(again.ok && again.value.cached).toBe(true);
  });

  it('mevzuat arama ve madde getirme çalışır', async () => {
    const s = await searchLegislationLive(
      client,
      { query: 'borçlar', law_no: null, page: 1, page_size: 5 },
      opts,
    );
    expect(s.ok && s.value.results.some((h) => h.law_no === '6098')).toBe(true);
    const g = await getLegislationLive(
      client,
      { law_no: '2893', law_type: null, article_no: '1', article_to: '2' },
      opts,
    );
    if (!g.ok) throw new Error(`beklenmeyen hata: ${g.error.code}`);
    expect(g.value.articles.map((a) => a.article_no)).toEqual(['1', '2']);
    expect(g.value.mevzuat_ref).toBe('1.5.2893');
  });

  it('021 §6.4 hata eşlemesi: bulunamadı, PII, geçersiz kimlik, kayıtsız istek', async () => {
    const nf = await getDecisionLive(
      client,
      { source: 'bedesten', document_id: '99999999999', section: null },
      opts,
    );
    expect(!nf.ok && nf.error.code).toBe('SOURCE_DOCUMENT_NOT_FOUND');

    const pii = await searchDecisionsLive(
      client,
      {
        source: 'bedesten',
        query: 'kira 10000000146 tahliye',
        court_types: null,
        ...nulls,
        page: 1,
        page_size: 10,
      },
      opts,
    );
    expect(!pii.ok && pii.error.code).toBe('SOURCE_PII_BLOCKED');

    const ssrf = await getDecisionLive(
      client,
      { source: 'bedesten', document_id: '../../etc/passwd', section: null },
      opts,
    );
    expect(!ssrf.ok && [ssrf.error.code, ssrf.error.reason]).toEqual([
      'VALIDATION_FAILED',
      'invalid_document_id',
    ]);

    const miss = await searchDecisionsLive(
      client,
      {
        source: 'bedesten',
        query: 'kayıtsız sorgu',
        court_types: null,
        ...nulls,
        page: 1,
        page_size: 10,
      },
      { priority: 'verify' },
    );
    expect(!miss.ok && miss.error.code).toBe('SOURCE_UNAVAILABLE');

    const st = await sourceStatus(client, opts);
    expect(st.ok && st.value.sources.find((x) => x.source === 'bedesten')?.enabled).toBe(true);
  });

  it('yanlış anahtarla imzalanmış istek reddedilir (401 → SOURCE_UNAVAILABLE)', async () => {
    const other = ed25519Pair();
    const signer = await createServiceJwtSigner({
      privateKeyPem: other.privateKeyPem,
      audience: 'yargi-mcp',
    });
    const bad = await createYargiMcpClient({ url: server.url, audience: 'yargi-mcp', signer });
    const r = await searchDecisionsLive(
      bad,
      {
        source: 'bedesten',
        query: 'tahliye taahhüdü',
        court_types: ['yargitay'],
        ...nulls,
        page: 1,
        page_size: 10,
      },
      opts,
    );
    expect(!r.ok && [r.error.code, r.error.origin]).toEqual(['SOURCE_UNAVAILABLE', 'transport']);
    await bad.close();
  });
});
