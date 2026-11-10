// Portal fixture kaydı (021 §7.1, P11.8): yalnız geliştirici makinesinden, elle. Kaynak oran sınırına uyar
// (adımlar arası ≥ 3,5 sn + kaynak kovası), toplam ≤ 40 istek. Sorgular kamu hukuk terimleridir; kişisel
// veri içermez. Kullanım: pnpm --filter @eda/yargi-mcp fixtures:record [-- --source <kaynak>]
import { fileURLToPath } from 'node:url';
import { createLogger } from '@eda/observability/logger';
import { defaultSourcesConfig } from '../src/config/sources.ts';
import { createFetchTransport } from '../src/http/fetch.ts';
import { createRecordingTransport } from '../src/http/fixtures.ts';
import { UpstreamGateway } from '../src/sources/gateway.ts';
import { type CallCtx, createToolDeps } from '../src/tools/context.ts';
import { getDecision } from '../src/tools/get-decision.ts';
import { getLegislationLive, searchLegislationLive } from '../src/tools/legislation.ts';
import { searchDecisions } from '../src/tools/search-decisions.ts';
import { memoryState } from '../test/memory-state.ts';

const ROOT = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
const USER_AGENT = 'EDA-Hukuk-Kaynak-Istemcisi/1.0 (+https://eda.localhost/guvenlik)';
const logger = createLogger({ service: 'eda-yargi-mcp-fixtures' });

let current = { file: '', note: null as string | null };
// Aynı araç çağrısındaki ikinci istek (mevzuat belgesi, AYM kayıt çözümleme, Uyuşmazlık form sayfası)
// hedef URL'ye / gövdeye göre ayrı dosyaya yazılır.
const transport = createRecordingTransport(createFetchTransport(), (req) => {
  if (req.url.endsWith('/mevzuat/getDocumentContent')) {
    return { file: current.file.replace('lookup-', 'doc-'), note: 'Konsolide metin (HTML)' };
  }
  if (
    req.url.includes('anayasa.gov.tr') &&
    current.file.includes('/doc-') &&
    !req.body?.includes('"id"')
  ) {
    return {
      file: current.file.replace('/doc-', '/resolve-'),
      note: 'Kalıcı numaradan kayıt çözümleme',
    };
  }
  if (req.url === 'https://kararlar.uyusmazlik.gov.tr/' && req.method === 'GET') {
    return { file: `${ROOT}uyusmazlik/form.json`, note: 'Arama formu gizli alanları (ilk sayfa)' };
  }
  return current;
});
// Kayıtta her kaynak için istekler arası en az Bedesten aralığı (3,5 sn) beklenir.
const base = defaultSourcesConfig();
const cfg = {
  ...base,
  anayasaTokenIntervalMs: Math.max(base.anayasaTokenIntervalMs, base.bedestenTokenIntervalMs),
  uyusmazlikTokenIntervalMs: Math.max(base.uyusmazlikTokenIntervalMs, base.bedestenTokenIntervalMs),
  // Uyuşmazlık tam metin araması canlıda 23–27 sn sürüyor; kayıt için üst sınır geniş tutulur.
  timeoutSearchMs: Math.max(base.timeoutSearchMs, 60_000),
  retries: 0,
};
// Kayıt aracı tek süreçtir ve valkey-cache'e bağlanmaz: kova / kesici test ikizleriyle süreç içinde
// tutulur (üretim yolu değildir; adımlar arası `pause()` ayrıca ≥ 3,5 sn bekler).
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const state = memoryState(cfg, Date.now);
const reportDegraded = (): void => undefined;
const gateway = new UpstreamGateway({
  transport,
  cfg,
  userAgent: USER_AGENT,
  now: Date.now,
  sleep,
  random: Math.random,
  limiter: state.limiter,
  breakers: state.breakers,
  reportDegraded,
});
const enabled = ['bedesten', 'anayasa', 'uyusmazlik', 'mevzuat'] as const;
/** Soğuk yol (önbellek/tampon/künye/kimlik eşlemesi boş) için ayrı bağımlılık kümesi; kova ortak. */
const freshDeps = () =>
  createToolDeps({
    gateway,
    cfg,
    enabled: new Set(enabled),
    now: Date.now,
    sleep,
    resultCache: memoryState(cfg, Date.now).resultCache,
    locks: state.locks,
    reportDegraded,
  });
const deps = freshDeps();
const ctx: CallCtx = { org: 'sys', priority: 'interactive', cacheScope: 'shared' };
const pause = (): Promise<void> => new Promise((r) => setTimeout(r, cfg.bedestenTokenIntervalMs));

type Step = { file: string; note: string; run: () => Promise<unknown> };
const onlySource = (() => {
  const i = process.argv.indexOf('--source');
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
})();
const nulls = { chamber: null, date_from: null, date_to: null, esas_no: null, karar_no: null };

const steps: Step[] = [
  {
    file: 'bedesten/search-tahliye-yargitay.json',
    note: 'Yargıtay, alaka sırası (sortFields yok), düz ifade',
    run: () =>
      searchDecisions(
        deps,
        {
          source: 'bedesten',
          query: 'tahliye taahhüdü',
          court_types: ['yargitay'],
          ...nulls,
          page: 1,
          page_size: 10,
        },
        ctx,
      ),
  },
  {
    file: 'bedesten/search-h3-2023.json',
    note: 'Tırnaklı ifade + daire (H3) + tarih aralığı 2023',
    run: () =>
      searchDecisions(
        deps,
        {
          source: 'bedesten',
          query: '"tahliye taahhüdü"',
          court_types: null,
          ...nulls,
          chamber: 'H3',
          date_from: '2023-01-01',
          date_to: '2023-12-31',
          page: 1,
          page_size: 5,
        },
        ctx,
      ),
  },
  {
    file: 'bedesten/search-danistay.json',
    note: 'Danıştay itemType DANISTAYKARAR',
    run: () =>
      searchDecisions(
        deps,
        {
          source: 'bedesten',
          query: '"imar planı"',
          court_types: ['danistay'],
          ...nulls,
          page: 1,
          page_size: 3,
        },
        ctx,
      ),
  },
  {
    file: 'bedesten/search-empty.json',
    note: 'Sonuçsuz arama',
    run: () =>
      searchDecisions(
        deps,
        {
          source: 'bedesten',
          query: 'qxzvbnwmrtpl',
          court_types: ['yargitay'],
          ...nulls,
          page: 1,
          page_size: 10,
        },
        ctx,
      ),
  },
  {
    file: 'bedesten/doc-979779300.json',
    note: 'Yargıtay 3. HD 2022/8302 E. 2023/167 K. (HTML, portalda anonimleştirilmiş)',
    run: () =>
      getDecision(deps, { source: 'bedesten', document_id: '979779300', section: null }, ctx),
  },
  {
    file: 'bedesten/doc-not-found.json',
    note: 'ADALET_RECORD_NOT_FOUND_EXCEPTION',
    run: () =>
      getDecision(
        deps,
        { source: 'bedesten', document_id: '99999999999', section: null },
        ctx,
      ).catch((e: unknown) => e),
  },
  {
    file: 'mevzuat/search-borclar.json',
    note: 'Mevzuat ad araması (mevzuatAdi)',
    run: () =>
      searchLegislationLive(deps, { query: 'borçlar', law_no: null, page: 1, page_size: 5 }, ctx),
  },
  {
    file: 'mevzuat/lookup-2893.json',
    note: '2893 Türk Bayrağı Kanunu numara araması; ardından konsolide metin',
    run: () =>
      getLegislationLive(
        deps,
        { law_no: '2893', law_type: null, article_no: '1', article_to: '2' },
        ctx,
      ),
  },
  {
    file: 'anayasa/search-norm.json',
    note: 'AYM norm denetimi, serbest metin, kararTipi NormDenetimi',
    run: () =>
      searchDecisions(
        deps,
        {
          source: 'anayasa',
          query: 'mülkiyet hakkı',
          court_types: ['aym_norm'],
          ...nulls,
          page: 1,
          page_size: 3,
        },
        ctx,
      ),
  },
  {
    file: 'anayasa/search-bireysel-2024.json',
    note: 'AYM bireysel başvuru, tarih aralığı 2024 (portal süzgeci)',
    run: () =>
      searchDecisions(
        deps,
        {
          source: 'anayasa',
          query: 'mülkiyet hakkı',
          court_types: ['aym_bireysel'],
          ...nulls,
          date_from: '2024-01-01',
          date_to: '2024-12-31',
          page: 1,
          page_size: 3,
        },
        ctx,
      ),
  },
  {
    file: 'anayasa/search-empty.json',
    note: 'Sonuçsuz arama, karar türü süzgeci yok',
    run: () =>
      searchDecisions(
        deps,
        {
          source: 'anayasa',
          query: 'qxzvbnwmrtpl',
          court_types: null,
          ...nulls,
          page: 1,
          page_size: 3,
        },
        ctx,
      ),
  },
  {
    file: 'anayasa/doc-nd-2025-42.json',
    note: 'AYM E.2024/176 K.2025/42 tam metin (icerik HTML)',
    run: () =>
      getDecision(
        freshDeps(),
        { source: 'anayasa', document_id: 'ND/2025/42', section: null },
        ctx,
      ),
  },
  {
    file: 'anayasa/doc-bb-2019-27727.json',
    note: 'AYM bireysel B. No 2019/27727 kabul edilemezlik (başvurucu adı fixture içinde kısaltıldı)',
    run: () =>
      getDecision(
        freshDeps(),
        { source: 'anayasa', document_id: 'BB/2019/27727', section: null },
        ctx,
      ),
  },
  {
    file: 'anayasa/doc-nd-1960-9999.json',
    note: 'Var olmayan karar numarası: çözümleme boş döner',
    run: () =>
      getDecision(
        freshDeps(),
        { source: 'anayasa', document_id: 'ND/1960/9999', section: null },
        ctx,
      ).catch((e: unknown) => e),
  },
  {
    file: 'uyusmazlik/search-el-atma.json',
    note: 'Tüm içerikte arama (rblSearchScope=All)',
    run: () =>
      searchDecisions(
        deps,
        {
          source: 'uyusmazlik',
          query: 'kamulaştırmasız el atma',
          court_types: null,
          ...nulls,
          page: 1,
          page_size: 5,
        },
        ctx,
      ),
  },
  {
    file: 'uyusmazlik/search-esas-2026-206.json',
    note: 'Esas numarasına göre arama (rblSearchScope=EsasNo)',
    run: () =>
      searchDecisions(
        deps,
        {
          source: 'uyusmazlik',
          query: 'esas',
          court_types: ['uyusmazlik'],
          ...nulls,
          esas_no: '2026/206',
          page: 1,
          page_size: 5,
        },
        ctx,
      ),
  },
  {
    file: 'uyusmazlik/search-empty.json',
    note: 'Sonuçsuz arama',
    run: () =>
      searchDecisions(
        deps,
        {
          source: 'uyusmazlik',
          query: 'qxzvbnwmrtpl',
          court_types: null,
          ...nulls,
          page: 1,
          page_size: 5,
        },
        ctx,
      ),
  },
  {
    file: 'uyusmazlik/doc-2026-206.json',
    note: 'E.2026/206 K.2026/331 karar PDF (metin katmanlı; taraf adları portalda baş harfli)',
    run: () =>
      getDecision(
        freshDeps(),
        { source: 'uyusmazlik', document_id: 'Uploads/2026-206.pdf', section: null },
        ctx,
      ),
  },
];

for (const step of steps) {
  if (onlySource !== null && !step.file.startsWith(`${onlySource}/`)) continue;
  current = { file: `${ROOT}${step.file}`, note: step.note };
  await step.run();
  process.stdout.write(`kaydedildi: ${step.file}\n`);
  await pause();
}
logger.info({ event: 'shutdown.completed' });
