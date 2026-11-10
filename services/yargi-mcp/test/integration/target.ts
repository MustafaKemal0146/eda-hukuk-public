// Entegrasyon testleri için valkey-cache bağlantısı (gerçek ACL; infra/valkey/entrypoint.sh). Hedef
// vitest.config.ts `provide` ile gelir; parolalar yalnız dosya yoludur, değer yazdırılmaz.
import { once } from 'node:events';
import type { Redis } from 'ioredis';
import { inject } from 'vitest';
import { createValkeyCache, type ValkeyClient } from '../../src/resilience/valkey.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    valkeyCache: { url: string; mcpPasswordFile: string; apiPasswordFile: string };
  }
}

export type CacheUser = 'eda_mcp' | 'eda_api';

export async function connect(user: CacheUser): Promise<Redis> {
  const t = inject('valkeyCache');
  const file = user === 'eda_mcp' ? t.mcpPasswordFile : t.apiPasswordFile;
  for (const [name, value] of [
    ['VALKEY_CACHE_URL', t.url],
    [
      user === 'eda_mcp' ? 'VALKEY_CACHE_MCP_PASSWORD_FILE' : 'VALKEY_CACHE_API_PASSWORD_FILE',
      file,
    ],
  ] as const) {
    if (value === '') throw new Error(`entegrasyon testi için ${name} gerekli`);
  }
  const client = createValkeyCache(
    { VALKEY_CACHE_URL: t.url, VALKEY_CACHE_USERNAME: user, VALKEY_CACHE_PASSWORD_FILE: file },
    5000,
  );
  client.on('error', () => undefined);
  if (client.status !== 'ready') await once(client, 'ready');
  return client;
}

const SOURCES = ['bedesten', 'anayasa', 'uyusmazlik', 'mevzuat'] as const;

/** Kova, sınıf sayacı ve kesici anahtarlarını siler (eda_mcp `+del`; testler sahte saat kullanır). */
export async function resetShared(client: Redis): Promise<void> {
  await client.del(
    ...SOURCES.map((s) => `eda:tb:source:${s}`),
    ...SOURCES.map((s) => `eda:brk:${s}`),
    'eda:lq:interactive',
    'eda:lq:verify',
    'eda:lq:ingest',
  );
}

/** Gönderilen tüm komut argümanlarını kaydeden istemci (Valkey'e yazılan her şey argümanlardan geçer). */
export function recording(client: Redis): { client: ValkeyClient; sent: string[] } {
  const sent: string[] = [];
  const wrap =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    (...a: A): Promise<R> => {
      sent.push(JSON.stringify(a));
      return fn(...a);
    };
  const rec = {
    evalsha: wrap(client.evalsha.bind(client)),
    eval: wrap(client.eval.bind(client)),
    get: wrap(client.get.bind(client)),
    set: wrap(client.set.bind(client)),
    ping: wrap(client.ping.bind(client)),
  } as unknown as ValkeyClient;
  return { client: rec, sent };
}
