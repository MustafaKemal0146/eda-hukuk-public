// @tk TK-01
// KK-P03c-2 (031 §3 telafisi): auth okumaları yalnız auth-read.ts fonksiyonlarıyla ve büro/kullanıcı
// bağı koşuluyla; başka büro veya kullanıcı kimliği verilse de bağ dışı satır dönmez. withAdmin salt-okur
// işlemdir (`@eda/db/admin`).
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminDb } from '../../src/admin.ts';
import {
  findActiveMembership,
  getOrganizationSummary,
  listMembershipsOfUser,
} from '../../src/auth-read.ts';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { makePool, ownerDb, pgCode } from '../fixtures/db.ts';
import { createRlsWorld, type RlsWorld } from '../fixtures/rls-world.ts';

let owner: pg.Client;
let ownerPool: pg.Pool;
let appPool: pg.Pool;
let asApp: TenantRunner;
let w: RlsWorld;

beforeAll(async () => {
  owner = await ownerDb();
  ownerPool = makePool('eda_owner');
  appPool = makePool('eda_app');
  asApp = createTenantRunner(appPool);
  w = await createRlsWorld(owner, createTenantRunner(ownerPool));
});
afterAll(async () => {
  await owner.end();
  await ownerPool.end();
  await appPool.end();
});

describe('KK-P03c-2: auth-read.ts bağ koşullu auth okumaları', () => {
  it('findActiveMembership ve getOrganizationSummary yalnız mevcut büroda sonuç verir', async () => {
    const u = w.users;
    const out = await asApp.withTenant({ orgId: w.orgA, userId: u.a_lawyer1 }, async (tx) => ({
      self: await findActiveMembership(tx, u.a_lawyer1, w.orgA),
      colleague: await findActiveMembership(tx, u.a_senior, w.orgA),
      otherOrg: await findActiveMembership(tx, u.b_owner, w.orgB),
      suspended: await findActiveMembership(tx, u.a_suspended, w.orgA),
      orgA: await getOrganizationSummary(tx, w.orgA),
      orgB: await getOrganizationSummary(tx, w.orgB),
    }));
    expect(out.self).toEqual({ organizationId: w.orgA, userId: u.a_lawyer1, role: 'lawyer' });
    expect(out.colleague?.role).toBe('senior_lawyer');
    expect(out.otherOrg).toBeNull();
    expect(out.suspended).toBeNull();
    expect(out.orgA).toMatchObject({ id: w.orgA, name: 'Örnek Büro A', kind: 'firm' });
    expect(out.orgB).toBeNull();
  });

  it('listMembershipsOfUser yalnız oturumdaki kullanıcı için; başka kullanıcı boş', async () => {
    const u = w.users;
    const [own, other] = await asApp.withUserScope({ userId: u.a_lawyer1 }, async (tx) => [
      await listMembershipsOfUser(tx, u.a_lawyer1),
      await listMembershipsOfUser(tx, u.b_owner),
    ]);
    expect(own.map((m) => [m.organizationId, m.role, m.status])).toEqual([
      [w.orgA, 'lawyer', 'active'],
    ]);
    expect(other).toEqual([]);
  });

  it('withAdmin salt-okur: rollup okunur, yazma girişimi 25006', async () => {
    const admin = createAdminDb(makePool('eda_readonly_admin', 1));
    try {
      const n = await admin.withAdmin(async (tx) => {
        const r = await tx.query('SELECT count(*) FROM app.admin_rollup_usage_daily');
        return r.rowCount;
      });
      expect(n).toBe(1);
      const err = await admin
        .withAdmin((tx) => tx.query('CREATE TEMP TABLE t (x int)'))
        .catch((e: unknown) => e);
      expect(pgCode(err).code).toBe('25006');
    } finally {
      await admin.end();
    }
  });
});
