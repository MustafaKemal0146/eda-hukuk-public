// Parola özeti (042 §2.8): Argon2id (`@node-rs/argon2`; Better Auth varsayılanı scrypt değil). Çıktı
// PHC dizesi (`$argon2id$v=19$m=…,t=…,p=…$tuz$özet`; 030 `accounts_password_chk`), tuz 16 bayt CSPRNG
// (kütüphane üretir). Parametreler `auth.argon2*` yapılandırmasından. Bilinmeyen kullanıcıda Better Auth
// aynı maliyetli `hash` çağrısını yapar (zaman profili eşit). Başarılı doğrulamada kayıtlı parametreler
// güncellerden zayıfsa yeni özet `onRehash` ile yazılır (authDb).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { type Algorithm, hash, parseOptions, verify } from '@node-rs/argon2';

/** `Algorithm.Argon2id` (const enum; `isolatedModules` altında sayısal değer). */
const ARGON2ID = 2 as Algorithm;

export interface Argon2Params {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

export const CURRENT_PARAMS: Argon2Params = {
  memoryCost: CONFIG_DEFAULTS['auth.argon2MemoryKiB'],
  timeCost: CONFIG_DEFAULTS['auth.argon2TimeCost'],
  parallelism: CONFIG_DEFAULTS['auth.argon2Parallelism'],
};

export function hashPassword(
  password: string,
  params: Argon2Params = CURRENT_PARAMS,
): Promise<string> {
  return hash(password, { algorithm: ARGON2ID, ...params });
}

/** Kayıtlı özet güncel parametrelerden zayıf mı (veya Argon2id değil mi). */
export function needsRehash(stored: string, params: Argon2Params = CURRENT_PARAMS): boolean {
  if (!stored.startsWith('$argon2id$')) return true;
  try {
    const o = parseOptions(stored);
    return (
      o.memoryCost < params.memoryCost ||
      o.timeCost < params.timeCost ||
      o.parallelism < params.parallelism
    );
  } catch {
    return true;
  }
}

export interface PasswordHasherOptions {
  readonly params?: Argon2Params;
  /** Başarılı doğrulamada zayıf özetin yerine yazılacak yeni özet (eski özet anahtar). */
  readonly onRehash?: (oldHash: string, newHash: string) => Promise<void>;
}

/** Better Auth `emailAndPassword.password` için `{ hash, verify }`. */
export function createPasswordHasher(opts: PasswordHasherOptions = {}) {
  const params = opts.params ?? CURRENT_PARAMS;
  return {
    hash: (password: string) => hashPassword(password, params),
    verify: async ({ hash: stored, password }: { hash: string; password: string }) => {
      let ok = false;
      try {
        ok = await verify(stored, password);
      } catch {
        ok = false;
      }
      if (ok && opts.onRehash !== undefined && needsRehash(stored, params)) {
        await opts.onRehash(stored, await hashPassword(password, params));
      }
      return ok;
    },
  };
}
