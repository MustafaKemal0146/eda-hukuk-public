// api süreç girişi (040 §12.1): config → günlükleyici → çıkış vekili denetimi → Valkey (komut + kuyruk
// üreticisi) → appAuth + kimlik zinciri (P04a) → iki sunucu → sinyaller. PG havuzları ilk kullanımda
// kurulur (@eda/db); rol güvenceleri P03 dışı iştir (AS).
import type { Server } from 'node:http';
import { EnvValidationError } from '@eda/contracts/config/env';
import { parseKekFile } from '@eda/crypto';
import { closeDefaultPool, withNoTenant, withTenant, withUserScope } from '@eda/db';
import { createLogger, type LogLevel } from '@eda/observability/logger';
import { createAdaptorServer } from '@hono/node-server';
import { createAiConfigService, fileSecretProbe } from './admin/ai-config-service.ts';
import { createAdminAiKeysService } from './admin/ai-keys-service.ts';
import { createAdminAnnouncementsService } from './admin/announcements-service.ts';
import { createAdminAuditService } from './admin/audit-service.ts';
import { valkeyBackupStatus } from './admin/backup-status.ts';
import { adminDbFromEnv } from './admin/db.ts';
import { createPlatformSettingsLoader } from './admin/platform-settings-source.ts';
import { createQueueStats } from './admin/queue-stats.ts';
import { createAdminService } from './admin/service.ts';
import { createStaffModules } from './admin/staff-modules.ts';
import { createSystemService } from './admin/system-service.ts';
import { createAdminUsersService } from './admin/users-service.ts';
import { createAdminSurface } from './admin-app.ts';
import { createAppSurface } from './app.ts';
import { createAdminIdentity } from './auth/admin-identity.ts';
import { defaultAuthDb, valkeyReplayGuard, valkeySecondaryStorage } from './auth/index.ts';
import { closeAuthDbPool } from './auth/pool.ts';
import { platformFallbackEnabled, readPlatformAnthropicKey } from './chat/platform-key.ts';
import { createChatDeps } from './chat/setup.ts';
import { createFilesObjectStore } from './clients/object-store.ts';
import { createValkeyClient } from './clients/valkey.ts';
import { lazyMcp } from './clients/yargi-mcp.ts';
import { type ApiConfig, loadConfig } from './config/load.ts';
import { SecretFileError } from './config/secrets.ts';
import type { RuntimeState } from './context/types.ts';
import { createReadiness } from './health/ready.ts';
import { tcpReachable } from './health/tcp-check.ts';
import { setupIdentity } from './identity.ts';
import { uuidv7 } from './middleware/request-id.ts';
import { anthropicVerifier } from './services/ai-keys/crypto.ts';
import { createPlatformKeyGate } from './services/ai-keys/platform-gate.ts';
import { createPlatformSettings } from './services/ai-keys/platform-settings.ts';
import { KunyeChecker } from './services/kunye-check/kunye-check.ts';
import { createResearchDeps } from './services/research.ts';
import { createMcpLiveSource } from './services/sources/live-source.ts';
import { createShutdown } from './shutdown.ts';

function fail(message: string): never {
  process.stderr.write(`eda-api: ${message}\n`);
  process.exit(1);
}

let config: ApiConfig;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof EnvValidationError) {
    fail(`env geçersiz: ${err.issues.map((i) => `${i.name} (${i.reason})`).join(', ')}`);
  }
  if (err instanceof SecretFileError) fail(err.message);
  fail('yapılandırma yüklenemedi');
}

const level = config.env.LOG_LEVEL === 'silent' ? 'fatal' : (config.env.LOG_LEVEL as LogLevel);
const logger = createLogger({ service: 'eda-api', level });
const state: RuntimeState = { draining: false };
const { endpoints, health } = config;

// 002 §3: çıkış vekiline erişilemiyorsa başlama (fail-fast).
if (
  !(await tcpReachable(endpoints.egressLlm.host, endpoints.egressLlm.port, health.readyTimeoutMs))
) {
  fail('çıkış vekiline erişilemiyor (HTTPS_PROXY)');
}

const probe = (name: string, hard: boolean, e: { host: string; port: number }) => ({
  name,
  hard,
  run: () => tcpReachable(e.host, e.port, health.readyTimeoutMs),
});
const probes = [
  probe('postgres', true, endpoints.postgres),
  probe('valkey', true, endpoints.valkey),
  probe('valkeyCache', false, endpoints.valkeyCache),
  probe('objstore', false, endpoints.objstore),
  probe('embedQuery', false, endpoints.embedQuery),
  probe('yargiMcp', false, endpoints.yargiMcp),
];
const ready = createReadiness({
  probes,
  cacheMs: health.readyCacheMs,
  version: config.version,
  state,
});

const common = {
  logger,
  state,
  maintenanceMode: () => config.maintenanceMode,
  jsonBodyMaxBytes: config.http.jsonBodyMaxBytes,
};
// Sohbet araçları ve araştırma uçları tek yargi-mcp bağlantısını paylaşır.
const mcp = lazyMcp(config, logger);
const chat = createChatDeps(config, logger, mcp);
const research = createResearchDeps(config, createMcpLiveSource(mcp), () => uuidv7());
const devSlice = config.env.EDA_ENV === 'development' || config.env.EDA_ENV === 'test';
const kunyeChecks = devSlice
  ? { checker: new KunyeChecker(mcp), uuid: () => uuidv7(), now: () => new Date() }
  : undefined;
// Kimlik: Valkey komut bağlantısı (hız sınırı, Better Auth ikincil depolama) ve BullMQ üretici
// bağlantısı ayrıdır; Valkey yoksa kimlik uçları fail-closed 503 verir, süreç başlar.
const valkeyTarget = {
  url: config.env.VALKEY_URL,
  username: config.env.VALKEY_USERNAME,
  passwordFile: config.env.VALKEY_PASSWORD_FILE,
};
const redis = createValkeyClient(valkeyTarget, 'eda-api');
const queueRedis = createValkeyClient(valkeyTarget, 'eda-api-queue');
// valkey-cache: Sistem modülü yalnız `INFO` sayaçlarını okur (ACL `eda_api`: +info; anahtar okunmaz).
const cacheRedis = createValkeyClient(
  {
    url: config.env.VALKEY_CACHE_URL,
    username: config.env.VALKEY_CACHE_USERNAME,
    passwordFile: config.env.VALKEY_CACHE_PASSWORD_FILE,
  },
  'eda-api-cache-info',
);
for (const r of [redis, queueRedis, cacheRedis]) {
  r.on('error', () => undefined);
  await r.connect().catch(() => {
    logger.warn({ event: 'dependency.degraded', dependency: 'valkey' });
  });
}
// Platform ortak anahtarı: sert kapı env (PLATFORM_AI_KEY_FALLBACK + izinli ortam); yumuşak
// anahtar ve anahtarın kendisi yönetim panelinden gelir (DB, şifreli; 30 sn önbellek), geriye uyumlu olarak
// sunucu sır dosyası yedektir. Env kapalıyken DB'ye hiç gidilmez.
const platformEnvGate = platformFallbackEnabled(config);
if (platformEnvGate)
  logger.info({ event: 'ai.platform_key_fallback_env_open', edaEnv: config.env.EDA_ENV });
const platformKek = parseKekFile(config.secrets.get('KEK_MASTER_FILE'));
const platformSettings = createPlatformSettings({
  envGate: platformEnvGate,
  load: createPlatformSettingsLoader(adminDbFromEnv()),
  kek: platformKek.kek,
  readFileKey: () => readPlatformAnthropicKey(config),
  now: () => Date.now(),
  onEvent: (event) => logger.error({ event }),
});
const identitySetup = setupIdentity({
  edaEnv: config.env.EDA_ENV,
  appUrl: config.env.APP_URL,
  baseURL: config.env.BETTER_AUTH_URL,
  secret: config.secrets.get('BETTER_AUTH_SECRET_FILE'),
  passkeyRpId: config.env.PASSKEY_RP_ID,
  kekFileContent: config.secrets.get('KEK_MASTER_FILE'),
  hmacKey: Buffer.from(config.secrets.get('HMAC_PSEUDONYM_KEY_FILE'), 'base64'),
  redis,
  queueRedis,
  logger,
  rerankEnabled: config.env.RERANK_ENABLED,
  maintenance: () => config.maintenanceMode,
  objectStore: createFilesObjectStore(config),
  platformSettings: platformEnvGate ? platformSettings : null,
});

// Kimlik zinciri kuruluysa sohbetler veritabanında ve kullanıcıya ait tutulur (RLS).
if (chat && identitySetup.surface?.chatPersistence) {
  chat.persistence = identitySetup.surface.chatPersistence;
}
// Sohbet ekleri yalnız kalıcı (RLS'li) sohbetle: bellek içi dilimde ekli tur reddedilir.
if (chat && identitySetup.surface?.chatAttachments) {
  chat.attachments = identitySetup.surface.chatAttachments;
}
// Kimlik zinciri kuruluysa sohbet, büro/kullanıcı API anahtarıyla çalışır (#54): anahtar yoksa tur
// başlamaz, sunucunun ortak anahtarına sessiz düşme yoktur.
if (chat && identitySetup.surface?.aiKeys) {
  const aiKeys = identitySetup.surface.aiKeys;
  chat.resolveApiKey = async (actor) => {
    const r = await aiKeys.resolve(actor);
    return 'missing' in r ? r : { apiKey: r.apiKey, source: r.source };
  };
  // Ortak anahtar yalnız limit kapısıyla birlikte: kapı olmadan kaynak `platform` olan tur başlamaz.
  if (platformEnvGate) {
    chat.platformKey = createPlatformKeyGate({
      db: identitySetup.surface.tenantDb,
      now: () => new Date(),
      settings: platformSettings,
      onRecordFailed: () => logger.error({ event: 'chat.platform_usage_record_failed' }),
    });
  }
}

const appSurface = createAppSurface({
  ...common,
  surface: 'app',
  ready,
  identity: identitySetup.surface,
  ...(chat ? { chat } : {}),
  ...(research ? { research } : {}),
  ...(kunyeChecks ? { kunyeChecks } : {}),
}).app;
// Yönetim kimliği (yalnız passkey; ayrı Better Auth örneği). Kimlik zinciri (Valkey) yoksa yalnız /health.
const adminIdentity = createAdminIdentity({
  baseURL: config.env.BETTER_AUTH_ADMIN_URL,
  adminUrl: config.env.ADMIN_URL,
  secret: config.secrets.get('BETTER_AUTH_ADMIN_SECRET_FILE'),
  passkeyRpId: config.env.PASSKEY_RP_ID,
  db: defaultAuthDb(),
  storage: valkeySecondaryStorage(redis),
  rate: identitySetup.rate,
  replay: valkeyReplayGuard(redis),
  appDb: { withTenant, withUserScope, withNoTenant },
  logger,
});
const queueStats = createQueueStats(queueRedis);
const adminDb = adminDbFromEnv();
const adminSurface = createAdminSurface(
  { ...common, surface: 'admin' },
  {
    identity: adminIdentity,
    adminUrl: config.env.ADMIN_URL,
    rate: identitySetup.rate,
    environment: config.env.EDA_ENV,
    maintenanceMode: () => config.maintenanceMode,
    usersService: createAdminUsersService({
      db: adminDbFromEnv(),
      revokeAllSessions: (userId) => adminIdentity.revokeUserSessions(userId),
    }),
    service: createAdminService({
      db: adminDb,
      enqueueEmailSend: (deliveryId, template) =>
        identitySetup.producer.addEmailSend({ deliveryId, class: 'service', template }),
    }),
    announcements: createAdminAnnouncementsService({ db: adminDbFromEnv() }),
    aiKeys: createAdminAiKeysService({
      db: adminDbFromEnv(),
      kek: (() => {
        const k = parseKekFile(config.secrets.get('KEK_MASTER_FILE'));
        return { kek: k.kek, kekVersion: k.kekVersion };
      })(),
      verify: anthropicVerifier(),
      // Yönetici başına dakikada 5 doğrulama: doğrulama ucu kâhin olarak kullanılamaz.
      limitVerify: (actorId) =>
        identitySetup.rate.enforce('step-up', `admin-ai-key:${actorId}`, 5, 60_000),
      platform: {
        envGateOpen: platformEnvGate,
        fileKeyConfigured: () => readPlatformAnthropicKey(config) !== null,
        onChanged: () => platformSettings.invalidate(),
      },
      now: () => new Date(),
    }),
    aiConfig: createAiConfigService({
      db: adminDbFromEnv(),
      secretConfigured: fileSecretProbe(String(config.env.SECRETS_DIR ?? '/run/secrets')),
    }),
    system: createSystemService({
      db: adminDb,
      probes,
      probeCacheMs: health.readyCacheMs,
      maintenanceMode: () => config.maintenanceMode,
      cacheInfo: () => cacheRedis.info(),
      queueCounts: (q) => queueStats.counts(q),
      backupStatus: valkeyBackupStatus(redis),
    }),
    staffModules: createStaffModules({ db: adminDbFromEnv() }),
    audit: createAdminAuditService({ db: adminDbFromEnv() }),
  },
);

const serverOptions = {
  keepAliveTimeout: config.http.keepAliveTimeoutMs,
  headersTimeout: config.http.headersTimeoutMs,
  requestTimeout: config.http.requestTimeoutMs,
};
const appServer = createAdaptorServer({ fetch: appSurface.fetch, serverOptions }) as Server;
const adminServer = createAdaptorServer({ fetch: adminSurface.fetch, serverOptions }) as Server;
for (const s of [appServer, adminServer]) s.timeout = 0;

appServer.listen(config.env.API_PORT, '0.0.0.0');
adminServer.listen(config.env.API_ADMIN_PORT, config.env.API_ADMIN_LISTEN_HOST);
logger.info({
  event: 'server.started',
  version: config.version,
  edaEnv: config.env.EDA_ENV,
  listeners: {
    app: config.env.API_PORT,
    admin: `${config.env.API_ADMIN_LISTEN_HOST}:${config.env.API_ADMIN_PORT}`,
  },
});

const shutdown = createShutdown({
  servers: [appServer, adminServer],
  logger,
  state,
  drainGraceMs: config.shutdown.drainGraceMs,
  finalizeBudgetMs: config.shutdown.finalizeBudgetMs,
  exit: (code) => process.exit(code),
  release: async () => {
    await identitySetup.producer.close().catch(() => undefined);
    await identitySetup.fileProducer.close().catch(() => undefined);
    await queueStats.close();
    await Promise.all([redis.quit(), queueRedis.quit(), cacheRedis.quit()]).catch(() => undefined);
    await closeAuthDbPool().catch(() => undefined);
    await closeDefaultPool().catch(() => undefined);
  },
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (err: unknown) => {
    logger.fatal({
      event: 'process.fatal',
      kind: event,
      errorType: err instanceof Error ? err.name : typeof err,
    });
    shutdown(event);
    process.exitCode = 1;
  });
}
