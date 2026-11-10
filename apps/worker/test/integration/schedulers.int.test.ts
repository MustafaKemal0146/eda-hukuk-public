// @tk TK-23
// KK-P03c-17 (gerçek Valkey; `pnpm --filter @eda/worker test:int`): `maxmemory-policy` noeviction
// güvencesi geçer; zamanlayıcı iki eşitlemeden sonra bir kez kayıtlıdır; kayıt defterinde olmayan
// zamanlayıcı silinir. Bağlantı: VALKEY_URL, VALKEY_USERNAME, VALKEY_PASSWORD_FILE (jobs kimliği).
// Anahtarlar `eda:bull` altında rastgele alt önekte tutulur ve test sonunda silinir.
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { BACKUP_STATUS_KEY } from '@eda/contracts/jobs/maintenance';
import { BULLMQ_PREFIX, jobDefaults, SCHEDULER_TZ } from '@eda/contracts/queues';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { syncSchedulers } from '../../src/schedulers/index.ts';
import { assertNoEviction, createValkey } from '../../src/valkey.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    valkey: { url: string; username: string; passwordFile: string };
  }
}

function target(): { VALKEY_URL: string; VALKEY_USERNAME: string; VALKEY_PASSWORD_FILE: string } {
  const v = inject('valkey');
  for (const [name, value] of [
    ['VALKEY_URL', v.url],
    ['VALKEY_USERNAME', v.username],
    ['VALKEY_PASSWORD_FILE', v.passwordFile],
  ] as const) {
    if (value === '') throw new Error(`entegrasyon testi için ${name} gerekli`);
  }
  return { VALKEY_URL: v.url, VALKEY_USERNAME: v.username, VALKEY_PASSWORD_FILE: v.passwordFile };
}

const QUEUE = 'maintenance';
/** 043 §9: P03c audit.seal + backup.verify + P04a email_outbox.sweep (sıralı). */
const MAINTENANCE_IDS = [
  'maintenance.audit_seal',
  'maintenance.backup_verify',
  'maintenance.email_outbox_sweep',
];
const prefix = `${BULLMQ_PREFIX}:it-${randomUUID().slice(0, 8)}`;
let redis: Redis;
let queue: Queue;

beforeAll(async () => {
  redis = createValkey(target(), 'eda-jobs-it');
  await redis.connect();
  queue = new Queue(QUEUE, { connection: redis, prefix });
});

afterAll(async () => {
  if (queue !== undefined) {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  }
  await redis?.quit();
});

describe('KK-P03c-17: gerçek Valkey ile jobs açılış güvenceleri', () => {
  it('maxmemory-policy noeviction (INFO memory)', async () => {
    await expect(assertNoEviction(redis)).resolves.toBeUndefined();
  });

  it('iki eşitleme sonrası audit.seal zamanlayıcısı bir kez kayıtlı', async () => {
    await syncSchedulers(queue, QUEUE);
    await syncSchedulers(queue, QUEUE);
    const list = await queue.getJobSchedulers(0, -1);
    expect(list.map((s) => s.key).sort()).toEqual(MAINTENANCE_IDS);
    const s = list.find((x) => x.key === 'maintenance.audit_seal');
    expect(s).toMatchObject({ name: 'audit.seal', pattern: '* * * * *', tz: SCHEDULER_TZ });
    expect(s?.template?.data).toEqual({ v: 1 });
    expect(s?.template?.opts).toMatchObject({
      priority: jobDefaults('audit.seal').priority,
      attempts: jobDefaults('audit.seal').attempts,
    });
    expect(await queue.getJobSchedulersCount()).toBe(MAINTENANCE_IDS.length);
  });

  it('kayıt defterinde olmayan zamanlayıcı silinir', async () => {
    await queue.upsertJobScheduler(
      'maintenance.eski_is',
      { pattern: '0 3 * * *', tz: SCHEDULER_TZ },
      { name: 'audit.seal', data: { v: 1 }, opts: jobDefaults('audit.seal') },
    );
    expect(await queue.getJobSchedulersCount()).toBe(MAINTENANCE_IDS.length + 1);
    const r = await syncSchedulers(queue, QUEUE);
    expect(r.removed).toEqual(['maintenance.eski_is']);
    const keys = (await queue.getJobSchedulers(0, -1)).map((s) => s.key).sort();
    expect(keys).toEqual(MAINTENANCE_IDS);
  });
});

describe('KK-043-17: eda:ops:backup-status Valkey ACL (002 §18)', () => {
  // Kimlikler açıkça kurulur (çalıştırıcının verdiği kullanıcıdan bağımsız); parola dosyaları aynı dizindedir.
  const as = (user: 'eda_jobs' | 'eda_api', file: string): Redis => {
    const t = target();
    return createValkey(
      {
        VALKEY_URL: t.VALKEY_URL,
        VALKEY_USERNAME: user,
        VALKEY_PASSWORD_FILE: join(dirname(t.VALKEY_PASSWORD_FILE), file),
      },
      `${user}-it`,
    );
  };

  it('eda_jobs yazar/siler; eda_api yalnız okur, yazamaz', async () => {
    const jobs = as('eda_jobs', 'valkey_jobs_password');
    const api = as('eda_api', 'valkey_api_password');
    await jobs.connect();
    await api.connect();
    const before = await jobs.get(BACKUP_STATUS_KEY);
    const value = JSON.stringify({ v: 1, test: randomUUID() });
    try {
      await jobs.set(BACKUP_STATUS_KEY, value);
      expect(await api.get(BACKUP_STATUS_KEY)).toBe(value);
      await expect(api.set(BACKUP_STATUS_KEY, '{}')).rejects.toThrow(/NOPERM/);
      await expect(api.del(BACKUP_STATUS_KEY)).rejects.toThrow(/NOPERM/);
      await expect(jobs.set('eda:rl:it-yetkisiz', '1')).rejects.toThrow(/NOPERM/);
    } finally {
      if (before === null) await jobs.del(BACKUP_STATUS_KEY);
      else await jobs.set(BACKUP_STATUS_KEY, before);
      await jobs.quit();
      await api.quit();
    }
  });
});
