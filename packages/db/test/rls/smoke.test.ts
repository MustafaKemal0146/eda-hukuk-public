// @tk TK-01
// RLS duman testleri (031 §12; tam RLS-01…RLS-33 matrisi P03c'dedir): iki büro ve kullanıcılar
// eda_owner havuzlu createTenantRunner ile kurulur; sorgular eda_app ile koşar.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RLS_MANIFEST, RLS_TABLES } from '../../src/rls/manifest.ts';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { appDb, jobsDb, makePool, ownerDb, pgCode } from '../fixtures/db.ts';
import {
  createTenantWorld,
  insertConversation,
  insertFile,
  type TenantWorld,
} from '../fixtures/tenant-world.ts';

let owner: pg.Client;
let ownerPool: pg.Pool;
let appPool: pg.Pool;
let asOwner: TenantRunner;
let asApp: TenantRunner;
let w: TenantWorld;

beforeAll(async () => {
  owner = await ownerDb();
  ownerPool = makePool('eda_owner');
  appPool = makePool('eda_app');
  asOwner = createTenantRunner(ownerPool);
  asApp = createTenantRunner(appPool);
  w = await createTenantWorld(owner, asOwner);
  // Görünür olabilecek veri: sohbet, mesaj, evrak, belge, denetim kaydı (iki büroda).
  for (const [org, user, caseId] of [
    [w.orgA, w.aLawyer1, w.caseA],
    [w.orgB, w.bOwner, w.caseB],
  ] as const) {
    const conv = await insertConversation(asOwner, org, user, caseId);
    await insertFile(asOwner, org, user, caseId);
    await asApp.withTenant({ orgId: org, userId: user }, async (tx) => {
      await tx.query(
        `INSERT INTO app.messages (org_id, conversation_id, role, user_id) VALUES ($1, $2, 'user', $3)`,
        [org, conv, user],
      );
      await tx.query(
        `INSERT INTO app.documents (org_id, owner_id, case_id, kind, title, title_fold, draft)
         VALUES ($1, $2, $3, 'petition', 'Örnek veri', 'ornek veri', '{}'::jsonb)`,
        [org, user, caseId],
      );
      await tx.query(
        `SELECT app.audit_append('org.settings.changed', 'org', 'org_settings', $1, '{}'::jsonb, NULL)`,
        [org],
      );
    });
  }
});
afterAll(async () => {
  await owner.end();
  await ownerPool.end();
  await appPool.end();
});

const codeOf = (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (e: unknown) => pgCode(e).code,
  );

describe('KK-P03b-23 (RLS-01, RLS-02, RLS-04, RLS-05, RLS-26 duman)', () => {
  it('RLS-01: kiracı bağı yokken her E tablo eda_app ile 0 satır (SELECT yetkisi olmayanlar 42501)', async () => {
    const jobs = await jobsDb();
    try {
      // Veri vardır: BYPASSRLS eda_jobs iki büronun davalarını görür.
      const seen = await jobs.query('SELECT id FROM app.cases WHERE id = ANY ($1::uuid[])', [
        [w.caseA, w.caseB],
      ]);
      expect(seen.rowCount).toBe(2);
    } finally {
      await jobs.end();
    }
    const app = await appDb();
    try {
      for (const t of RLS_TABLES) {
        const canSelect = Object.entries(RLS_MANIFEST[t]?.grants ?? {}).some(
          ([role, g]) =>
            role === 'eda_app' &&
            ((g.table ?? []).includes('SELECT') || (g.select ?? []).length > 0),
        );
        if (!canSelect) {
          expect(await codeOf(app.query(`SELECT 1 FROM app.${t} LIMIT 1`)), t).toBe('42501');
          continue;
        }
        const res = await app.query<{ n: string }>(`SELECT count(*) AS n FROM app.${t}`);
        expect(Number(res.rows[0]?.n), t).toBe(0);
      }
    } finally {
      await app.end();
    }
    const viaNoTenant = await asApp.withNoTenant('health', async (tx) => {
      const r = await tx.query<{ n: string }>(
        'SELECT (SELECT count(*) FROM app.cases) + (SELECT count(*) FROM app.conversations) AS n',
      );
      return Number(r.rows[0]?.n);
    });
    expect(viaNoTenant).toBe(0);
  });

  it('RLS-02: A bağlamında B bürosunun dava kimliği 0 satır; kendi davası 1 satır', async () => {
    const [other, own] = await asApp.withTenant(
      { orgId: w.orgA, userId: w.aLawyer1 },
      async (tx) => [
        (await tx.query('SELECT id FROM app.cases WHERE id = $1', [w.caseB])).rowCount,
        (await tx.query('SELECT id FROM app.cases WHERE id = $1', [w.caseA])).rowCount,
      ],
    );
    expect([other, own]).toEqual([0, 1]);
  });

  it('RLS-04: A bağlamında org_id = B ile cases INSERT 42501', async () => {
    const ins = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
      tx.query(
        `INSERT INTO app.cases (org_id, owner_id, title, title_fold, created_by) VALUES ($1, $2, 'x', 'x', $2)`,
        [w.orgB, w.aLawyer1],
      ),
    );
    expect(await codeOf(ins)).toBe('42501');
  });

  it("RLS-05: A davasının org_id'sini B yapma girişimi hata (forbid_key_change + kapı)", async () => {
    const upd = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
      tx.query('UPDATE app.cases SET org_id = $1 WHERE id = $2', [w.orgB, w.caseA]),
    );
    await expect(upd).rejects.toThrow(/anahtar kolon değiştirilemez: cases.org_id/);
    const still = await asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
      tx.query<{ org_id: string }>('SELECT org_id FROM app.cases WHERE id = $1', [w.caseA]),
    );
    expect(still.rows[0]?.org_id).toBe(w.orgA);
  });

  it('RLS-26: eda_app audit_log bölümünü doğrudan okuyamaz (42501); ana tablo üzerinden yalnız OA', async () => {
    const part = await owner.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
       WHERE i.inhparent = 'app.audit_log'::regclass ORDER BY 1 LIMIT 1`,
    );
    const name = part.rows[0]?.name ?? '';
    expect(name).toMatch(/^audit_log_p\d{4}_\d{2}$/);
    const direct = asApp.withTenant({ orgId: w.orgA, userId: w.aOwner }, (tx) =>
      tx.query(`SELECT count(*) FROM app.${name}`),
    );
    expect(await codeOf(direct)).toBe('42501');
    const [lawyer, admin] = await Promise.all([
      asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
        tx.query('SELECT org_id FROM app.audit_log'),
      ),
      asApp.withTenant({ orgId: w.orgA, userId: w.aAdmin }, (tx) =>
        tx.query<{ org_id: string }>('SELECT org_id FROM app.audit_log'),
      ),
    ]);
    expect(lawyer.rowCount).toBe(0);
    expect(admin.rows.length).toBeGreaterThan(0);
    expect(new Set(admin.rows.map((r) => r.org_id))).toEqual(new Set([w.orgA]));
  });
});
