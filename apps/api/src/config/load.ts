// Yapılandırma yükleme (040 §13): kod varsayılanı (defaults.ts) → env (002 §5, Zod) → sır dosyaları.
// process.env yalnız bu dosyada okunur. Hata çıktısı yalnız değişken/dosya adlarını içerir.
// system_settings katmanı P03'te eklenir.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { type ApiEnv, parseEnv, SECRET_FILE_VARS } from '@eda/contracts/config/env';
import { Secrets } from './secrets.ts';

export type Endpoint = { host: string; port: number };

export type ApiConfig = {
  env: ApiEnv;
  secrets: Secrets;
  version: string;
  http: {
    keepAliveTimeoutMs: number;
    headersTimeoutMs: number;
    requestTimeoutMs: number;
    jsonBodyMaxBytes: number;
  };
  health: { readyTimeoutMs: number; readyCacheMs: number };
  shutdown: { drainGraceMs: number; finalizeBudgetMs: number };
  maintenanceMode: boolean;
  /** /ready ve açılış denetimlerinin hedefleri (P03'te TCP yerine SELECT 1 / PING). */
  endpoints: {
    postgres: Endpoint;
    valkey: Endpoint;
    valkeyCache: Endpoint;
    objstore: Endpoint;
    yargiMcp: Endpoint;
    embedQuery: Endpoint;
    egressLlm: Endpoint;
  };
};

export function endpointOf(url: string): Endpoint {
  const u = new URL(url);
  const fallback = u.protocol === 'https:' ? 443 : u.protocol.startsWith('redis') ? 6379 : 80;
  return { host: u.hostname, port: u.port === '' ? fallback : Number(u.port) };
}

export function loadConfig(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ApiConfig {
  const env = parseEnv('api', source);
  const secrets = Secrets.fromFiles(env, SECRET_FILE_VARS.api);
  const d = CONFIG_DEFAULTS;
  return {
    env,
    secrets,
    version: 'dev',
    http: {
      keepAliveTimeoutMs: d['http.keepAliveTimeoutMs'],
      headersTimeoutMs: d['http.headersTimeoutMs'],
      requestTimeoutMs: d['http.requestTimeoutMs'],
      jsonBodyMaxBytes: d['http.jsonBodyMaxBytes'],
    },
    health: { readyTimeoutMs: d['health.readyTimeoutMs'], readyCacheMs: d['health.readyCacheMs'] },
    shutdown: {
      drainGraceMs: d['chat.drainGraceSec'] * 1000,
      finalizeBudgetMs: d['shutdown.finalizeBudgetSec'] * 1000,
    },
    maintenanceMode: d['system.maintenanceMode'],
    endpoints: {
      postgres: { host: env.PG_HOST, port: env.PG_PORT },
      valkey: endpointOf(env.VALKEY_URL),
      valkeyCache: endpointOf(env.VALKEY_CACHE_URL),
      objstore: endpointOf(env.S3_ENDPOINT),
      yargiMcp: endpointOf(env.YARGI_MCP_URL),
      embedQuery: endpointOf(env.EMBED_QUERY_URL),
      egressLlm: endpointOf(env.HTTPS_PROXY),
    },
  };
}

/** Yönetim komutları (`cli.ts`): yalnız env doğrulaması; sır dosyaları komutun ihtiyacına göre okunur. */
export function loadCliEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ApiEnv {
  return parseEnv('api', source);
}
