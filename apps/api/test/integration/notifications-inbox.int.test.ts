// @tk TK-04 TK-05
// P28 D2c bildirim kutusu (gerçek PostgreSQL; `eda_app`, RLS açık).
//  KK-P28-15 liste+imleç+sayaç   KK-P28-16 okundu idempotent   KK-P28-17 tümünü okundu
//  KK-P28-18 kullanıcı ve büro izolasyonu   KK-P28-19 bozuk imleç reddedilir
import { randomUUID } from 'node:crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createNotificationInboxService } from '../../src/services/notifications/inbox.ts';

let db: TestingDb;
let svc: ReturnType<typeof createNotificationInboxService>;
const w = {} as { orgA: string; orgB: string; a1: string; a2: string; b1: string };

async function seed(org: string, user: string, count: number) {
  for (let i = 0; i < count; i++) {
    await db.runner('eda_worker').withTenant({ orgId: org, userId: user }, async (tx) => {
      await tx.query(
        `INSERT INTO app.notifications (org_id, user_id, type, payload, created_at)
         VALUES ($1, $2, 'reminder', '{}'::jsonb, now() - ($3 || ' minutes')::interval)`,
        [org, user, String(i)],
      );
    });
  }
}

beforeAll(async () => {
  db = createTestingDb(inject('pg'));
  w.orgA = await db.auth.insertOrg('Örnek Büro A', 'firm');
  w.orgB = await db.auth.insertOrg('Örnek Büro B', 'firm');
  await db.auth.grantSeats(w.orgA, 5);
  await db.auth.grantSeats(w.orgB, 5);
  const mk = async (org: string, tag: string) => {
    const id = await db.auth.insertUser({
      name: `Örnek ${tag}`,
      email: `${tag}.${randomUUID().slice(0, 8)}@ornek.test`,
      emailVerified: true,
      verificationStatus: 'verified',
    });
    await db.auth.addMember(org, id, 'lawyer');
    return id;
  };
  w.a1 = await mk(w.orgA, 'n1');
  w.a2 = await mk(w.orgA, 'n2');
  w.b1 = await mk(w.orgB, 'n3');
  await seed(w.orgA, w.a1, 5);
  await seed(w.orgA, w.a2, 2);
  await seed(w.orgB, w.b1, 3);
  svc = createNotificationInboxService({ db: db.runner('eda_app') });
});

afterAll(async () => {
  await db.close();
});

const A1 = () => ({ orgId: w.orgA, userId: w.a1 });

describe('KK-P28-15: liste, imleç ve sayaç', () => {
  it('sayfalar ve sayaç tüm okunmamışları verir', async () => {
    const p1 = await svc.list(A1(), { limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.unreadCount).toBe(5);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await svc.list(A1(), { limit: 2, cursor: p1.nextCursor as string });
    const p3 = await svc.list(A1(), { limit: 2, cursor: p2.nextCursor as string });
    const ids = [...p1.items, ...p2.items, ...p3.items].map((x) => x.id);
    expect(new Set(ids).size).toBe(5);
    expect(p3.nextCursor).toBeNull();
    const times = [...p1.items, ...p2.items, ...p3.items].map((x) => x.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });
});

describe('KK-P28-16/17: okundu', () => {
  it('okundu idempotenttir ve sayaç düşer; sonra tümü okundu', async () => {
    const first = (await svc.list(A1(), {})).items[0];
    await svc.read(A1(), first?.id as string);
    await svc.read(A1(), first?.id as string);
    expect((await svc.list(A1(), {})).unreadCount).toBe(4);
    expect((await svc.list(A1(), { unread: true })).items).toHaveLength(4);
    expect((await svc.readAll(A1())).updated).toBe(4);
    expect((await svc.list(A1(), {})).unreadCount).toBe(0);
  });
});

describe('KK-P28-18/19: izolasyon ve imleç', () => {
  it('başka kullanıcı ve başka büro görünmez; başkasının bildirimi 404', async () => {
    const other = await svc.list({ orgId: w.orgA, userId: w.a2 }, {});
    expect(other.items).toHaveLength(2);
    const b = await svc.list({ orgId: w.orgB, userId: w.b1 }, {});
    expect(b.items).toHaveLength(3);
    await expect(svc.read(A1(), b.items[0]?.id as string)).rejects.toMatchObject({
      code: 'VALIDATION_ROUTE_NOT_FOUND',
    });
  });
  it('bozuk imleç reddedilir', async () => {
    await expect(svc.list(A1(), { cursor: 'bozuk' })).rejects.toMatchObject({
      code: 'VALIDATION_CURSOR_INVALID',
    });
  });
});
