// @tk TK-28
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNoUnknownPrefixed,
  CANONICAL_NO_PROXY,
  EDA_ENVS,
  ENV_SCHEMAS,
  ENV_SERVICES,
  type EnvService,
  EnvValidationError,
  IYZICO_PRODUCTION_BASE_URL,
  parseEnv,
  QUEUE_NAMES,
  requiredSecretFileVars,
  SECRET_FILE_VARS,
} from '../src/config/env.ts';

type Canon = { edaEnvs: string[]; noProxy: string; queues: string[]; names: string[] };
const canon = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'canon-env.json'), 'utf8'),
) as Canon;

type Env = Record<string, string | undefined>;

// Compose 070 §3-§5 ile aynı ad kümesi; değerler yalnız sentetik yol/adres (sır değeri yok).
const NODE: Env = {
  EDA_ENV: 'development',
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  TZ: 'UTC',
  OTEL_EXPORTER_OTLP_ENDPOINT: '',
  GLITCHTIP_DSN: '',
  SECRETS_DIR: '/run/secrets',
  PATH: '/usr/local/bin:/usr/bin',
  HOME: '/tmp/home',
};
const URLS: Env = {
  APP_DOMAIN: 'eda.localhost',
  APP_URL: 'https://app.eda.localhost:8443',
  ADMIN_URL: 'https://admin.eda.localhost:8443',
  MARKETING_URL: 'https://eda.localhost:8443',
};
const PROXY: Env = {
  HTTPS_PROXY: 'http://egress-llm:4750',
  HTTP_PROXY: 'http://egress-llm:4750',
  NODE_USE_ENV_PROXY: '1',
  NO_PROXY: CANONICAL_NO_PROXY,
};
const S3: Env = {
  S3_ENDPOINT: 'http://objstore:8333',
  S3_REGION: 'tr-1',
  S3_BUCKET_FILES: 'eda-files',
  S3_BUCKET_EXPORTS: 'eda-exports',
  S3_ACCESS_KEY_ID_FILE: '/run/secrets/s3_access_key_id',
  S3_SECRET_ACCESS_KEY_FILE: '/run/secrets/s3_secret_access_key',
};
const EMBED: Env = {
  EMBED_PROVIDER: 'mock',
  EMBED_QUERY_URL: 'http://embed-query:8080',
  TEI_API_KEY_FILE: '/run/secrets/tei_api_key',
  EMBED_MODEL_ID: 'BAAI/bge-m3',
  EMBED_MODEL_REVISION: '0000000000000000000000000000000000000000',
  EMBED_DIM: '1024',
  RERANK_ENABLED: 'false',
  RERANK_URL: 'http://rerank:8081',
};
const LLM: Env = { MOCK_LLM: 'true', DEV_REAL_LLM: '' };
const IYZICO: Env = {
  IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com',
  IYZICO_API_KEY_FILE: '/run/secrets/iyzico_api_key',
  IYZICO_SECRET_KEY_FILE: '/run/secrets/iyzico_secret_key',
};
const KEYS: Env = {
  KEK_MASTER_FILE: '/run/secrets/kek_master',
  HMAC_PSEUDONYM_KEY_FILE: '/run/secrets/hmac_pseudonym_key',
  INTERNAL_JWT_PRIVATE_KEY_FILE: '/run/secrets/internal_jwt_private_key',
  YARGI_MCP_URL: 'http://yargi-mcp:8001/mcp',
};

const VALID: Record<EnvService, Env> = {
  api: {
    ...NODE,
    ...URLS,
    ...PROXY,
    ...S3,
    ...EMBED,
    ...LLM,
    ...IYZICO,
    ...KEYS,
    OTEL_SERVICE_NAME: 'eda-api',
    API_PORT: '8000',
    API_ADMIN_PORT: '8010',
    API_ADMIN_LISTEN_HOST: '0.0.0.0',
    PG_HOST: 'postgres',
    PG_PORT: '5432',
    PG_DATABASE: 'eda',
    PG_USER: 'eda_app',
    PG_PASSWORD_FILE: '/run/secrets/pg_app_password',
    PG_POOL_MAX: '20',
    PG_AUTH_USER: 'eda_auth',
    PG_AUTH_PASSWORD_FILE: '/run/secrets/pg_auth_password',
    PG_AUTH_POOL_MAX: '5',
    PG_ADMIN_RO_USER: 'eda_readonly_admin',
    PG_ADMIN_RO_PASSWORD_FILE: '/run/secrets/pg_readonly_admin_password',
    PG_ADMIN_RO_POOL_MAX: '3',
    VALKEY_URL: 'redis://valkey:6379',
    VALKEY_USERNAME: 'eda_api',
    VALKEY_PASSWORD_FILE: '/run/secrets/valkey_api_password',
    VALKEY_CACHE_URL: 'redis://valkey-cache:6379',
    VALKEY_CACHE_USERNAME: 'eda_api',
    VALKEY_CACHE_PASSWORD_FILE: '/run/secrets/valkey_cache_api_password',
    BETTER_AUTH_URL: 'https://app.eda.localhost:8443',
    BETTER_AUTH_SECRET_FILE: '/run/secrets/better_auth_secret',
    BETTER_AUTH_ADMIN_URL: 'https://admin.eda.localhost:8443',
    BETTER_AUTH_ADMIN_SECRET_FILE: '/run/secrets/better_auth_admin_secret',
    PASSKEY_RP_ID: 'eda.localhost',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET_FILE: '/run/secrets/google_client_secret',
    VAPID_PUBLIC_KEY: 'BPublicKeyBase64url_-',
    NODE_OPTIONS: '--max-old-space-size=768',
  },
  worker: {
    ...NODE,
    ...URLS,
    ...PROXY,
    ...S3,
    ...EMBED,
    ...LLM,
    ...IYZICO,
    ...KEYS,
    OTEL_SERVICE_NAME: 'eda-worker',
    PG_HOST: 'postgres',
    PG_PORT: '5432',
    PG_DATABASE: 'eda',
    PG_USER: 'eda_worker',
    PG_PASSWORD_FILE: '/run/secrets/pg_worker_password',
    PG_POOL_MAX: '10',
    VALKEY_URL: 'redis://valkey:6379',
    VALKEY_USERNAME: 'eda_worker',
    VALKEY_PASSWORD_FILE: '/run/secrets/valkey_worker_password',
    VALKEY_CACHE_URL: 'redis://valkey-cache:6379',
    VALKEY_CACHE_USERNAME: 'eda_worker',
    VALKEY_CACHE_PASSWORD_FILE: '/run/secrets/valkey_cache_worker_password',
    DOC_ENGINE_URL: 'http://doc-engine:8002',
    DOC_ENGINE_TOKEN_FILE: '/run/secrets/doc_engine_token',
    EMBED_BATCH_URL: 'http://embed-batch:8080',
    EMAIL_TRANSPORT: 'smtp',
    SMTP_URL: 'smtp://mailpit:1025',
    EMAIL_API_URL: '',
    EMAIL_API_KEY_FILE: '/run/secrets/email_api_key',
    EMAIL_FROM: 'E.D.A. Hukuk <bildirim@eda.localhost>',
    VAPID_PUBLIC_KEY: 'BPublicKeyBase64url_-',
    VAPID_PRIVATE_KEY_FILE: '/run/secrets/vapid_private_key',
    VAPID_SUBJECT: 'mailto:destek@eda.localhost',
    CLAMAV_ENABLED: 'false',
    CLAMAV_HOST: 'clamav',
    CLAMAV_PORT: '3310',
    WORKER_QUEUES:
      'files-interactive,files-batch,exports,corpus,citations,notifications,chat,billing',
    WORKER_METRICS_PORT: '9464',
  },
  jobs: {
    ...NODE,
    ...URLS,
    ...S3,
    OTEL_SERVICE_NAME: 'eda-jobs',
    PG_HOST: 'postgres',
    PG_PORT: '5432',
    PG_DATABASE: 'eda',
    PG_JOBS_USER: 'eda_jobs',
    PG_JOBS_PASSWORD_FILE: '/run/secrets/pg_jobs_password',
    VALKEY_URL: 'redis://valkey:6379',
    VALKEY_USERNAME: 'eda_jobs',
    VALKEY_PASSWORD_FILE: '/run/secrets/valkey_jobs_password',
    S3_BUCKET_AUDIT: 'eda-audit-seals',
    S3_AUDIT_ACCESS_KEY_ID_FILE: '/run/secrets/s3_audit_access_key_id',
    S3_AUDIT_SECRET_ACCESS_KEY_FILE: '/run/secrets/s3_audit_secret_access_key',
    WORKER_QUEUES: 'maintenance',
    WORKER_METRICS_PORT: '9464',
    BACKUP_STATUS_URL: '',
    BACKUP_STATUS_TOKEN_FILE: '/run/secrets/backup_status_token',
  },
  web: {
    ...NODE,
    ...URLS,
    OTEL_SERVICE_NAME: 'eda-web',
    PORT: '3000',
    HOSTNAME: '0.0.0.0',
    API_INTERNAL_URL: 'http://api:8000',
    NEXT_TELEMETRY_DISABLED: '1',
  },
  admin: {
    ...NODE,
    ...URLS,
    OTEL_SERVICE_NAME: 'eda-admin',
    PORT: '3001',
    HOSTNAME: '0.0.0.0',
    API_INTERNAL_URL: 'http://api-admin:8010',
    NEXT_TELEMETRY_DISABLED: '1',
  },
  'yargi-mcp': {
    ...NODE,
    OTEL_SERVICE_NAME: 'eda-yargi-mcp',
    MCP_PORT: '8001',
    INTERNAL_JWT_PUBLIC_KEY_FILE: '/run/secrets/internal_jwt_public_key',
    INTERNAL_JWT_AUDIENCE: 'yargi-mcp',
    VALKEY_CACHE_URL: 'redis://valkey-cache:6379',
    VALKEY_CACHE_USERNAME: 'eda_mcp',
    VALKEY_CACHE_PASSWORD_FILE: '/run/secrets/valkey_cache_mcp_password',
    YARGI_SOURCES_ENABLED: 'bedesten,anayasa,uyusmazlik,mevzuat',
    SOURCE_USER_AGENT: 'EDA-Hukuk-Kaynak-Istemcisi/1.0 (+https://eda.localhost/guvenlik)',
    HTTPS_PROXY: 'http://egress-portal:4750',
    HTTP_PROXY: 'http://egress-portal:4750',
    NODE_USE_ENV_PROXY: '1',
    NO_PROXY: CANONICAL_NO_PROXY,
  },
  migrate: {
    ...NODE,
    OTEL_SERVICE_NAME: 'eda-migrate',
    PG_HOST: 'postgres',
    PG_PORT: '5432',
    PG_DATABASE: 'eda',
    PG_USER: 'eda_owner',
    PG_PASSWORD_FILE: '/run/secrets/pg_owner_password',
    S3_ENDPOINT: 'http://objstore:8333',
    S3_REGION: 'tr-1',
    S3_BUCKET_FILES: 'eda-files',
    S3_BUCKET_EXPORTS: 'eda-exports',
    S3_BUCKET_AUDIT: 'eda-audit-seals',
    S3_ADMIN_ACCESS_KEY_ID_FILE: '/run/secrets/s3_admin_access_key_id',
    S3_ADMIN_SECRET_ACCESS_KEY_FILE: '/run/secrets/s3_admin_secret_access_key',
    SEED_PROFILE: 'dev',
    KEK_MASTER_FILE: '/run/secrets/kek_master',
    DEV_SEED_PASSWORD_FILE: '/run/secrets/dev_seed_password',
  },
};

/** Üretim ortamında geçerli api/worker env'i (kapıların karşılaştırma tabanı). */
function production(service: 'api' | 'worker'): Env {
  return {
    ...VALID[service],
    EDA_ENV: 'production',
    NODE_ENV: 'production',
    MOCK_LLM: 'false',
    EMBED_PROVIDER: 'tei',
    IYZICO_BASE_URL: IYZICO_PRODUCTION_BASE_URL,
    ...(service === 'api'
      ? { API_ADMIN_LISTEN_HOST: '172.30.10.2' }
      : {
          CLAMAV_ENABLED: 'true',
          EMAIL_TRANSPORT: 'http',
          SMTP_URL: '',
          EMAIL_API_URL: 'https://mail.example.test/send',
        }),
  };
}

function issuesOf(service: EnvService, env: Env): { name: string; reason: string }[] {
  try {
    parseEnv(service, env);
  } catch (err) {
    expect(err).toBeInstanceOf(EnvValidationError);
    return [...(err as EnvValidationError).issues];
  }
  return [];
}

function without(env: Env, ...names: string[]): Env {
  const out = { ...env };
  for (const n of names) delete out[n];
  return out;
}

describe('KK-P01b-2 KK-002-3 env şemaları (002 §5)', () => {
  it.each(ENV_SERVICES)('KK-P01b-2: compose 070 §4 env kümesi geçerli (%s)', (service) => {
    expect(() => parseEnv(service, VALID[service])).not.toThrow();
  });

  it('KK-P01b-2: tipli çıktı (sayı, mantıksal, liste) ve varsayılanlar', () => {
    const api = parseEnv('api', VALID.api);
    expect(api.API_PORT).toBe(8000);
    expect(api.PG_POOL_MAX).toBe(20);
    expect(api.MOCK_LLM).toBe(true);
    expect(api.IYZICO_MOCK).toBe(false);
    expect(api.GOOGLE_CLIENT_ID).toBeUndefined();
    const worker = parseEnv('worker', VALID.worker);
    expect(worker.WORKER_QUEUES).toContain('files-interactive');
    expect(worker.CLAMAV_ENABLED).toBe(false);
    const web = parseEnv('web', without(VALID.web, 'LOG_LEVEL', 'TZ'));
    expect(web.LOG_LEVEL).toBe('info');
    expect(web.TZ).toBe('UTC');
  });

  it('KK-002-3 KK-P01b-2: eksik zorunlu değişken hata verir, ileti yalnız adı içerir', () => {
    const env = { ...without(VALID.api, 'PG_USER'), PG_PORT: 'gizli-deger-olmamali' };
    let error: unknown;
    try {
      parseEnv('api', env);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(EnvValidationError);
    const e = error as EnvValidationError;
    expect(e.issues).toContainEqual({ name: 'PG_USER', reason: 'eksik' });
    expect(e.issues).toContainEqual({ name: 'PG_PORT', reason: 'geçersiz değer' });
    expect(e.message).toContain('PG_USER');
    for (const value of Object.values(env)) {
      if (value !== undefined && value.length > 3) expect(e.message).not.toContain(value);
    }
  });

  it('KK-002-3: boş dize tanımsız sayılır (zorunlu alan eksik)', () => {
    expect(issuesOf('api', { ...VALID.api, PG_HOST: '' })).toContainEqual({
      name: 'PG_HOST',
      reason: 'eksik',
    });
  });

  it.each(ENV_SERVICES.flatMap((s) => SECRET_FILE_VARS[s].map((v) => [s, v] as const)))(
    'KK-002-4 KK-P01b-2: zorunlu sır dosyası env adı eksikse başlamaz (%s %s)',
    (service, name) => {
      expect(name.endsWith('_FILE')).toBe(true);
      expect(issuesOf(service, without(VALID[service], name))).toContainEqual({
        name,
        reason: 'eksik',
      });
    },
  );

  it('KK-002-4: *_FILE değeri mutlak yol olmalı', () => {
    for (const value of ['run/secrets/pg_app_password', '/run/secrets/../etc/passwd']) {
      expect(issuesOf('api', { ...VALID.api, PG_PASSWORD_FILE: value })).toContainEqual({
        name: 'PG_PASSWORD_FILE',
        reason: 'geçersiz değer',
      });
    }
  });

  it('KK-002-4: migrate SEED_PROFILE=dev iken KEK ve dev seed sırları zorunlu', () => {
    const env = parseEnv('migrate', VALID.migrate);
    expect(requiredSecretFileVars('migrate', env)).toEqual(
      expect.arrayContaining(['KEK_MASTER_FILE', 'DEV_SEED_PASSWORD_FILE', 'PG_PASSWORD_FILE']),
    );
    expect(issuesOf('migrate', without(VALID.migrate, 'KEK_MASTER_FILE'))).toContainEqual({
      name: 'KEK_MASTER_FILE',
      reason: 'eksik',
    });
  });
});

describe('KK-040-16 KK-P01b-2 bilinmeyen önekli değişken (040 §13.2)', () => {
  it('KK-040-16: PG_POOL_MAXX başlatmayı durdurur', () => {
    expect(issuesOf('api', { ...VALID.api, PG_POOL_MAXX: '20' })).toContainEqual({
      name: 'PG_POOL_MAXX',
      reason: 'bilinmeyen önekli değişken',
    });
    expect(() => assertNoUnknownPrefixed('api', { ...VALID.api, PG_POOL_MAXX: '20' })).toThrow(
      EnvValidationError,
    );
  });

  it('KK-040-16: başka servisin önekli değişkeni de bilinmeyen sayılır (jobs PG_USER)', () => {
    expect(issuesOf('jobs', { ...VALID.jobs, PG_USER: 'eda_app' })).toContainEqual({
      name: 'PG_USER',
      reason: 'bilinmeyen önekli değişken',
    });
  });

  it('KK-040-16: sistem değişkenleri yok sayılır', () => {
    expect(() =>
      assertNoUnknownPrefixed('api', { ...VALID.api, PATH: '/bin', NODE_OPTIONS: '--x' }),
    ).not.toThrow();
  });

  it.each(ENV_SERVICES)('KK-P01b-2: NEXT_PUBLIC_* değişkeni reddedilir (%s)', (service) => {
    expect(
      issuesOf(service, { ...VALID[service], NEXT_PUBLIC_API_URL: 'https://x.test' }),
    ).toContainEqual({ name: 'NEXT_PUBLIC_API_URL', reason: 'NEXT_PUBLIC_ değişkeni kullanılmaz' });
  });
});

describe('KK-P01b-2 ortam kapıları (002 §5.2, §5.3, §5.13)', () => {
  it('KK-P01b-2: üretim tabanı geçerli', () => {
    expect(issuesOf('api', production('api'))).toEqual([]);
    expect(issuesOf('worker', production('worker'))).toEqual([]);
  });

  it.each([
    ['MOCK_LLM', 'true'],
    ['EMBED_PROVIDER', 'mock'],
    ['IYZICO_MOCK', 'true'],
  ])('KK-P01b-2: %s=%s yalnız development/test', (name, value) => {
    for (const edaEnv of ['production', 'staging', 'beta-synthetic', 'onprem']) {
      const env = {
        ...production('api'),
        EDA_ENV: edaEnv,
        IYZICO_BASE_URL:
          edaEnv === 'production' ? IYZICO_PRODUCTION_BASE_URL : 'https://sandbox-api.iyzipay.com',
        [name]: value,
      };
      expect(issuesOf('api', env)).toContainEqual({
        name,
        reason: 'yalnız development/test ortamında',
      });
    }
    expect(issuesOf('api', { ...VALID.api, EDA_ENV: 'test', [name]: value })).toEqual([]);
  });

  it.each(['deepseek', 'anthropic'])(
    'KK-P01b-2: DEV_REAL_LLM=%s development/test/beta-synthetic dışında reddedilir',
    (value) => {
      for (const edaEnv of ['production', 'staging', 'onprem']) {
        const env = {
          ...production('api'),
          EDA_ENV: edaEnv,
          IYZICO_BASE_URL:
            edaEnv === 'production'
              ? IYZICO_PRODUCTION_BASE_URL
              : 'https://sandbox-api.iyzipay.com',
          DEV_REAL_LLM: value,
        };
        expect(issuesOf('api', env)).toContainEqual({
          name: 'DEV_REAL_LLM',
          reason: 'yalnız development/test ve beta-synthetic ortamında',
        });
      }
      expect(issuesOf('api', { ...VALID.api, EDA_ENV: 'test', DEV_REAL_LLM: value })).toEqual([]);
      expect(
        issuesOf('api', { ...VALID.api, EDA_ENV: 'development', DEV_REAL_LLM: value }),
      ).toEqual([]);
      const beta = {
        ...production('api'),
        EDA_ENV: 'beta-synthetic',
        IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com',
      };
      expect(issuesOf('api', { ...beta, DEV_REAL_LLM: value })).toEqual([]);
    },
  );

  it('KK-P01b-2: beta-synthetic DEV_REAL_LLM açıkken MOCK_LLM ve EMBED_PROVIDER=mock yasak kalır', () => {
    const beta = {
      ...production('api'),
      EDA_ENV: 'beta-synthetic',
      IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com',
      DEV_REAL_LLM: 'anthropic',
    };
    expect(issuesOf('api', { ...beta, MOCK_LLM: 'true' })).toContainEqual({
      name: 'MOCK_LLM',
      reason: 'yalnız development/test ortamında',
    });
    expect(issuesOf('api', { ...beta, EMBED_PROVIDER: 'mock' })).toContainEqual({
      name: 'EMBED_PROVIDER',
      reason: 'yalnız development/test ortamında',
    });
  });

  it('KK-P01b-2: beta-synthetic DEV_REAL_LLM yokken önceki davranış (geçerli taban)', () => {
    const beta = {
      ...production('api'),
      EDA_ENV: 'beta-synthetic',
      IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com',
    };
    expect(issuesOf('api', beta)).toEqual([]);
  });

  it('KK-P01b-2: PLATFORM_AI_KEY_FALLBACK yalnız development/test/beta-synthetic ortamında geçerli, varsayılan kapalı', () => {
    for (const edaEnv of ['production', 'staging', 'onprem']) {
      const env = {
        ...production('api'),
        EDA_ENV: edaEnv,
        IYZICO_BASE_URL:
          edaEnv === 'production' ? IYZICO_PRODUCTION_BASE_URL : 'https://sandbox-api.iyzipay.com',
      };
      expect(issuesOf('api', env)).toEqual([]);
      expect(issuesOf('api', { ...env, PLATFORM_AI_KEY_FALLBACK: 'false' })).toEqual([]);
      expect(issuesOf('api', { ...env, PLATFORM_AI_KEY_FALLBACK: 'true' })).toContainEqual({
        name: 'PLATFORM_AI_KEY_FALLBACK',
        reason: 'yalnız development/test ve beta-synthetic ortamında',
      });
    }
    for (const edaEnv of ['development', 'test']) {
      expect(
        issuesOf('api', { ...VALID.api, EDA_ENV: edaEnv, PLATFORM_AI_KEY_FALLBACK: 'true' }),
      ).toEqual([]);
    }
    const beta = {
      ...production('api'),
      EDA_ENV: 'beta-synthetic',
      IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com',
    };
    expect(issuesOf('api', { ...beta, PLATFORM_AI_KEY_FALLBACK: 'true' })).toEqual([]);
  });

  it('KK-P01b-2: API_ADMIN_LISTEN_HOST=0.0.0.0 production ortamında hata', () => {
    expect(
      issuesOf('api', { ...production('api'), API_ADMIN_LISTEN_HOST: '0.0.0.0' }),
    ).toContainEqual({ name: 'API_ADMIN_LISTEN_HOST', reason: 'production ortamında yasak' });
    expect(issuesOf('api', { ...VALID.api, API_ADMIN_LISTEN_HOST: '0.0.0.0' })).toEqual([]);
  });

  it('KK-P01b-2: CLAMAV_ENABLED=false production ortamında hata (worker)', () => {
    expect(issuesOf('worker', { ...production('worker'), CLAMAV_ENABLED: 'false' })).toContainEqual(
      { name: 'CLAMAV_ENABLED', reason: 'production ortamında yasak' },
    );
  });

  it('KK-P01b-2: EMAIL_TRANSPORT=smtp yalnız development/test; http için EMAIL_API_URL', () => {
    expect(
      issuesOf('worker', {
        ...production('worker'),
        EMAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'smtp://mailpit:1025',
      }),
    ).toContainEqual({ name: 'EMAIL_TRANSPORT', reason: 'yalnız development/test ortamında' });
    expect(issuesOf('worker', { ...production('worker'), EMAIL_API_URL: '' })).toContainEqual({
      name: 'EMAIL_API_URL',
      reason: 'eksik',
    });
  });

  it('KK-045-15: production ve beta-synthetic worker için http + sağlayıcı adresi geçerli', () => {
    for (const edaEnv of ['production', 'beta-synthetic']) {
      for (const url of ['https://api.resend.com', 'https://api.brevo.com']) {
        const env = {
          ...production('worker'),
          EDA_ENV: edaEnv,
          EMAIL_TRANSPORT: 'http',
          EMAIL_API_URL: url,
        };
        expect(issuesOf('worker', env)).not.toContainEqual(
          expect.objectContaining({ name: 'EMAIL_TRANSPORT' }),
        );
        expect(issuesOf('worker', env)).not.toContainEqual(
          expect.objectContaining({ name: 'EMAIL_API_URL' }),
        );
      }
    }
  });

  it('KK-P01b-2: IYZICO_BASE_URL prod dışında sandbox, prod ortamında canlı adres', () => {
    expect(
      issuesOf('api', { ...VALID.api, IYZICO_BASE_URL: IYZICO_PRODUCTION_BASE_URL }),
    ).toContainEqual({ name: 'IYZICO_BASE_URL', reason: 'ortamla uyuşmuyor' });
    expect(
      issuesOf('api', { ...production('api'), IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com' }),
    ).toContainEqual({ name: 'IYZICO_BASE_URL', reason: 'ortamla uyuşmuyor' });
  });

  it('KK-P01b-2: EDA_ENV kümesi dışı değer reddedilir', () => {
    expect(issuesOf('web', { ...VALID.web, EDA_ENV: 'prod' })).toContainEqual({
      name: 'EDA_ENV',
      reason: 'geçersiz değer',
    });
  });

  it('KK-P01b-2: migrate SEED_PROFILE=dev production ortamında hata', () => {
    expect(issuesOf('migrate', { ...VALID.migrate, EDA_ENV: 'production' })).toEqual(
      expect.arrayContaining([
        { name: 'SEED_PROFILE', reason: 'yalnız development/test ortamında' },
        { name: 'DEV_SEED_PASSWORD_FILE', reason: 'yalnız development/test ortamında' },
      ]),
    );
  });

  it('KK-P01b-2 / KK-P11-19: yargi-mcp SOURCE_FIXTURE_MODE=replay yalnız development/test', () => {
    expect(
      issuesOf('yargi-mcp', {
        ...VALID['yargi-mcp'],
        EDA_ENV: 'staging',
        SOURCE_FIXTURE_MODE: 'replay',
      }),
    ).toContainEqual({ name: 'SOURCE_FIXTURE_MODE', reason: 'yalnız development/test ortamında' });
  });
});

describe('KK-P01b-2 vekil ve kuyruk kuralları (002 §5.4, §5.11, §17)', () => {
  it.each(['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy'])(
    'KK-P01b-2: jobs servisinde %s tanımlıysa hata',
    (name) => {
      expect(issuesOf('jobs', { ...VALID.jobs, [name]: 'http://egress-llm:4750' })).toContainEqual({
        name,
        reason: 'jobs servisinde vekil tanımlanmaz',
      });
    },
  );

  it.each(ENV_SERVICES)('KK-P01b-2: NO_PROXY tanımlıysa kanonik değere eşit (%s)', (service) => {
    expect(
      issuesOf(service, { ...VALID[service], NO_PROXY: 'localhost,127.0.0.1' }),
    ).toContainEqual({ name: 'NO_PROXY', reason: 'kanonik değerle uyuşmuyor' });
  });

  it('KK-P01b-2: worker WORKER_QUEUES içinde maintenance hata', () => {
    expect(
      issuesOf('worker', { ...VALID.worker, WORKER_QUEUES: 'files-interactive,maintenance' }),
    ).toContainEqual({
      name: 'WORKER_QUEUES',
      reason: 'maintenance kuyruğu yalnız jobs servisinde',
    });
  });

  it('KK-P01b-2: jobs WORKER_QUEUES yalnız maintenance', () => {
    expect(
      issuesOf('jobs', { ...VALID.jobs, WORKER_QUEUES: 'maintenance,exports' }),
    ).toContainEqual({
      name: 'WORKER_QUEUES',
      reason: 'jobs yalnız maintenance kuyruğunu tüketir',
    });
  });

  it('KK-P01b-2: bilinmeyen kuyruk adı reddedilir', () => {
    expect(issuesOf('worker', { ...VALID.worker, WORKER_QUEUES: 'files' })).toContainEqual({
      name: 'WORKER_QUEUES',
      reason: 'geçersiz değer',
    });
  });
});

describe('KK-002-3 şema ↔ 002 §5 uyumu (canon-env fixture)', () => {
  it('KK-002-3: NO_PROXY sabiti 002 §5.11 ile birebir', () => {
    expect(CANONICAL_NO_PROXY).toBe(canon.noProxy);
  });

  it('KK-002-3: EDA_ENV kümesi 002 §5.1 ile birebir', () => {
    expect([...EDA_ENVS]).toEqual(canon.edaEnvs);
  });

  it('KK-002-3: kuyruk adları 002 §17 ile birebir', () => {
    expect([...QUEUE_NAMES]).toEqual(canon.queues);
  });

  it('KK-002-3: şemadaki her değişken 002 §5te tanımlı', () => {
    // AS önerisi: BACKUP_STATUS_URL/BACKUP_STATUS_TOKEN_FILE 073 §7.1 ve 070 §4.2'de var, 002 §5.4'te yok.
    const notIn002 = new Set(['BACKUP_STATUS_URL', 'BACKUP_STATUS_TOKEN_FILE']);
    const names = new Set(canon.names);
    for (const service of ENV_SERVICES) {
      for (const key of Object.keys(ENV_SCHEMAS[service].shape)) {
        if (!notIn002.has(key)) expect(names.has(key), `${service} ${key}`).toBe(true);
      }
    }
  });
});
