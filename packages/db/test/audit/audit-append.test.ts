// @tk TK-26
// Denetim yazıcısı ve uygulama SECURITY DEFINER fonksiyonları (031 §8.1): app.audit_append büro ve
// aktörü yalnız oturum bağından alır; katalog dışı olay 23514. app.transfer_member_content içerik
// devrini yapar ve olayı yazar. app.member_role() askıdaki büro/çıkarılmış/askıdaki üye için NULL.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { jobsDb, makePool, ownerDb, pgCode } from '../fixtures/db.ts';
import { newWorldKey, shortKey } from '../fixtures/ids.ts';
import { grantSeats } from '../fixtures/seats.ts';
import {
  addMember,
  createTenantWorld,
  insertConversation,
  insertOrg,
  insertUser,
  type TenantWorld,
} from '../fixtures/tenant-world.ts';

let owner: pg.Client;
let jobs: pg.Client;
let ownerPool: pg.Pool;
let appPool: pg.Pool;
let asOwner: TenantRunner;
let asApp: TenantRunner;
let w: TenantWorld;

beforeAll(async () => {
  owner = await ownerDb();
  jobs = await jobsDb();
  ownerPool = makePool('eda_owner');
  appPool = makePool('eda_app');
  asOwner = createTenantRunner(ownerPool);
  asApp = createTenantRunner(appPool);
  w = await createTenantWorld(owner, asOwner);
});
afterAll(async () => {
  await owner.end();
  await jobs.end();
  await ownerPool.end();
  await appPool.end();
});

const codeOf = (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (e: unknown) => pgCode(e).code ?? (e as { code?: string }).code,
  );

interface AuditRow {
  org_id: string | null;
  actor_id: string | null;
  actor_type: string;
  action: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
}

/** eda_jobs (BYPASSRLS, kolon yetkili) ile denetim satırı okuma. */
async function auditRow(id: string): Promise<AuditRow | undefined> {
  const res = await jobs.query<AuditRow>(
    'SELECT org_id, actor_id, actor_type, action, target_id, metadata FROM app.audit_log WHERE id = $1',
    [id],
  );
  return res.rows[0];
}

describe('KK-P03b-18 (KK-031-12): app.audit_append', () => {
  it("'org' kapsamında org_id ve actor_id yalnız oturum bağından; hedef parametresi başka büroyu yazamaz", async () => {
    const id = await asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `SELECT app.audit_append('org.settings.changed', 'org', 'organization', $1, '{"field":"show_reasoning"}'::jsonb, '10.0.0.0') AS id`,
        [w.orgB],
      );
      return r.rows[0]?.id ?? '';
    });
    expect(await auditRow(id)).toEqual({
      org_id: w.orgA,
      actor_id: w.aLawyer1,
      actor_type: 'user',
      action: 'org.settings.changed',
      target_id: w.orgB,
      metadata: { field: 'show_reasoning' },
    });
  });

  it("'platform' kapsamında org_id NULL; aktör yoksa actor_type = 'system'", async () => {
    const id = await asApp.withNoTenant('pre_auth_audit', async (tx) => {
      const r = await tx.query<{ id: string }>(
        `SELECT app.audit_append('auth.login.failure', 'platform', NULL, NULL, '{}'::jsonb, NULL) AS id`,
      );
      return r.rows[0]?.id ?? '';
    });
    const row = await auditRow(id);
    expect([row?.org_id, row?.actor_id, row?.actor_type]).toEqual([null, null, 'system']);
  });

  it('katalog dışı olay 23514; bağsız org kapsamı 42501; 2048 bayt üstü meta veri reddedilir', async () => {
    const bad = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
      tx.query(`SELECT app.audit_append('org.uydurma_olay', 'org', NULL, NULL, '{}'::jsonb, NULL)`),
    );
    expect(await codeOf(bad)).toBe('23514');
    const unbound = asApp.withNoTenant('health', (tx) =>
      tx.query(`SELECT app.audit_append('org.created', 'org', NULL, NULL, '{}'::jsonb, NULL)`),
    );
    expect(await codeOf(unbound)).toBe('42501');
    const big = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
      tx.query(
        `SELECT app.audit_append('org.created', 'org', NULL, NULL, jsonb_build_object('x', repeat('a', 3000)), NULL)`,
      ),
    );
    expect(await codeOf(big)).toBe('22001');
  });

  it('eda_app audit_log üzerinde doğrudan INSERT 42501', async () => {
    const direct = asApp.withTenant({ orgId: w.orgA, userId: w.aOwner }, (tx) =>
      tx.query(
        `INSERT INTO app.audit_log (org_id, actor_type, action) VALUES ($1, 'user', 'org.created')`,
        [w.orgA],
      ),
    );
    expect(await codeOf(direct)).toBe('42501');
  });
});

describe('KK-P03b-19 (KK-031-13 işlev düzeyi): app.transfer_member_content', () => {
  it('devralan sohbetleri görür, kaynak 0 satır görür; org.conversations.transferred yazılır', async () => {
    await insertConversation(asOwner, w.orgA, w.aLawyer2);
    await insertConversation(asOwner, w.orgA, w.aLawyer2);
    const count = (userId: string) =>
      asApp.withTenant({ orgId: w.orgA, userId }, async (tx) => {
        const r = await tx.query(
          'SELECT id FROM app.conversations WHERE user_id = (SELECT app.current_user_id())',
        );
        return r.rowCount;
      });
    expect(await count(w.aLawyer2)).toBe(2);
    const denied = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
      tx.query('SELECT app.transfer_member_content($1, $2)', [w.aLawyer2, w.aLawyer1]),
    );
    expect(await codeOf(denied)).toBe('42501');
    const moved = await asApp.withTenant({ orgId: w.orgA, userId: w.aOwner }, async (tx) => {
      const r = await tx.query<{ n: number }>('SELECT app.transfer_member_content($1, $2) AS n', [
        w.aLawyer2,
        w.aAdmin,
      ]);
      return r.rows[0]?.n;
    });
    expect(moved).toBe(2);
    expect(await count(w.aLawyer2)).toBe(0);
    expect(await count(w.aAdmin)).toBe(2);
    const ev = await jobs.query<{
      actor_id: string;
      target_id: string;
      metadata: { count: number };
    }>(
      `SELECT actor_id, target_id, metadata FROM app.audit_log
       WHERE org_id = $1 AND action = 'org.conversations.transferred'`,
      [w.orgA],
    );
    expect(ev.rows).toEqual([
      { actor_id: w.aOwner, target_id: w.aLawyer2, metadata: { toUserId: w.aAdmin, count: 2 } },
    ]);
  });
});

describe('KK-P03b-18: app.member_role() askıdaki büro, çıkarılmış ve askıdaki üye için NULL', () => {
  it('üç durumda withTenant ORG_NOT_MEMBER döner', async () => {
    const key = shortKey(newWorldKey());
    const org = await insertOrg(owner, key, 'Askı Bürosu');
    await grantSeats(owner, org);
    const active = await insertUser(owner, key, 'aktif');
    const suspended = await insertUser(owner, key, 'askida');
    const removed = await insertUser(owner, key, 'cikarilmis');
    await addMember(owner, org, active, 'owner');
    await addMember(owner, org, suspended, 'lawyer', 'suspended');
    const probe = (userId: string) =>
      asApp.withTenant({ orgId: org, userId }, async (_tx, role) => role);
    expect(await probe(active)).toBe('owner');
    await expect(probe(suspended)).rejects.toMatchObject({ code: 'ORG_NOT_MEMBER' });
    await expect(probe(removed)).rejects.toMatchObject({ code: 'ORG_NOT_MEMBER' });
    await owner.query('UPDATE auth.organizations SET suspended_at = now() WHERE id = $1', [org]);
    await expect(probe(active)).rejects.toMatchObject({ code: 'ORG_NOT_MEMBER' });
  });
});
