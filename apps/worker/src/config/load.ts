// Env tek okuma noktası (noProcessEnv istisnası): 002 §5 şeması + zorunlu sır dosyalarının
// okunabilirliği. Sır değeri okunmaz; hata çıktısı yalnız değişken adlarını içerir.
import { accessSync, constants, statSync } from 'node:fs';
import {
  type EnvOf,
  EnvValidationError,
  parseEnv,
  requiredSecretFileVars,
} from '@eda/contracts/config/env';

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

export function load<S extends 'worker' | 'jobs'>(service: S): EnvOf<S> {
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
