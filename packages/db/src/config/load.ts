// Env tek okuma noktası (noProcessEnv istisnası): 002 §5 şeması + zorunlu sır dosyalarının
// okunabilirliği. Sır değeri okunmaz; hata çıktısı yalnız değişken adlarını içerir.
import { accessSync, constants, statSync } from 'node:fs';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import {
  ENV_SCHEMAS,
  type EnvOf,
  EnvValidationError,
  parseEnv,
  requiredSecretFileVars,
} from '@eda/contracts/config/env';
import type { z } from 'zod';
import type { PoolConfig } from '../pool.ts';
import { profileGateViolated } from '../seed/profile.ts';

/**
 * Profil kapısı (032 §10.1, KK-032-14): `SEED_PROFILE=dev` yalnız development/test ortamında.
 * Env şema doğrulamasından ÖNCE denetlenir; çünkü ihlal çıkış 60 ile raporlanır (genel env hatası 1).
 */
/** Seed girişinin env doğrulamasından önce okuduğu ham değerler (profil kapısı için). */
export function seedGateInputs(): {
  readonly profile: string | undefined;
  readonly edaEnv: string;
} {
  return { profile: process.env.SEED_PROFILE, edaEnv: process.env.EDA_ENV ?? '' };
}

export function seedProfileGateViolated(): boolean {
  return profileGateViolated(process.env.SEED_PROFILE, process.env.EDA_ENV ?? '');
}

export function assertSecretFilesReadable(
  env: Readonly<Record<string, unknown>>,
  names: readonly string[],
): void {
  const bad = names.filter((name) => {
    const path = env[name];
    if (typeof path !== 'string') return true;
    try {
      accessSync(path, constants.R_OK);
      return statSync(path).size === 0;
    } catch {
      return true;
    }
  });
  if (bad.length > 0) throw new Error(`sır dosyası okunamadı veya boş: ${bad.join(', ')}`);
}

export function load<S extends 'migrate'>(service: S): EnvOf<S> {
  try {
    const env = parseEnv(service, process.env);
    assertSecretFilesReadable(env, requiredSecretFileVars(service, env));
    return env;
  } catch (err) {
    const detail =
      err instanceof EnvValidationError
        ? `env geçersiz: ${err.issues.map((i) => `${i.name} (${i.reason})`).join(', ')}`
        : err instanceof Error
          ? err.message
          : 'yapılandırma yüklenemedi';
    process.stderr.write(`eda-${service}: ${detail}\n`);
    process.exit(1);
  }
}

/** Varsayılan çalışma zamanı havuzunun env alt kümesi (api ve worker ortak; 002 §5.2–§5.3). */
const RuntimePoolEnv = ENV_SCHEMAS.worker.pick({
  PG_HOST: true,
  PG_PORT: true,
  PG_DATABASE: true,
  PG_USER: true,
  PG_PASSWORD_FILE: true,
  PG_POOL_MAX: true,
  OTEL_SERVICE_NAME: true,
});

/**
 * `withTenant` varsayılan havuzunun yapılandırması (api: eda_app, worker: eda_worker). Geçersiz env
 * yalnız değişken adlarıyla raporlanır; sır değeri okunmaz (havuz bağlanırken dosyadan okur).
 */
export function loadRuntimePoolConfig(): PoolConfig {
  const res = RuntimePoolEnv.safeParse(process.env);
  if (!res.success) {
    const names = [...new Set(res.error.issues.map((i) => String(i.path[0] ?? '?')))];
    throw new Error(`veritabanı havuzu env geçersiz: ${names.join(', ')}`);
  }
  const env = res.data;
  return {
    host: env.PG_HOST,
    port: env.PG_PORT,
    database: env.PG_DATABASE,
    user: env.PG_USER,
    passwordFile: env.PG_PASSWORD_FILE,
    max: env.PG_POOL_MAX,
    ...(env.OTEL_SERVICE_NAME ? { applicationName: env.OTEL_SERVICE_NAME } : {}),
  };
}

const AuthPoolEnv = ENV_SCHEMAS.api.pick({
  PG_HOST: true,
  PG_PORT: true,
  PG_DATABASE: true,
  PG_AUTH_USER: true,
  PG_AUTH_PASSWORD_FILE: true,
  PG_AUTH_POOL_MAX: true,
  OTEL_SERVICE_NAME: true,
});
const AdminPoolEnv = ENV_SCHEMAS.api.pick({
  PG_HOST: true,
  PG_PORT: true,
  PG_DATABASE: true,
  PG_ADMIN_RO_USER: true,
  PG_ADMIN_RO_PASSWORD_FILE: true,
  PG_ADMIN_RO_POOL_MAX: true,
  OTEL_SERVICE_NAME: true,
});
const JobsPoolEnv = ENV_SCHEMAS.jobs.pick({
  PG_HOST: true,
  PG_PORT: true,
  PG_DATABASE: true,
  PG_JOBS_USER: true,
  PG_JOBS_PASSWORD_FILE: true,
  OTEL_SERVICE_NAME: true,
});

function parsePoolEnv<T>(schema: z.ZodType<T>, label: string): T {
  const res = schema.safeParse(process.env);
  if (!res.success) {
    const names = [...new Set(res.error.issues.map((i) => String(i.path[0] ?? '?')))];
    throw new Error(`${label} havuzu env geçersiz: ${names.join(', ')}`);
  }
  return res.data;
}

/** `authDb` havuzu (eda_auth; 031 §10): api, yalnız Better Auth. */
export function loadAuthPoolConfig(): PoolConfig {
  const env = parsePoolEnv(AuthPoolEnv, 'auth');
  return {
    host: env.PG_HOST,
    port: env.PG_PORT,
    database: env.PG_DATABASE,
    user: env.PG_AUTH_USER,
    passwordFile: env.PG_AUTH_PASSWORD_FILE,
    max: env.PG_AUTH_POOL_MAX,
    ...(env.OTEL_SERVICE_NAME ? { applicationName: env.OTEL_SERVICE_NAME } : {}),
  };
}

/** `adminDb` havuzu (eda_readonly_admin; 031 §10): api admin dinleyicisi. */
export function loadAdminPoolConfig(): PoolConfig {
  const env = parsePoolEnv(AdminPoolEnv, 'admin');
  return {
    host: env.PG_HOST,
    port: env.PG_PORT,
    database: env.PG_DATABASE,
    user: env.PG_ADMIN_RO_USER,
    passwordFile: env.PG_ADMIN_RO_PASSWORD_FILE,
    max: env.PG_ADMIN_RO_POOL_MAX,
    ...(env.OTEL_SERVICE_NAME ? { applicationName: env.OTEL_SERVICE_NAME } : {}),
  };
}

/** `jobsDb` havuzu (eda_jobs; 031 §10): boyut `db.jobsPoolMax`. */
export function loadJobsPoolConfig(): PoolConfig {
  const env = parsePoolEnv(JobsPoolEnv, 'jobs');
  return {
    host: env.PG_HOST,
    port: env.PG_PORT,
    database: env.PG_DATABASE,
    user: env.PG_JOBS_USER,
    passwordFile: env.PG_JOBS_PASSWORD_FILE,
    max: CONFIG_DEFAULTS['db.jobsPoolMax'],
    ...(env.OTEL_SERVICE_NAME ? { applicationName: env.OTEL_SERVICE_NAME } : {}),
  };
}
