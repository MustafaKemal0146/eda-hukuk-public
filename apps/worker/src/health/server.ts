// :9464 sağlık ve metrik sunucusu (043 §2.2, §13, §14.1; 014 §6.1). `GET /health`: süreç + verilen
// bağımlılık yoklamaları (jobs: PG, Valkey) ve `draining`. Yoklama `health.readyTimeoutMs` ile sınırlı,
// sonuç `health.readyCacheMs` boyunca önbellekte. Bağımlılık düşükse veya süreç boşalıyorsa 503
//. `GET /metrics`: Prometheus metin biçimi. Gövdede yalnız durum kodları; hata ayrıntısı yok.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { EdaLogger } from '@eda/observability/logger';

export type DependencyCheck = () => Promise<unknown>;
export type CheckState = 'ok' | 'fail';

export interface HealthOptions {
  /** Ad -> yoklama (ör. `pg`, `valkey`). Verilmezse yalnız süreç canlılığı raporlanır. */
  readonly checks?: Readonly<Record<string, DependencyCheck>>;
  readonly isDraining?: () => boolean;
  readonly renderMetrics?: () => string;
  readonly timeoutMs?: number;
  readonly cacheMs?: number;
  readonly now?: () => number;
}

export interface HealthResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

const JSON_TYPE = 'application/json';
const METRICS_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

async function withTimeout(check: DependencyCheck, ms: number): Promise<CheckState> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CheckState>((resolve) => {
    timer = setTimeout(() => resolve('fail'), ms);
  });
  try {
    return await Promise.race([check().then((): CheckState => 'ok'), timeout]);
  } catch {
    return 'fail';
  } finally {
    clearTimeout(timer);
  }
}

/** Ağdan bağımsız istek işleyicisi (test edilebilir çekirdek). */
export function createHealthHandler(
  opts: HealthOptions = {},
): (method: string | undefined, url: string | undefined) => Promise<HealthResponse> {
  const timeoutMs = opts.timeoutMs ?? CONFIG_DEFAULTS['health.readyTimeoutMs'];
  const cacheMs = opts.cacheMs ?? CONFIG_DEFAULTS['health.readyCacheMs'];
  const now = opts.now ?? Date.now;
  const checks = Object.entries(opts.checks ?? {});
  let cached: { at: number; result: Record<string, CheckState> } | undefined;

  const runChecks = async (): Promise<Record<string, CheckState>> => {
    const t = now();
    if (cached !== undefined && t - cached.at < cacheMs) return cached.result;
    const states = await Promise.all(checks.map(([, check]) => withTimeout(check, timeoutMs)));
    const result = Object.fromEntries(checks.map(([name], i) => [name, states[i] ?? 'fail']));
    cached = { at: t, result };
    return result;
  };

  return async (method, url) => {
    const path = (url ?? '').split('?')[0];
    if (method === 'GET' && path === '/health') {
      const draining = opts.isDraining?.() ?? false;
      const deps = await runChecks();
      const healthy = Object.values(deps).every((s) => s === 'ok');
      const body = { status: healthy && !draining ? 'ok' : 'degraded', draining, checks: deps };
      return {
        status: healthy && !draining ? 200 : 503,
        contentType: JSON_TYPE,
        body: JSON.stringify(body),
      };
    }
    if (method === 'GET' && path === '/metrics' && opts.renderMetrics !== undefined) {
      return { status: 200, contentType: METRICS_TYPE, body: opts.renderMetrics() };
    }
    return { status: 404, contentType: JSON_TYPE, body: '' };
  };
}

export function startHealthServer(
  port: number,
  logger: EdaLogger,
  service: string,
  opts: HealthOptions = {},
): Server {
  const handle = createHealthHandler(opts);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handle(req.method, req.url).then(
      (r) => {
        res.writeHead(r.status, { 'content-type': r.contentType }).end(r.body);
      },
      () => {
        res.writeHead(500).end();
      },
    );
  });
  server.listen(port, '0.0.0.0');
  logger.info({ event: 'server.started', service, port });
  return server;
}

/** Sunucuyu kapatır (boştaki bağlantılar hemen bırakılır). */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}
