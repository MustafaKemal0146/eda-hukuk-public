// @tk TK-01
// KK-P03c-1 (KK-031-3): RLS-01…RLS-07 — bağ, sahte büro, çapraz büro yazma, anahtar değiştirme,
// çıkarılmış ve askıdaki üye (031 §12). Dünya rls-world.ts; sorgular eda_app ile koşar.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { appDb, makePool, ownerDb } from '../fixtures/db.ts';
import {
  appUnselectableTables,
  codeOf,
  forgedAppClient,
  visibleCounts,
} from '../fixtures/rls-helpers.ts';
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

const errCode = (err: unknown): string | undefined => (err as { code?: string }).code;

/** Sahte bağlı ham istemciyle her E tablonun sayımı: hepsi 0 (yetkisiz tablolar -1). */
async function forgedCounts(orgId: string | null, userId: string): Promise<Record<string, number>> {
  const c = await forgedAppClient(orgId, userId);
  try {
    return await visibleCounts(c, userId);
  } finally {
    await c.end();
  }
}

function expectAllZero(counts: Record<string, number>): void {
  const unselectable = new Set(appUnselectableTables());
  for (const [t, n] of Object.entries(counts)) {
    expect(n, t).toBe(unselectable.has(t) ? -1 : 0);
  }
}

describe('KK-P03c-1: RLS-01…RLS-07 bağ ve üyelik', () => {
  it('RLS-01: eda_app, bağ yok — her E tablodan count(*) 0 (SELECT yetkisi yoksa 42501)', async () => {
    const app = await appDb();
    try {
      expectAllZero(await visibleCounts(app));
      for (const t of appUnselectableTables()) {
        expect(await codeOf(app.query(`SELECT 1 FROM app.${t} LIMIT 1`)), t).toBe('42501');
      }
    } finally {
      await app.end();
    }
  });

  it('RLS-02: a_lawyer1 @A — case_B kimliğiyle SELECT 0 satır', async () => {
    const n = await asApp.withTenant({ orgId: w.orgA, userId: w.users.a_lawyer1 }, async (tx) => {
      const r = await tx.query('SELECT id FROM app.cases WHERE id = $1', [w.case_B]);
      return r.rowCount;
    });
    expect(n).toBe(0);
  });

  it('RLS-03: a_lawyer1 @B (sahte orgId) — withTenant ORG_NOT_MEMBER; ham sorguda her E tablo 0', async () => {
    let called = false;
    const err = await asApp
      .withTenant({ orgId: w.orgB, userId: w.users.a_lawyer1 }, async () => {
        called = true;
      })
      .catch((e: unknown) => e);
    expect(errCode(err)).toBe('ORG_NOT_MEMBER');
    expect(called).toBe(false);
    expectAllZero(await forgedCounts(w.orgB, w.users.a_lawyer1));
  });

  it('RLS-04: a_lawyer1 @A — org_id = B ile cases INSERT 42501', async () => {
    const ins = asApp.withTenant({ orgId: w.orgA, userId: w.users.a_lawyer1 }, (tx) =>
      tx.query(
        `INSERT INTO app.cases (org_id, owner_id, title, title_fold, created_by)
         VALUES ($1, $2, 'Örnek veri', 'ornek veri', $2)`,
        [w.orgB, w.users.a_lawyer1],
      ),
    );
    expect(await codeOf(ins)).toBe('42501');
  });

  it("RLS-05: a_lawyer1 @A — case_A_org org_id'sini B yapma hata (kapı + forbid_key_change)", async () => {
    const upd = asApp.withTenant({ orgId: w.orgA, userId: w.users.a_lawyer1 }, (tx) =>
      tx.query('UPDATE app.cases SET org_id = $1 WHERE id = $2', [w.orgB, w.case_A_org]),
    );
    expect(await codeOf(upd)).toBe('42501');
    const still = await asApp.withTenant({ orgId: w.orgA, userId: w.users.a_lawyer1 }, (tx) =>
      tx.query<{ org_id: string }>('SELECT org_id FROM app.cases WHERE id = $1', [w.case_A_org]),
    );
    expect(still.rows[0]?.org_id).toBe(w.orgA);
  });

  it('RLS-06: a_removed @A — her E tablo SELECT 0; withTenant ORG_NOT_MEMBER', async () => {
    const err = await asApp
      .withTenant({ orgId: w.orgA, userId: w.users.a_removed }, async () => undefined)
      .catch((e: unknown) => e);
    expect(errCode(err)).toBe('ORG_NOT_MEMBER');
    expectAllZero(await forgedCounts(w.orgA, w.users.a_removed));
  });

  it('RLS-07: a_suspended @A — her E tablo SELECT 0', async () => {
    expectAllZero(await forgedCounts(w.orgA, w.users.a_suspended));
    const err = await asApp
      .withTenant({ orgId: w.orgA, userId: w.users.a_suspended }, async () => undefined)
      .catch((e: unknown) => e);
    expect(errCode(err)).toBe('ORG_NOT_MEMBER');
  });

  it('RLS-03/06/07 kontrol: aynı ham yolla etkin üye kendi sohbetini görür (sahte bağ testi geçerlidir)', async () => {
    const c = await forgedAppClient(w.orgA, w.users.a_lawyer1);
    try {
      const r = await c.query('SELECT id FROM app.conversations WHERE id = $1', [
        w.conv_l1_private,
      ]);
      expect(r.rowCount).toBe(1);
    } finally {
      await c.end();
    }
  });
});
