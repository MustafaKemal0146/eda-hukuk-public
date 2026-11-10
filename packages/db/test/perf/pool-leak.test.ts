// @tk TK-02
// KK-P03c-3 (KK-031-6; RLS-25 genişletilmiş): aynı havuz (PG_POOL_MAX=2) ile iki büro arasında rastgele
// geçiş yapan 1000 ardışık istekte hiçbir istek diğer büronun satırını görmez ve her işlem sonrası
// bağlantıda `current_setting('app.org_id', true)` boştur.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { makePool, ownerDb } from '../fixtures/db.ts';
import { createTenantWorld, insertCase, type TenantWorld } from '../fixtures/tenant-world.ts';

const REQUESTS = 1000;
const POOL_MAX = 2;

let owner: pg.Client;
let ownerPool: pg.Pool;
let appPool: pg.Pool;
let asApp: TenantRunner;
let w: TenantWorld;

beforeAll(async () => {
  owner = await ownerDb();
  ownerPool = makePool('eda_owner');
  appPool = makePool('eda_app', POOL_MAX);
  asApp = createTenantRunner(appPool);
  const asOwner = createTenantRunner(ownerPool);
  w = await createTenantWorld(owner, asOwner);
  // Her büroda birkaç dava daha (görünürlük sayımı anlamlı olsun).
  for (let i = 0; i < 3; i++) {
    await insertCase(asOwner, w.orgA, w.aLawyer1);
    await insertCase(asOwner, w.orgB, w.bOwner);
  }
});
afterAll(async () => {
  await owner.end();
  await ownerPool.end();
  await appPool.end();
});

describe('KK-P03c-3 (KK-031-6): havuz sızıntısı yük testi', () => {
  it(`PG_POOL_MAX=${POOL_MAX}, ${REQUESTS} ardışık istek: çapraz büro satırı yok, bağ her işlem sonrası boş`, async () => {
    const ctx = {
      A: { orgId: w.orgA, userId: w.aLawyer1 },
      B: { orgId: w.orgB, userId: w.bOwner },
    } as const;
    let leaks = 0;
    let residual = 0;
    let seenA = 0;
    let seenB = 0;
    const pids = new Set<number>();
    for (let i = 0; i < REQUESTS; i++) {
      const which = Math.random() < 0.5 ? 'A' : 'B';
      const c = ctx[which];
      const rows = await asApp.withTenant(c, async (tx) => {
        const r = await tx.query<{ org_id: string }>(
          'SELECT org_id FROM app.cases WHERE org_id = ANY ($1::uuid[])',
          [[w.orgA, w.orgB]],
        );
        return r.rows;
      });
      leaks += rows.filter((r) => r.org_id !== c.orgId).length;
      if (which === 'A') seenA += 1;
      else seenB += 1;
      expect(rows.length).toBeGreaterThan(0);
      const client = await appPool.connect();
      try {
        const r = await client.query<{ pid: number; org: string | null; usr: string | null }>(
          `SELECT pg_backend_pid() AS pid, current_setting('app.org_id', true) AS org,
                  current_setting('app.user_id', true) AS usr`,
        );
        const row = r.rows[0];
        pids.add(row?.pid ?? -1);
        if ((row?.org ?? '') !== '' || (row?.usr ?? '') !== '') residual += 1;
      } finally {
        client.release();
      }
    }
    expect({ leaks, residual }).toEqual({ leaks: 0, residual: 0 });
    expect(seenA + seenB).toBe(REQUESTS);
    expect(seenA).toBeGreaterThan(0);
    expect(seenB).toBeGreaterThan(0);
    // Aynı fiziksel bağlantılar yeniden kullanıldı (en çok PG_POOL_MAX).
    expect(pids.size).toBeLessThanOrEqual(POOL_MAX);
  });
});
