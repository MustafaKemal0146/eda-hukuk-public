// @tk TK-23
// KK-P03c-17 (KK-043-3 öncülü): zamanlayıcılar kayıt defterinden bir kez kaydedilir; kayıt defterinde
// olmayan zamanlayıcı silinir; `repeat:` seçeneği kullanılmaz.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jobDefaults } from '@eda/contracts/queues';
import { describe, expect, it } from 'vitest';
import { type SchedulerQueue, syncSchedulers } from '../src/schedulers/index.ts';

type Upsert = Parameters<SchedulerQueue['upsertJobScheduler']>;

/** 043 §9: P03c audit.seal + backup.verify + P04a email_outbox.sweep (kayıt defteri sırası). */
const MAINTENANCE_IDS = [
  'maintenance.audit_seal',
  'maintenance.backup_verify',
  'maintenance.email_outbox_sweep',
];

class FakeQueue implements SchedulerQueue {
  readonly store = new Map<string, Upsert>();
  readonly upserts: Upsert[] = [];
  readonly removed: string[] = [];

  upsertJobScheduler(...args: Upsert): Promise<unknown> {
    this.upserts.push(args);
    this.store.set(args[0], args);
    return Promise.resolve(undefined);
  }

  getJobSchedulers(): Promise<readonly { key: string }[]> {
    return Promise.resolve([...this.store.keys()].map((key) => ({ key })));
  }

  removeJobScheduler(id: string): Promise<boolean> {
    this.removed.push(id);
    return Promise.resolve(this.store.delete(id));
  }
}

describe('KK-P03c-17: zamanlayıcı eşitlemesi', () => {
  it('maintenance zamanlayıcısı kalıp, saat dilimi ve şablonla kaydedilir', async () => {
    const q = new FakeQueue();
    const r = await syncSchedulers(q, 'maintenance');
    expect(r).toEqual({ upserted: MAINTENANCE_IDS, removed: [] });
    expect(q.upserts).toEqual([
      [
        'maintenance.audit_seal',
        { pattern: '* * * * *', tz: 'Europe/Istanbul' },
        { name: 'audit.seal', data: { v: 1 }, opts: jobDefaults('audit.seal') },
      ],
      [
        'maintenance.backup_verify',
        { pattern: '50 3 * * *', tz: 'Europe/Istanbul' },
        { name: 'backup.verify', data: { v: 1 }, opts: jobDefaults('backup.verify') },
      ],
      [
        'maintenance.email_outbox_sweep',
        { pattern: '* * * * *', tz: 'Europe/Istanbul' },
        { name: 'email_outbox.sweep', data: { v: 1 }, opts: jobDefaults('email_outbox.sweep') },
      ],
    ]);
  });

  it('iki eşitleme sonrası her zamanlayıcı bir kez kalır (idempotent)', async () => {
    const q = new FakeQueue();
    await syncSchedulers(q, 'maintenance');
    await syncSchedulers(q, 'maintenance');
    expect([...q.store.keys()]).toEqual(MAINTENANCE_IDS);
  });

  it('kayıt defterinde olmayan zamanlayıcı silinir, kayıtlı olan korunur', async () => {
    const q = new FakeQueue();
    await q.upsertJobScheduler(
      'maintenance.eski_is',
      { pattern: '0 3 * * *', tz: 'Europe/Istanbul' },
      { name: 'audit.seal', data: { v: 1 }, opts: jobDefaults('audit.seal') },
    );
    const r = await syncSchedulers(q, 'maintenance');
    expect(r.removed).toEqual(['maintenance.eski_is']);
    expect([...q.store.keys()]).toEqual(MAINTENANCE_IDS);
  });

  it('zamanlayıcısı olmayan kuyrukta hiçbir kayıt yapılmaz, kalıntı silinir', async () => {
    const q = new FakeQueue();
    q.store.set('chat.kalinti', [
      'chat.kalinti',
      { pattern: '0 0 * * *', tz: 'Europe/Istanbul' },
      { name: 'audit.seal', data: { v: 1 }, opts: jobDefaults('audit.seal') },
    ]);
    const r = await syncSchedulers(q, 'chat');
    expect(r).toEqual({ upserted: [], removed: ['chat.kalinti'] });
  });

  it('kaynakta repeat seçeneği yoktur', () => {
    const dir = join(import.meta.dirname, '..', 'src');
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) =>
      f.endsWith('.ts'),
    );
    for (const f of files) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/\brepeat:/);
  });
});
