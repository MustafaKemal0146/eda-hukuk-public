// Servis env şemaları (002 §5.1-§5.6, §5.10, §5.13; 040 §13.2). Saf modül: `process.env` okumaz,
// dosya açmaz; uygulama kendi `config/` katmanında kaynağı verir ve sır dosyalarını okur.
// Hata çıktısı yalnız değişken ADLARINI ve kısa nedeni içerir; değer asla yazılmaz (KK-040-16).
import { z } from 'zod';
import { SOURCE_CODES } from '../enums.ts';

export const ENV_SERVICES = [
  'api',
  'worker',
  'jobs',
  'web',
  'admin',
  'yargi-mcp',
  'migrate',
] as const;
export type EnvService = (typeof ENV_SERVICES)[number];

/** `EDA_ENV` değerleri (002 §5.1). */
export const EDA_ENVS = [
  'development',
  'test',
  'staging',
  'beta-synthetic',
  'production',
  'onprem',
] as const;
export type EdaEnv = (typeof EDA_ENVS)[number];

/** Mock/geliştirme kapılarının açılabildiği ortamlar. */
export const DEV_LIKE_ENVS = ['development', 'test'] as const satisfies readonly EdaEnv[];

/** 040 §13.2: bu öneklerle başlayıp şemada olmayan değişken başlatma hatasıdır. */
export const KNOWN_ENV_PREFIXES = [
  'EDA_',
  'PG_',
  'VALKEY_',
  'S3_',
  'API_',
  'BETTER_AUTH_',
  'EMBED_',
  'RERANK_',
  'IYZICO_',
  'MOCK_',
  'DEV_',
  'PASSKEY_',
] as const;

/** 002 §5.11 kanonik `NO_PROXY` değeri. */
export const CANONICAL_NO_PROXY =
  'localhost,127.0.0.1,api,api-admin,web,admin,worker,jobs,yargi-mcp,doc-engine,gotenberg,' +
  'postgres,valkey,valkey-cache,embed-query,embed-batch,rerank,objstore,mailpit,clamav,backup';

/** BullMQ kuyrukları (002 §17); `maintenance` yalnız `jobs` konteynırında tüketilir. */
export const QUEUE_NAMES = [
  'files-interactive',
  'files-batch',
  'exports',
  'corpus',
  'citations',
  'notifications',
  'chat',
  'billing',
  'maintenance',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];
export const JOBS_ONLY_QUEUE = 'maintenance' satisfies QueueName;

/** 002 §5.13: iyzico taban adresi prod'da canlı, diğer ortamlarda sandbox. */
export const IYZICO_PRODUCTION_BASE_URL = 'https://api.iyzipay.com';
export const IYZICO_SANDBOX_BASE_URL = 'https://sandbox-api.iyzipay.com';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

// ---------- alan yapı taşları ----------

const text = z.string().min(1);
const hostname = z.string().regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
const httpUrl = z.url({ protocol: /^https?$/ });
const httpsUrl = z.url({ protocol: /^https$/ });
const redisUrl = z.url({ protocol: /^rediss?$/ });
const smtpUrl = z.url({ protocol: /^smtps?$/ });
const port = z
  .string()
  .regex(/^\d{1,5}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535));
const positiveInt = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
  .pipe(z.number().int().min(1));
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
/** `*_FILE`: mutlak yol (002 §6 `/run/secrets/<ad>`); `..` bileşeni yok. */
const filePath = z
  .string()
  .regex(/^\/[^\0]*$/)
  .refine((p) => !p.split('/').includes('..'));
const commaList = text.transform((s) => s.split(',').map((part) => part.trim()));
const queueList = commaList.pipe(z.array(z.enum(QUEUE_NAMES)).min(1));
const sourceList = commaList.pipe(z.array(z.enum(SOURCE_CODES)).min(1));

// ---------- ortak parçalar ----------

const COMMON = {
  EDA_ENV: z.enum(EDA_ENVS),
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  TZ: z.literal('UTC').default('UTC'),
  OTEL_EXPORTER_OTLP_ENDPOINT: httpUrl.optional(),
  OTEL_SERVICE_NAME: text.optional(),
  GLITCHTIP_DSN: httpUrl.optional(),
  SECRETS_DIR: filePath.optional(),
};

const URLS = {
  APP_DOMAIN: hostname,
  APP_URL: httpsUrl,
  ADMIN_URL: httpsUrl,
  MARKETING_URL: httpsUrl,
};

const URLS_OPTIONAL = {
  APP_DOMAIN: hostname.optional(),
  APP_URL: httpsUrl.optional(),
  ADMIN_URL: httpsUrl.optional(),
  MARKETING_URL: httpsUrl.optional(),
};

const PG_BASE = { PG_HOST: text, PG_PORT: port, PG_DATABASE: text };

const PROXY = {
  HTTPS_PROXY: httpUrl,
  HTTP_PROXY: httpUrl,
  NO_PROXY: text,
  NODE_USE_ENV_PROXY: z.literal('1'),
};

const S3 = {
  S3_ENDPOINT: httpUrl,
  S3_REGION: text,
  S3_BUCKET_FILES: text,
  S3_BUCKET_EXPORTS: text,
  S3_ACCESS_KEY_ID_FILE: filePath,
  S3_SECRET_ACCESS_KEY_FILE: filePath,
};

const KEYS = {
  KEK_MASTER_FILE: filePath,
  KEK_MASTER_PREV_FILE: filePath.optional(),
  HMAC_PSEUDONYM_KEY_FILE: filePath,
  INTERNAL_JWT_PRIVATE_KEY_FILE: filePath,
  YARGI_MCP_URL: httpUrl,
};

const EMBED = {
  EMBED_PROVIDER: z.enum(['tei', 'mock']),
  TEI_API_KEY_FILE: filePath,
  EMBED_MODEL_ID: text,
  EMBED_MODEL_REVISION: text,
  EMBED_DIM: positiveInt,
  RERANK_ENABLED: bool,
  RERANK_URL: httpUrl,
};

const IYZICO = {
  IYZICO_BASE_URL: httpsUrl,
  IYZICO_API_KEY_FILE: filePath,
  IYZICO_SECRET_KEY_FILE: filePath,
  IYZICO_MERCHANT_ID: text.optional(),
  IYZICO_MOCK: bool.default(false),
};

const LLM = {
  MOCK_LLM: bool.default(false),
  DEV_REAL_LLM: z.enum(['deepseek', 'anthropic']).optional(),
};

const VAPID_PUBLIC = { VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]+$/) };

const WEB_LIKE = {
  ...COMMON,
  ...URLS_OPTIONAL,
  APP_URL: httpsUrl,
  ADMIN_URL: httpsUrl,
  MARKETING_URL: httpsUrl,
  PORT: port,
  HOSTNAME: text,
  API_INTERNAL_URL: httpUrl,
  NEXT_TELEMETRY_DISABLED: z.literal('1'),
};

// ---------- servis şemaları ----------

export const ENV_SCHEMAS = {
  // 002 §5.1 + §5.2 + §5.13
  api: z.object({
    ...COMMON,
    SECRETS_DIR: filePath,
    ...URLS,
    API_PORT: port,
    API_ADMIN_PORT: port,
    API_ADMIN_LISTEN_HOST: z.ipv4(),
    ...PG_BASE,
    PG_USER: text,
    PG_PASSWORD_FILE: filePath,
    PG_POOL_MAX: positiveInt,
    PG_AUTH_USER: text,
    PG_AUTH_PASSWORD_FILE: filePath,
    PG_AUTH_POOL_MAX: positiveInt,
    PG_ADMIN_RO_USER: text,
    PG_ADMIN_RO_PASSWORD_FILE: filePath,
    PG_ADMIN_RO_POOL_MAX: positiveInt,
    VALKEY_URL: redisUrl,
    VALKEY_USERNAME: text,
    VALKEY_PASSWORD_FILE: filePath,
    VALKEY_CACHE_URL: redisUrl,
    VALKEY_CACHE_USERNAME: text,
    VALKEY_CACHE_PASSWORD_FILE: filePath,
    BETTER_AUTH_URL: httpsUrl,
    BETTER_AUTH_SECRET_FILE: filePath,
    BETTER_AUTH_ADMIN_URL: httpsUrl,
    BETTER_AUTH_ADMIN_SECRET_FILE: filePath,
    PASSKEY_RP_ID: hostname,
    GOOGLE_CLIENT_ID: text.optional(),
    GOOGLE_CLIENT_SECRET_FILE: filePath.optional(),
    ...KEYS,
    ...EMBED,
    EMBED_QUERY_URL: httpUrl,
    ...S3,
    ...PROXY,
    ...IYZICO,
    ...VAPID_PUBLIC,
    ...LLM,
    PLATFORM_AI_KEY_FALLBACK: bool.default(false),
  }),
  // 002 §5.1 + §5.3 (5.2'den devralınanlar dahil) + §5.13
  worker: z.object({
    ...COMMON,
    SECRETS_DIR: filePath,
    ...URLS_OPTIONAL,
    APP_URL: httpsUrl,
    ...PG_BASE,
    PG_USER: text,
    PG_PASSWORD_FILE: filePath,
    PG_POOL_MAX: positiveInt,
    VALKEY_URL: redisUrl,
    VALKEY_USERNAME: text,
    VALKEY_PASSWORD_FILE: filePath,
    VALKEY_CACHE_URL: redisUrl,
    VALKEY_CACHE_USERNAME: text,
    VALKEY_CACHE_PASSWORD_FILE: filePath,
    ...KEYS,
    ...EMBED,
    EMBED_QUERY_URL: httpUrl.optional(),
    EMBED_BATCH_URL: httpUrl,
    ...S3,
    ...PROXY,
    ...IYZICO,
    ...VAPID_PUBLIC,
    VAPID_PRIVATE_KEY_FILE: filePath,
    VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)\S+$/),
    ...LLM,
    DOC_ENGINE_URL: httpUrl,
    DOC_ENGINE_TOKEN_FILE: filePath,
    EMAIL_TRANSPORT: z.enum(['smtp', 'http']),
    SMTP_URL: smtpUrl.optional(),
    EMAIL_API_URL: httpsUrl.optional(),
    EMAIL_API_KEY_FILE: filePath,
    EMAIL_FROM: text,
    CLAMAV_ENABLED: bool,
    CLAMAV_HOST: text,
    CLAMAV_PORT: port,
    WORKER_QUEUES: queueList,
    WORKER_METRICS_PORT: port,
  }),
  // 002 §5.1 + §5.4 (+ 073 §7.1 yedek durumu)
  jobs: z.object({
    ...COMMON,
    ...URLS_OPTIONAL,
    ...PG_BASE,
    PG_JOBS_USER: text,
    PG_JOBS_PASSWORD_FILE: filePath,
    VALKEY_URL: redisUrl,
    VALKEY_USERNAME: text,
    VALKEY_PASSWORD_FILE: filePath,
    ...S3,
    S3_BUCKET_AUDIT: text,
    S3_AUDIT_ACCESS_KEY_ID_FILE: filePath,
    S3_AUDIT_SECRET_ACCESS_KEY_FILE: filePath,
    WORKER_QUEUES: queueList,
    WORKER_METRICS_PORT: port,
    BACKUP_STATUS_URL: httpUrl.optional(),
    BACKUP_STATUS_TOKEN_FILE: filePath.optional(),
  }),
  // 002 §5.1 + §5.5
  web: z.object(WEB_LIKE),
  admin: z.object(WEB_LIKE),
  // 002 §5.1 + §5.6 + §5.13
  'yargi-mcp': z.object({
    ...COMMON,
    MCP_PORT: port,
    INTERNAL_JWT_PUBLIC_KEY_FILE: filePath,
    INTERNAL_JWT_AUDIENCE: text,
    VALKEY_CACHE_URL: redisUrl,
    VALKEY_CACHE_USERNAME: text,
    VALKEY_CACHE_PASSWORD_FILE: filePath,
    YARGI_SOURCES_ENABLED: sourceList,
    ...PROXY,
    SOURCE_USER_AGENT: text,
    SOURCE_FIXTURE_MODE: z.enum(['off', 'replay']).default('off'),
    NODE_EXTRA_CA_CERTS: filePath.optional(),
  }),
  // 002 §5.1 + §5.10 + §5.13 (compose 070 §4.2 kova adlarını da verir)
  migrate: z.object({
    ...COMMON,
    ...PG_BASE,
    PG_USER: text,
    PG_PASSWORD_FILE: filePath,
    S3_ENDPOINT: httpUrl,
    S3_REGION: text.optional(),
    S3_BUCKET_FILES: text.optional(),
    S3_BUCKET_EXPORTS: text.optional(),
    S3_BUCKET_AUDIT: text.optional(),
    S3_ADMIN_ACCESS_KEY_ID_FILE: filePath,
    S3_ADMIN_SECRET_ACCESS_KEY_FILE: filePath,
    SEED_PROFILE: z.enum(['prod', 'dev']),
    KEK_MASTER_FILE: filePath.optional(),
    DEV_SEED_PASSWORD_FILE: filePath.optional(),
  }),
} as const satisfies Record<EnvService, z.ZodObject>;

export type EnvOf<S extends EnvService> = z.output<(typeof ENV_SCHEMAS)[S]>;
export type ApiEnv = EnvOf<'api'>;
export type WorkerEnv = EnvOf<'worker'>;
export type JobsEnv = EnvOf<'jobs'>;
export type WebEnv = EnvOf<'web'>;
export type AdminEnv = EnvOf<'admin'>;
export type YargiMcpEnv = EnvOf<'yargi-mcp'>;
export type MigrateEnv = EnvOf<'migrate'>;

type SecretFileName<S extends EnvService> = Extract<keyof EnvOf<S>, `${string}_FILE`>;

/**
 * Servisin her ortamda zorunlu ve boş olamayan sır dosyası env adları (002 §6, 040 §13.2).
 * Dev'de boş dosya olarak üretilen sırlar (iyzico, e-posta, Google) burada değildir.
 */
export const SECRET_FILE_VARS: { readonly [S in EnvService]: readonly SecretFileName<S>[] } = {
  api: [
    'PG_PASSWORD_FILE',
    'PG_AUTH_PASSWORD_FILE',
    'PG_ADMIN_RO_PASSWORD_FILE',
    'VALKEY_PASSWORD_FILE',
    'VALKEY_CACHE_PASSWORD_FILE',
    'BETTER_AUTH_SECRET_FILE',
    'BETTER_AUTH_ADMIN_SECRET_FILE',
    'KEK_MASTER_FILE',
    'HMAC_PSEUDONYM_KEY_FILE',
    'INTERNAL_JWT_PRIVATE_KEY_FILE',
    'TEI_API_KEY_FILE',
    'S3_ACCESS_KEY_ID_FILE',
    'S3_SECRET_ACCESS_KEY_FILE',
  ],
  worker: [
    'PG_PASSWORD_FILE',
    'VALKEY_PASSWORD_FILE',
    'VALKEY_CACHE_PASSWORD_FILE',
    'KEK_MASTER_FILE',
    'HMAC_PSEUDONYM_KEY_FILE',
    'INTERNAL_JWT_PRIVATE_KEY_FILE',
    'TEI_API_KEY_FILE',
    'S3_ACCESS_KEY_ID_FILE',
    'S3_SECRET_ACCESS_KEY_FILE',
    'DOC_ENGINE_TOKEN_FILE',
    'VAPID_PRIVATE_KEY_FILE',
  ],
  jobs: [
    'PG_JOBS_PASSWORD_FILE',
    'VALKEY_PASSWORD_FILE',
    'S3_ACCESS_KEY_ID_FILE',
    'S3_SECRET_ACCESS_KEY_FILE',
    'S3_AUDIT_ACCESS_KEY_ID_FILE',
    'S3_AUDIT_SECRET_ACCESS_KEY_FILE',
  ],
  web: [],
  admin: [],
  'yargi-mcp': ['INTERNAL_JWT_PUBLIC_KEY_FILE', 'VALKEY_CACHE_PASSWORD_FILE'],
  migrate: ['PG_PASSWORD_FILE', 'S3_ADMIN_ACCESS_KEY_ID_FILE', 'S3_ADMIN_SECRET_ACCESS_KEY_FILE'],
};

/**
 * Doğrulanmış env için zorunlu sır dosyası adları: `SECRET_FILE_VARS` + koşullu zorunlular
 * (migrate `SEED_PROFILE=dev`: `KEK_MASTER_FILE`, `DEV_SEED_PASSWORD_FILE`; 002 §5.13).
 */
export function requiredSecretFileVars<S extends EnvService>(
  service: S,
  env: EnvOf<S>,
): readonly string[] {
  const base: readonly string[] = SECRET_FILE_VARS[service];
  if (service === 'migrate' && (env as MigrateEnv).SEED_PROFILE === 'dev') {
    return [...base, 'KEK_MASTER_FILE', 'DEV_SEED_PASSWORD_FILE'];
  }
  return base;
}

// ---------- hata ----------

export type EnvIssue = { readonly name: string; readonly reason: string };

/** Env doğrulama hatası: ileti ve `issues` yalnız değişken adı ve kısa neden taşır. */
export class EnvValidationError extends Error {
  override name = 'EnvValidationError';
  readonly service: EnvService;
  readonly issues: readonly EnvIssue[];

  constructor(service: EnvService, issues: readonly EnvIssue[]) {
    const list = issues.map((i) => `${i.name} (${i.reason})`).join(', ');
    super(`env doğrulaması başarısız [${service}]: ${list}`);
    this.service = service;
    this.issues = issues;
  }
}

const R = {
  missing: 'eksik',
  invalid: 'geçersiz değer',
  unknown: 'bilinmeyen önekli değişken',
  nextPublic: 'NEXT_PUBLIC_ değişkeni kullanılmaz',
  devOnly: 'yalnız development/test ortamında',
  devRealOnly: 'yalnız development/test ve beta-synthetic ortamında',
  prodForbidden: 'production ortamında yasak',
  envMismatch: 'ortamla uyuşmuyor',
  noProxy: 'kanonik değerle uyuşmuyor',
  jobsProxy: 'jobs servisinde vekil tanımlanmaz',
  maintenance: 'maintenance kuyruğu yalnız jobs servisinde',
  jobsQueues: 'jobs yalnız maintenance kuyruğunu tüketir',
  duplicate: 'yinelenen değer',
} as const;

type Source = Readonly<Record<string, string | undefined>>;

function present(source: Source): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

function schemaKeys(service: EnvService): ReadonlySet<string> {
  return new Set(Object.keys(ENV_SCHEMAS[service].shape));
}

function unknownPrefixedIssues(service: EnvService, source: Source): EnvIssue[] {
  const keys = schemaKeys(service);
  const issues: EnvIssue[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (name.startsWith('NEXT_PUBLIC_')) {
      issues.push({ name, reason: R.nextPublic });
    } else if (KNOWN_ENV_PREFIXES.some((p) => name.startsWith(p)) && !keys.has(name)) {
      issues.push({ name, reason: R.unknown });
    }
  }
  return issues;
}

/**
 * 040 §13.2: bilinen önekle başlayıp servis şemasında olmayan değişken ve `NEXT_PUBLIC_*`
 * değişkenleri hatadır; sistem değişkenleri (`PATH`, `HOSTNAME`, `NODE_*`) yok sayılır.
 */
export function assertNoUnknownPrefixed(service: EnvService, source: Source): void {
  const issues = unknownPrefixedIssues(service, source);
  if (issues.length > 0) throw new EnvValidationError(service, issues);
}

function rawIssues(service: EnvService, raw: Record<string, string>): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const noProxy = raw.NO_PROXY;
  if (noProxy !== undefined && noProxy !== CANONICAL_NO_PROXY) {
    issues.push({ name: 'NO_PROXY', reason: R.noProxy });
  }
  if (service === 'jobs') {
    for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) {
      if (raw[name] !== undefined) issues.push({ name, reason: R.jobsProxy });
    }
  }
  return issues;
}

type Parsed = Readonly<Record<string, unknown>>;

function gateIssues(service: EnvService, env: Parsed): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const edaEnv = env.EDA_ENV as EdaEnv;
  const devLike = (DEV_LIKE_ENVS as readonly string[]).includes(edaEnv);
  const production = edaEnv === 'production';
  const devOnly = (name: string, active: boolean): void => {
    if (active && !devLike) issues.push({ name, reason: R.devOnly });
  };
  devOnly('MOCK_LLM', env.MOCK_LLM === true);
  devOnly('EMBED_PROVIDER', env.EMBED_PROVIDER === 'mock');
  // DEV_REAL_LLM: tek VPS sentetik veri pilotunda (beta-synthetic) da serbest.
  if (env.DEV_REAL_LLM !== undefined && !devLike && edaEnv !== 'beta-synthetic') {
    issues.push({ name: 'DEV_REAL_LLM', reason: R.devRealOnly });
  }
  // PLATFORM_AI_KEY_FALLBACK: ortak anahtar yalnız sentetik veri ortamlarında açılabilir.
  if (env.PLATFORM_AI_KEY_FALLBACK === true && !devLike && edaEnv !== 'beta-synthetic') {
    issues.push({ name: 'PLATFORM_AI_KEY_FALLBACK', reason: R.devRealOnly });
  }
  devOnly('IYZICO_MOCK', env.IYZICO_MOCK === true);
  devOnly('SOURCE_FIXTURE_MODE', env.SOURCE_FIXTURE_MODE === 'replay');
  devOnly('SEED_PROFILE', env.SEED_PROFILE === 'dev');
  devOnly('DEV_SEED_PASSWORD_FILE', env.DEV_SEED_PASSWORD_FILE !== undefined);
  devOnly('EMAIL_TRANSPORT', env.EMAIL_TRANSPORT === 'smtp');

  if (production && env.API_ADMIN_LISTEN_HOST === '0.0.0.0') {
    issues.push({ name: 'API_ADMIN_LISTEN_HOST', reason: R.prodForbidden });
  }
  if (production && env.CLAMAV_ENABLED === false) {
    issues.push({ name: 'CLAMAV_ENABLED', reason: R.prodForbidden });
  }
  if (typeof env.IYZICO_BASE_URL === 'string') {
    const base = env.IYZICO_BASE_URL.replace(/\/+$/, '');
    const expected = production ? IYZICO_PRODUCTION_BASE_URL : IYZICO_SANDBOX_BASE_URL;
    if (base !== expected) issues.push({ name: 'IYZICO_BASE_URL', reason: R.envMismatch });
  }
  if (env.EMAIL_TRANSPORT === 'smtp' && env.SMTP_URL === undefined) {
    issues.push({ name: 'SMTP_URL', reason: R.missing });
  }
  if (env.EMAIL_TRANSPORT === 'http' && env.EMAIL_API_URL === undefined) {
    issues.push({ name: 'EMAIL_API_URL', reason: R.missing });
  }
  if (service === 'migrate' && env.SEED_PROFILE === 'dev') {
    for (const name of ['KEK_MASTER_FILE', 'DEV_SEED_PASSWORD_FILE']) {
      if (env[name] === undefined) issues.push({ name, reason: R.missing });
    }
  }
  const queues = env.WORKER_QUEUES;
  if (Array.isArray(queues)) {
    if (new Set(queues).size !== queues.length) {
      issues.push({ name: 'WORKER_QUEUES', reason: R.duplicate });
    }
    if (service === 'worker' && queues.includes(JOBS_ONLY_QUEUE)) {
      issues.push({ name: 'WORKER_QUEUES', reason: R.maintenance });
    }
    if (service === 'jobs' && (queues.length !== 1 || queues[0] !== JOBS_ONLY_QUEUE)) {
      issues.push({ name: 'WORKER_QUEUES', reason: R.jobsQueues });
    }
  }
  return issues;
}

function dedupe(issues: readonly EnvIssue[]): EnvIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.name}\u0000${i.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Servis env'ini doğrular ve tipli nesne döndürür. Boş dize tanımsız sayılır. Şema, bilinmeyen
 * önek, `NEXT_PUBLIC_*`, `NO_PROXY` ve ortam kapılarının tüm ihlalleri tek seferde
 * `EnvValidationError` olarak fırlatılır; çağıran süreç sıfırdan farklı kodla çıkar (KK-002-3).
 */
export function parseEnv<S extends EnvService>(service: S, source: Source): EnvOf<S> {
  const raw = present(source);
  const issues: EnvIssue[] = [
    ...unknownPrefixedIssues(service, source),
    ...rawIssues(service, raw),
  ];
  const result = ENV_SCHEMAS[service].safeParse(raw);
  if (result.success) {
    issues.push(...gateIssues(service, result.data as Parsed));
  } else {
    for (const issue of result.error.issues) {
      const name = String(issue.path[0] ?? '(kök)');
      issues.push({ name, reason: raw[name] === undefined ? R.missing : R.invalid });
    }
  }
  if (issues.length > 0 || !result.success) throw new EnvValidationError(service, dedupe(issues));
  // ENV_SCHEMAS[service] çıktısı tanım gereği EnvOf<S>; TS dizinli birleşimi daraltamaz.
  return result.data as unknown as EnvOf<S>;
}
