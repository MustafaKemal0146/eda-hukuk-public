// valkey-cache bağlantısı (002 §18; 021 §5.9–§5.11): yalnız `eda_mcp` kimliği, parola yalnız
// VALKEY_CACHE_PASSWORD_FILE'dan açılışta okunur. Çevrimdışı kuyruk kapalı ve istek başına yeniden
// deneme yok: bağlantı yoksa komut hemen hata verir, çağıran fail-closed davranır (limiter_unavailable).
// Bağlantı açılışta INFO / CLIENT SETINFO göndermez (ACL komut kümesi dar kalsın; infra/valkey).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Redis } from 'ioredis';

export type ValkeyCacheEnv = {
  readonly VALKEY_CACHE_URL: string;
  readonly VALKEY_CACHE_USERNAME: string;
  readonly VALKEY_CACHE_PASSWORD_FILE: string;
};

/** Script çalıştırmak ve önbellek / kilit / yapılandırma okumak için gereken en dar istemci yüzeyi. */
export type ValkeyClient = Pick<Redis, 'evalsha' | 'eval' | 'get' | 'set' | 'ping'>;

export function createValkeyCache(env: ValkeyCacheEnv, timeoutMs: number): Redis {
  const password = readFileSync(env.VALKEY_CACHE_PASSWORD_FILE, 'utf8').trim();
  return new Redis(env.VALKEY_CACHE_URL, {
    username: env.VALKEY_CACHE_USERNAME,
    password,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    disableClientInfo: true,
    maxRetriesPerRequest: 0,
    // valkey-cache bağlantı / komut süresi için 002'de anahtar yok; portal bağlantı sınırı
    // (sources.timeoutConnectMs) kullanılır.
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
  });
}

export type LuaScript = { readonly sha: string; readonly source: string };

/** `src/resilience/<ad>.lua` (paketlenmiş çıktıda `dist/<ad>.lua`; tsdown `copy`). */
export function loadLua(name: string): LuaScript {
  const source = readFileSync(new URL(`./${name}.lua`, import.meta.url), 'utf8');
  return { sha: createHash('sha1').update(source).digest('hex'), source };
}

/** EVALSHA; sunucu scripti tanımıyorsa (NOSCRIPT, ör. yeniden başlatma) EVAL ile yükler. */
export async function runLua(
  client: ValkeyClient,
  script: LuaScript,
  keys: readonly string[],
  args: readonly (string | number)[],
): Promise<unknown> {
  try {
    return await client.evalsha(script.sha, keys.length, ...keys, ...args);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('NOSCRIPT')) {
      return client.eval(script.source, keys.length, ...keys, ...args);
    }
    throw err;
  }
}
