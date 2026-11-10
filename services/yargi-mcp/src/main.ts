// yargi-mcp girişi (:8001): GET /health, POST /mcp (021 §5.1). Portal çıkışı yalnız egress-portal vekili
// üzerinden (NODE_USE_ENV_PROXY=1 + HTTPS_PROXY); replay kipinde ağa çıkılmaz.
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@eda/observability/logger';
import pkg from '../package.json' with { type: 'json' };
import { createApp } from './app.ts';
import { load } from './config/load.ts';
import { defaultSourcesConfig, startSourcesConfigReader } from './config/sources.ts';
import { startHealthServer } from './health/server.ts';
import { createFetchTransport } from './http/fetch.ts';
import { createReplayTransport } from './http/fixtures.ts';
import { valkeyState } from './resilience/state.ts';
import { createValkeyCache } from './resilience/valkey.ts';

const env = load('yargi-mcp');
const logger = createLogger({
  service: 'eda-yargi-mcp',
  level: env.LOG_LEVEL === 'silent' ? 'fatal' : env.LOG_LEVEL,
});

/** 021 §5.13: açılışta yalnız vekilin TCP erişimi doğrulanır (portala istek atılmaz); başarısızsa fail-fast. */
function checkProxy(proxyUrl: string): Promise<boolean> {
  const u = new URL(proxyUrl);
  return new Promise((resolve) => {
    const sock = connect({ host: u.hostname, port: Number(u.port || 80), timeout: 5000 });
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => resolve(false));
  });
}

const replay = env.SOURCE_FIXTURE_MODE === 'replay';
if (!replay && !(await checkProxy(env.HTTPS_PROXY))) {
  logger.fatal({ event: 'process.fatal', reason: 'egress_proxy_unreachable' });
  process.exit(1);
}

const cfg = defaultSourcesConfig();
// Replay ağa çıkmaz: portal etiği kovası anlamsız; testleri yavaşlatmamak için aralık 1 ms. Kova,
// kesici ve önbellek yine valkey-cache'tedir (P11.8 c, P11.12 entegrasyon testi).
if (replay) {
  cfg.bedestenTokenIntervalMs = 1;
  cfg.anayasaTokenIntervalMs = 1;
  cfg.uyusmazlikTokenIntervalMs = 1;
}

// valkey-cache (eda_mcp): bağlantı yoksa komutlar hemen hata verir; canlı çağrı yapılmaz (fail-closed).
const valkey = createValkeyCache(env, cfg.timeoutConnectMs);
let cacheUp = false;
valkey.on('ready', () => {
  cacheUp = true;
  logger.info({ event: 'dependency.degraded', scope: 'valkey_cache', state: 'up' });
});
valkey.on('error', () => undefined);
valkey.on('close', () => {
  if (cacheUp) logger.warn({ event: 'dependency.degraded', scope: 'valkey_cache', state: 'down' });
  cacheUp = false;
});

const enabled = new Set(env.YARGI_SOURCES_ENABLED);
const app = await createApp({
  transport: replay
    ? createReplayTransport(fileURLToPath(new URL('../test/fixtures/', import.meta.url)))
    : createFetchTransport(),
  publicKeyPem: readFileSync(env.INTERNAL_JWT_PUBLIC_KEY_FILE, 'utf8'),
  audience: env.INTERNAL_JWT_AUDIENCE,
  enabledSources: enabled,
  userAgent: env.SOURCE_USER_AGENT,
  logger,
  state: valkeyState(valkey, cfg),
  cfg,
});
logger.info({ event: 'config.loaded', fixture_mode: env.SOURCE_FIXTURE_MODE });

// eda:cfg:sources (021 §6.1). Replay kipinde okunmaz: yukarıdaki 1 ms kova aralığı korunur.
const reader = replay
  ? null
  : startSourcesConfigReader({
      client: valkey,
      cfg,
      enabled,
      envEnabled: env.YARGI_SOURCES_ENABLED,
      logger,
    });
void reader?.refresh();

const health = async (): Promise<Record<string, string>> => {
  const cache = await valkey.ping().then(
    (r: string) => (r === 'PONG' ? 'ok' : 'down'),
    () => 'down',
  );
  return { version: pkg.version, cache };
};
startHealthServer(
  env.MCP_PORT,
  logger,
  'yargi-mcp',
  app.route,
  async () => {
    reader?.stop();
    await app.handler.close();
    valkey.disconnect();
  },
  health,
);
