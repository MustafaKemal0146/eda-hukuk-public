// @tk TK-04 TK-05
// P28 D1 bildirim tercihleri (gerçek PostgreSQL; `eda_app` çalıştırıcısı, RLS açık).
//  KK-P28-5 satır yoksa varsayılan   KK-P28-6 yazma ve geri okuma   KK-P28-7 kullanıcı izolasyonu
//  KK-P28-8 zorunlu kanal 422, kısmi yazım yok   KK-P28-9 son değer kazanır
import { randomUUID } from 'node:crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createNotificationPreferencesService } from '../../src/services/notifications/preferences.ts';

let db: TestingDb;
let svc: ReturnType<typeof createNotificationPreferencesService>;
const w = {} as { u1: string; u2: string };

const cell = (
  items: { kind: string; channel: string; enabled: boolean }[],
  kind: string,
  channel: string,
) => items.find((c) => c.kind === kind && c.channel === channel);

beforeAll(async () => {
  db = createTestingDb(inject('pg'));
  const org = await db.auth.insertOrg('Örnek Büro', 'firm');
  await db.auth.grantSeats(org, 5);
  const mk = async (tag: string) => {
    const id = await db.auth.insertUser({
      name: `Örnek ${tag}`,
      email: `${tag}.${randomUUID().slice(0, 8)}@ornek.test`,
      emailVerified: true,
      verificationStatus: 'verified',
    });
    await db.auth.addMember(org, id, 'lawyer');
    return id;
  };
  w.u1 = await mk('p1');
  w.u2 = await mk('p2');
  svc = createNotificationPreferencesService({ db: db.runner('eda_app') });
});

afterAll(async () => {
  await db.close();
});

describe('KK-P28-5/6: okuma ve yazma', () => {
  it('satır yokken varsayılan matris döner', async () => {
    const { items } = await svc.get({ userId: w.u1 });
    expect(cell(items, 'deadline_due', 'email')?.enabled).toBe(true);
    expect(cell(items, 'reminder', 'email')?.enabled).toBe(false);
    expect(cell(items, 'file_ready', 'push')).toBeUndefined();
  });

  it('geçersiz kılma yazılır ve yeniden okunur', async () => {
    const out = await svc.put(
      { userId: w.u1 },
      {
        overrides: [
          { kind: 'reminder', channel: 'email', enabled: true },
          { kind: 'deadline_due', channel: 'push', enabled: false },
        ],
      },
    );
    expect(cell(out.items, 'reminder', 'email')?.enabled).toBe(true);
    const again = await svc.get({ userId: w.u1 });
    expect(cell(again.items, 'reminder', 'email')?.enabled).toBe(true);
    expect(cell(again.items, 'deadline_due', 'push')?.enabled).toBe(false);
  });
});

describe('KK-P28-7: kullanıcı izolasyonu', () => {
  it('başka kullanıcının tercihi görünmez', async () => {
    const { items } = await svc.get({ userId: w.u2 });
    expect(cell(items, 'reminder', 'email')?.enabled).toBe(false);
    expect(cell(items, 'deadline_due', 'push')?.enabled).toBe(true);
  });
});

describe('KK-P28-8/9: doğrulama', () => {
  it('zorunlu kanalı kapatma 422; istekte başka giriş de yazılmaz', async () => {
    await expect(
      svc.put(
        { userId: w.u2 },
        {
          overrides: [
            { kind: 'file_ready', channel: 'email', enabled: true },
            { kind: 'reminder', channel: 'in_app', enabled: false },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const { items } = await svc.get({ userId: w.u2 });
    expect(cell(items, 'file_ready', 'email')?.enabled).toBe(false);
  });

  it('aynı anahtar tekrarında son değer kazanır', async () => {
    const out = await svc.put(
      { userId: w.u2 },
      {
        overrides: [
          { kind: 'export_ready', channel: 'email', enabled: true },
          { kind: 'export_ready', channel: 'email', enabled: false },
        ],
      },
    );
    expect(cell(out.items, 'export_ready', 'email')?.enabled).toBe(false);
  });
});
