// Seed profil kapısı (032 §10.1, §11.1; KK-032-14). Profil `prod` | `dev`; aşamalar:
//   prod profili : prod seed'leri
//   dev profili  : prod seed'leri + dev-base + dev-fixture-rules + dev-sample (dev-sample yalnız
//                  `development`; `test` ortamında atlanır — testler kendi dünyasını kurar, §12)
// `dev` profili yalnız development/test'te; `production`, `staging`, `beta-synthetic`, `onprem` için
// çıkış 60 (env şema doğrulamasından önce denetlenir).
import { DEV_LIKE_ENVS, EDA_ENVS, type EdaEnv } from '@eda/contracts/config/env';

export const SEED_PROFILES = ['prod', 'dev'] as const;
export type SeedProfile = (typeof SEED_PROFILES)[number];

export const DEV_STAGES = ['dev-base', 'dev-fixture-rules', 'dev-sample'] as const;
export type DevStage = (typeof DEV_STAGES)[number];

const isDevLike = (env: string): boolean => (DEV_LIKE_ENVS as readonly string[]).includes(env);

/** Profil kapısı ihlali: `dev` profili geliştirme/test dışında (çıkış 60). */
export function profileGateViolated(profile: string | undefined, edaEnv: string): boolean {
  return profile === 'dev' && !isDevLike(edaEnv);
}

/** Varsayılan profil (032 §10.1 tablosu): development/test `dev`, diğerleri `prod`. */
export function defaultProfile(edaEnv: EdaEnv): SeedProfile {
  return isDevLike(edaEnv) ? 'dev' : 'prod';
}

export function parseProfile(value: string | undefined, edaEnv: EdaEnv): SeedProfile {
  if (value === undefined || value === '') return defaultProfile(edaEnv);
  if ((SEED_PROFILES as readonly string[]).includes(value)) return value as SeedProfile;
  throw new RangeError(`geçersiz seed profili: ${value} (prod | dev)`);
}

export function parseEdaEnv(value: string | undefined): EdaEnv {
  if (value !== undefined && (EDA_ENVS as readonly string[]).includes(value)) {
    return value as EdaEnv;
  }
  throw new RangeError('EDA_ENV tanımsız veya geçersiz');
}

/** Profil + ortam için çalışacak dev aşamaları (prod profilinde boş). */
export function devStagesFor(profile: SeedProfile, edaEnv: EdaEnv): DevStage[] {
  if (profile !== 'dev' || !isDevLike(edaEnv)) return [];
  return DEV_STAGES.filter((s) => s !== 'dev-sample' || edaEnv === 'development');
}
