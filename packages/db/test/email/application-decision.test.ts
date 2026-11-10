// @tk TK-26
// KK-P04a-6 (KK-042-6) DB kısmı: `app.admin_decide_application` onayda `verified` + deneme aboneliği +
// `trial_grant` + bildirim + e-posta outbox + platform denetim satırını tek işlemde üretir; retle
// neden kodu yazılır; aktör `super_admin` olmalıdır. `admin_resolve_actor` ve `admin_find_application`
// yalnız eda_readonly_admin'e açıktır.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AdminDb, createAdminDb } from '../../src/admin.ts';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { appDb, jobsDb, makePool, ownerDb, pgCode } from '../fixtures/db.ts';
import { newWorldKey } from '../fixtures/ids.ts';

let owner: pg.Client;
let jobs: pg.Client;
let workerPool: pg.Pool;
let asWorker: TenantRunner;
let ownerPool: pg.Pool;
let asOwner: TenantRunner;
let admin: AdminDb;
let key: string;
let staff: string;
let staffEmail: string;

async function applicant(name: string): Promise<{ userId: string; orgId: string; email: string }> {
  const email = `${name}.${key}@ornek.test`;
  const u = await owner.query<{ id: string }>(
    `INSERT INTO auth.users (name, email, email_verified) VALUES ($1, $2, true) RETURNING id`,
    [`Örnek ${name}`, email],
  );
  const userId = u.rows[0]?.id ?? '';
  const o = await owner.query<{ id: string }>(
    `INSERT INTO auth.organizations (name, slug, kind) VALUES ($1, $2, 'individual') RETURNING id`,
    [`Örnek ${name}`, `${name}-${key}`],
  );
  const orgId = o.rows[0]?.id ?? '';
  await owner.query(
    `INSERT INTO auth.members (organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
    [orgId, userId],
  );
  await asOwner.withUserScope({ userId }, (tx) =>
    tx.query(
      `INSERT INTO app.lawyer_profiles (user_id, baro, sicil_no) VALUES ($1, 'Ankara Barosu', $2)`,
      [userId, `${Math.floor(Math.random() * 1e9)}`],
    ),
  );
  return { userId, orgId, email };
}

const decide = (actor: string, userId: string, decision: string, reason: string | null) =>
  admin.withAdminWrite((tx) =>
    tx.query<{ id: string }>(
      'SELECT app.admin_decide_application($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) AS id',
      [
        actor,
        userId,
        decision,
        reason,
        7,
        30,
        '2026-10-11.1',
        '{}',
        new Date(Date.now() + 86_400_000),
      ],
    ),
  );

beforeAll(async () => {
  owner = await ownerDb();
  jobs = await jobsDb();
  workerPool = makePool('eda_worker');
  asWorker = createTenantRunner(workerPool);
  ownerPool = makePool('eda_owner');
  asOwner = createTenantRunner(ownerPool);
  admin = createAdminDb(makePool('eda_readonly_admin'));
  key = newWorldKey();
  staffEmail = `personel.${key}@ornek.test`;
  const s = await owner.query<{ id: string }>(
    `INSERT INTO auth.users (name, email, email_verified, platform_role, verification_status)
     VALUES ('Örnek Personel', $1, true, 'super_admin', 'verified') RETURNING id`,
    [staffEmail],
  );
  staff = s.rows[0]?.id ?? '';
});
afterAll(async () => {
  await owner.end();
  await jobs.end();
  await workerPool.end();
  await ownerPool.end();
  await admin.end();
});

describe('KK-P04a-6 (KK-042-6): admin_decide_application', () => {
  it('onay: verified, trial aboneliği, trial_grant, bildirim, e-posta ve denetim tek işlemde', async () => {
    const a = await applicant('onay');
    const r = await decide(staff, a.userId, 'approved', null);
    const delivery = r.rows[0]?.id;
    expect(delivery).toMatch(/^[0-9a-f-]{36}$/);
    const u = await owner.query('SELECT verification_status FROM auth.users WHERE id = $1', [
      a.userId,
    ]);
    expect(u.rows[0]?.verification_status).toBe('verified');
    const p = await asOwner.withUserScope({ userId: a.userId }, (tx) =>
      tx.query(
        'SELECT reviewed_by, reviewed_at, verification_source, rejection_reason FROM app.lawyer_profiles WHERE user_id = $1',
        [a.userId],
      ),
    );
    expect(p.rows[0]).toMatchObject({
      reviewed_by: staff,
      verification_source: 'admin_review',
      rejection_reason: null,
    });
    const tenant = { orgId: a.orgId, userId: a.userId };
    const sub = await asOwner.withTenant(tenant, (tx) =>
      tx.query(
        `SELECT plan_code, status, provider, seats, trial_ends_at - current_period_start AS len
         FROM app.subscriptions WHERE org_id = $1`,
        [a.orgId],
      ),
    );
    expect(sub.rows[0]).toMatchObject({
      plan_code: 'trial',
      status: 'trialing',
      provider: 'manual',
      seats: 1,
    });
    expect(sub.rows[0]?.len).toMatchObject({ days: 7 });
    const led = await asOwner.withTenant(tenant, (tx) =>
      tx.query(
        'SELECT entry_type, amount, balance_after FROM app.credit_ledger WHERE org_id = $1',
        [a.orgId],
      ),
    );
    expect(led.rows).toEqual([{ entry_type: 'trial_grant', amount: 30, balance_after: 30 }]);
    const n = await asOwner.withTenant(tenant, (tx) =>
      tx.query<{ type: string }>('SELECT type FROM app.notifications WHERE user_id = $1', [
        a.userId,
      ]),
    );
    expect(n.rows.map((x) => x.type)).toEqual(['verification_approved']);
    const d = await asWorker.withUserScope({ userId: a.userId }, (tx) =>
      tx.query(
        'SELECT template_code, class, status, org_id, dedupe_key FROM app.email_deliveries WHERE id = $1',
        [delivery],
      ),
    );
    expect(d.rows[0]).toMatchObject({
      template_code: 'verification_approved',
      class: 'service',
      status: 'queued',
      org_id: null,
    });
    expect(d.rows[0]?.dedupe_key).toMatch(new RegExp(`^decision:${a.userId}:approved:`));
    const au = await jobs.query(
      `SELECT org_id, actor_type, actor_id FROM app.audit_log WHERE action = 'admin.application.approved' AND target_id = $1`,
      [a.userId],
    );
    expect(au.rows).toEqual([{ org_id: null, actor_type: 'platform_staff', actor_id: staff }]);
    // İkinci karar reddedilir (durum değişti).
    const again = await decide(staff, a.userId, 'approved', null).catch((e: unknown) => e);
    expect(pgCode(again).code).toBe('55000');
  });

  it('ret: neden kodu yazılır, deneme açılmaz; geçersiz neden reddedilir', async () => {
    const a = await applicant('ret');
    const bad = await decide(staff, a.userId, 'rejected', 'serbest metin').catch((e: unknown) => e);
    expect(pgCode(bad).code).toBe('22023');
    await decide(staff, a.userId, 'rejected', 'identity_mismatch');
    const u = await owner.query('SELECT verification_status FROM auth.users WHERE id = $1', [
      a.userId,
    ]);
    expect(u.rows[0]?.verification_status).toBe('rejected');
    const p = await asOwner.withUserScope({ userId: a.userId }, (tx) =>
      tx.query('SELECT rejection_reason FROM app.lawyer_profiles WHERE user_id = $1', [a.userId]),
    );
    expect(p.rows[0]?.rejection_reason).toBe('identity_mismatch');
    const sub = await jobs.query(
      'SELECT count(*)::int AS n FROM app.subscriptions WHERE org_id = $1',
      [a.orgId],
    );
    expect(sub.rows[0]?.n).toBe(0);
  });

  it('aktör super_admin değilse 42501; aktör çözümü ve başvuru arama', async () => {
    const a = await applicant('aktor');
    const notStaff = await decide(a.userId, a.userId, 'approved', null).catch((e: unknown) => e);
    expect(pgCode(notStaff).code).toBe('42501');
    const resolved = await admin.withAdmin((tx) =>
      tx.query<{ id: string }>('SELECT app.admin_resolve_actor($1) AS id', [staffEmail]),
    );
    expect(resolved.rows[0]?.id).toBe(staff);
    const unknown = await admin
      .withAdmin((tx) =>
        tx.query('SELECT app.admin_resolve_actor($1)', [`yok.${randomUUID()}@ornek.test`]),
      )
      .catch((e: unknown) => e);
    expect(pgCode(unknown).code).toBe('P0002');
    const found = await admin.withAdmin((tx) =>
      tx.query('SELECT user_id, verification_status FROM app.admin_find_application($1, $2)', [
        staff,
        a.email,
      ]),
    );
    expect(found.rows).toEqual([
      { user_id: a.userId, verification_status: 'pending_verification' },
    ]);
  });

  it('admin fonksiyonları eda_app için kapalıdır', async () => {
    const c = await appDb();
    try {
      const e = await c.query('SELECT app.admin_resolve_actor(NULL)').catch((x: unknown) => x);
      expect(pgCode(e).code).toBe('42501');
    } finally {
      await c.end();
    }
  });
});
