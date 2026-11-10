// `valkey` (kuyruk örneği) bağlantısı ve açılış güvencesi (002 §18; 011 §2.9; 043 §2.3). Parola yalnız
// `VALKEY_PASSWORD_FILE`'dan açılışta okunur, hiçbir yere yazılmaz. Worker bağlantısında
// `maxRetriesPerRequest: null` (BullMQ şartı). `maxmemory-policy` `INFO memory` ile okunur (ACL `+info`;
// `CONFIG GET` kullanılmaz); `noeviction` değilse süreç başlamaz (KK-P03c-17, KK-043-20).
import { readFileSync } from 'node:fs';
import { Redis } from 'ioredis';

export interface ValkeyEnv {
  readonly VALKEY_URL: string;
  readonly VALKEY_USERNAME: string;
  readonly VALKEY_PASSWORD_FILE: string;
}

/** Kuyruk bağlantısı (tembel; `connect()` çağıran bekler). */
export function createValkey(env: ValkeyEnv, connectionName: string): Redis {
  const password = readFileSync(env.VALKEY_PASSWORD_FILE, 'utf8').trim();
  return new Redis(env.VALKEY_URL, {
    username: env.VALKEY_USERNAME,
    password,
    connectionName,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
}

export const REQUIRED_EVICTION_POLICY = 'noeviction';

export class ValkeyPolicyError extends Error {
  override name = 'ValkeyPolicyError';
}

/** `INFO` çıktısını `alan -> değer` eşlemesine çevirir (bölüm başlıkları ve boş satırlar atlanır). */
export function parseInfo(text: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '' || raw.startsWith('#')) continue;
    const i = raw.indexOf(':');
    if (i > 0) out.set(raw.slice(0, i), raw.slice(i + 1).trim());
  }
  return out;
}

export interface InfoClient {
  info(section: 'memory'): Promise<string>;
}

/** `maxmemory_policy` `noeviction` değilse `ValkeyPolicyError`. */
export async function assertNoEviction(client: InfoClient): Promise<void> {
  const policy = parseInfo(await client.info('memory')).get('maxmemory_policy');
  if (policy !== REQUIRED_EVICTION_POLICY) {
    throw new ValkeyPolicyError(
      `valkey maxmemory-policy ${REQUIRED_EVICTION_POLICY} olmalı (bulunan: ${policy ?? 'yok'}); ` +
        'infra/valkey yapılandırması düzeltilmeli',
    );
  }
}
