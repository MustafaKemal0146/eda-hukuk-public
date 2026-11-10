// @tk TK-01
// @tk TK-02
// KK-P03c-1 (KK-031-3): RLS-18…RLS-27 — denetim kaydı, bayi ve platform rolleri, salt-okur admin,
// eda_jobs kolon yetkisi, eda_auth ve auth şeması sınırı, havuz sızıntısı, bölüm erişimi, şablonlar.
// KK-P03c-4 (KK-031-9) admin_* dönüş kolonları ve KK-P03c-5 (KK-031-10) rollup şema anlık görüntüsü.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTENT_COLUMNS } from '../../src/rls/manifest.ts';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { adminDb, appDb, authDb, jobsDb, makePool, ownerDb, pgCode } from '../fixtures/db.ts';
import { codeOf } from '../fixtures/rls-helpers.ts';
import { createRlsWorld, type RlsWorld } from '../fixtures/rls-world.ts';

let owner: pg.Client;
let jobs: pg.Client;
let ownerPool: pg.Pool;
let appPool: pg.Pool;
let asApp: TenantRunner;
let w: RlsWorld;

beforeAll(async () => {
  owner = await ownerDb();
  jobs = await jobsDb();
  ownerPool = makePool('eda_owner');
  appPool = makePool('eda_app');
  asApp = createTenantRunner(appPool);
  w = await createRlsWorld(owner, createTenantRunner(ownerPool));
  // Platform zinciri satırı (org_id NULL): kimlik öncesi denetim yolu.
  await asApp.withNoTenant('pre_auth_audit', (tx) =>
    tx.query(
      `SELECT app.audit_append('auth.login.failure', 'platform', 'user', NULL, '{}'::jsonb, NULL)`,
    ),
  );
});
afterAll(async () => {
  await owner.end();
  await jobs.end();
  await ownerPool.end();
  await appPool.end();
});

const errCode = (err: unknown): string | undefined => (err as { code?: string }).code;

/** Kimliği bir eksik uuid (o.id > imleç sayfalamasında hedefi ilk satır yapar). */
function uuidMinusOne(id: string): string {
  const n = BigInt(`0x${id.replaceAll('-', '')}`) - 1n;
  const h = n.toString(16).padStart(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const CONTENT = new Set<string>(CONTENT_COLUMNS);

describe('KK-P03c-1: RLS-18…RLS-27 roller, fonksiyonlar ve sınırlar', () => {
  it('RLS-18: audit_log — a_lawyer1 0 / a_admin yalnız A, platform yok; doğrudan INSERT 42501; audit_append org/aktörü bağdan alır', async () => {
    const u = w.users;
    const lawyer = await asApp.withTenant({ orgId: w.orgA, userId: u.a_lawyer1 }, (tx) =>
      tx.query('SELECT id FROM app.audit_log'),
    );
    expect(lawyer.rowCount).toBe(0);
    const admin = await asApp.withTenant({ orgId: w.orgA, userId: u.a_admin }, (tx) =>
      tx.query<{ org_id: string | null }>('SELECT org_id FROM app.audit_log'),
    );
    expect(admin.rows.length).toBeGreaterThan(0);
    expect(new Set(admin.rows.map((r) => r.org_id))).toEqual(new Set([w.orgA]));
    const direct = asApp.withTenant({ orgId: w.orgA, userId: u.a_admin }, (tx) =>
      tx.query(
        `INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type)
         VALUES ($1, 'user', $2, 'org.settings.changed', 'org_settings')`,
        [w.orgA, u.a_admin],
      ),
    );
    expect(await codeOf(direct)).toBe('42501');
    // Hedef kimliği B olsa da satırın büro ve aktörü oturum bağından gelir.
    const id = await asApp.withTenant({ orgId: w.orgA, userId: u.a_lawyer1 }, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `SELECT app.audit_append('org.settings.changed', 'org', 'org_settings', $1, '{}'::jsonb, NULL) AS id`,
        [w.orgB],
      );
      return r.rows[0]?.id ?? '';
    });
    const row = await jobs.query<{ org_id: string; actor_id: string }>(
      'SELECT org_id, actor_id FROM app.audit_log WHERE id = $1',
      [id],
    );
    expect(row.rows).toEqual([{ org_id: w.orgA, actor_id: u.a_lawyer1 }]);
  });

  it('RLS-19: p_partner — withTenant(A) ORG_NOT_MEMBER; eda_auth ile auth.members INSERT tetikleyici hatası', async () => {
    const err = await asApp
      .withTenant({ orgId: w.orgA, userId: w.users.p_partner }, async () => undefined)
      .catch((e: unknown) => e);
    expect(errCode(err)).toBe('ORG_NOT_MEMBER');
    const auth = await authDb();
    try {
      await expect(
        auth.query(
          "INSERT INTO auth.members (organization_id, user_id, role) VALUES ($1, $2, 'lawyer')",
          [w.orgA, w.users.p_partner],
        ),
      ).rejects.toThrow(/bayi kullanıcısı/);
    } finally {
      await auth.end();
    }
  });

  it('RLS-20: s_admin — eda_app ile withTenant(A) ORG_NOT_MEMBER (platform rolü kiracı verisi açmaz)', async () => {
    const err = await asApp
      .withTenant({ orgId: w.orgA, userId: w.users.s_admin }, async () => undefined)
      .catch((e: unknown) => e);
    expect(errCode(err)).toBe('ORG_NOT_MEMBER');
  });

  it('RLS-21: eda_readonly_admin — cases/messages/auth.users 42501; rollup SELECT başarılı; admin_list_orgs içeriksiz', async () => {
    await jobs.query(
      `INSERT INTO app.admin_rollup_orgs_daily (day, org_id, plan_code, active_users, seats, storage_bytes, files_count)
       VALUES (current_date, $1, NULL, 3, 9, 1024, 2)`,
      [w.orgA],
    );
    const admin = await adminDb();
    try {
      for (const sql of [
        'SELECT 1 FROM app.cases LIMIT 1',
        'SELECT 1 FROM app.messages LIMIT 1',
        'SELECT 1 FROM auth.users LIMIT 1',
      ]) {
        expect(await codeOf(admin.query(sql)), sql).toBe('42501');
      }
      await expect(
        admin.query('SELECT count(*) FROM app.admin_rollup_usage_daily'),
      ).resolves.toBeDefined();
      const list = await admin.query<Record<string, unknown>>(
        'SELECT * FROM app.admin_list_orgs(NULL, $1, 1)',
        [uuidMinusOne(w.orgA)],
      );
      expect(list.rows).toHaveLength(1);
      expect(list.rows[0]).toMatchObject({
        org_id: w.orgA,
        org_name: 'Örnek Büro A',
        kind: 'firm',
        active_users: 3,
        seats: 9,
        files_count: 2,
      });
      for (const col of list.fields.map((f) => f.name)) expect(CONTENT.has(col), col).toBe(false);
    } finally {
      await admin.end();
    }
    const app = await appDb();
    try {
      expect(await codeOf(app.query('SELECT * FROM app.admin_list_orgs(NULL, NULL, 1)'))).toBe(
        '42501',
      );
    } finally {
      await app.end();
    }
  });

  it('RLS-22: eda_jobs — messages.parts 42501; reasoning = NULL UPDATE başarılı; cases(id, org_id, legal_hold) iki büro', async () => {
    expect(await codeOf(jobs.query('SELECT parts FROM app.messages LIMIT 1'))).toBe('42501');
    const msg = await jobs.query<{ id: string }>(
      'SELECT id FROM app.messages WHERE conversation_id = $1',
      [w.conv_l1_private],
    );
    expect(msg.rowCount).toBe(1);
    const upd = await jobs.query('UPDATE app.messages SET reasoning = NULL WHERE id = $1', [
      msg.rows[0]?.id,
    ]);
    expect(upd.rowCount).toBe(1);
    const cases = await jobs.query<{ org_id: string }>(
      'SELECT id, org_id, legal_hold FROM app.cases WHERE id = ANY ($1::uuid[])',
      [[w.case_A_org, w.case_B]],
    );
    expect(new Set(cases.rows.map((r) => r.org_id))).toEqual(new Set([w.orgA, w.orgB]));
  });

  it('RLS-23: eda_auth — app.cases SELECT 42501', async () => {
    const auth = await authDb();
    try {
      expect(await codeOf(auth.query('SELECT 1 FROM app.cases LIMIT 1'))).toBe('42501');
    } finally {
      await auth.end();
    }
  });

  it('RLS-24: eda_app — accounts/sessions/two_factors 42501; users(email) başarılı; invitations(id) 42501', async () => {
    const app = await appDb();
    try {
      for (const t of ['accounts', 'sessions', 'two_factors']) {
        expect(await codeOf(app.query(`SELECT 1 FROM auth.${t} LIMIT 1`)), t).toBe('42501');
      }
      const r = await app.query('SELECT email FROM auth.users WHERE id = $1', [w.users.a_lawyer1]);
      expect(r.rowCount).toBe(1);
      expect(await codeOf(app.query('SELECT id FROM auth.invitations LIMIT 1'))).toBe('42501');
    } finally {
      await app.end();
    }
  });

  it('RLS-25: appDb — withTenant(A) sonrası aynı fiziksel bağlantıda app.org_id boş (havuz sızıntısı yok)', async () => {
    const pool = makePool('eda_app', 1);
    try {
      const runner = createTenantRunner(pool);
      const pidIn = await runner.withTenant(
        { orgId: w.orgA, userId: w.users.a_lawyer1 },
        async (tx) => {
          const r = await tx.query<{ pid: number; org: string }>(
            "SELECT pg_backend_pid() AS pid, current_setting('app.org_id', true) AS org",
          );
          expect(r.rows[0]?.org).toBe(w.orgA);
          return r.rows[0]?.pid;
        },
      );
      const client = await pool.connect();
      try {
        const r = await client.query<{ pid: number; org: string | null; usr: string | null }>(
          `SELECT pg_backend_pid() AS pid, current_setting('app.org_id', true) AS org,
                  current_setting('app.user_id', true) AS usr`,
        );
        expect(r.rows[0]?.pid).toBe(pidIn);
        expect(r.rows[0]?.org ?? '').toBe('');
        expect(r.rows[0]?.usr ?? '').toBe('');
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  });

  it('RLS-26: eda_app — audit_log bölümünü doğrudan SELECT 42501', async () => {
    const part = await owner.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
       WHERE i.inhparent = 'app.audit_log'::regclass ORDER BY 1 LIMIT 1`,
    );
    const name = part.rows[0]?.name ?? '';
    expect(name).toMatch(/^audit_log_p\d{4}_\d{2}$/);
    const direct = asApp.withTenant({ orgId: w.orgA, userId: w.users.a_owner }, (tx) =>
      tx.query(`SELECT count(*) FROM app.${name}`),
    );
    expect(await codeOf(direct)).toBe('42501');
  });

  it('RLS-27: templates — a_lawyer1 @A platform + A / b_owner @B platform + B; org_id NULL INSERT 42501', async () => {
    const list = (orgId: string, userId: string) =>
      asApp.withTenant({ orgId, userId }, (tx) =>
        tx.query<{ id: string; org_id: string | null }>('SELECT id, org_id FROM app.templates'),
      );
    const a = await list(w.orgA, w.users.a_lawyer1);
    const b = await list(w.orgB, w.users.b_owner);
    const ids = (r: typeof a) => new Set(r.rows.map((x) => x.id));
    expect(ids(a).has(w.template_platform) && ids(a).has(w.template_A)).toBe(true);
    expect(ids(a).has(w.template_B)).toBe(false);
    expect(a.rows.every((r) => r.org_id === null || r.org_id === w.orgA)).toBe(true);
    expect(ids(b).has(w.template_platform) && ids(b).has(w.template_B)).toBe(true);
    expect(ids(b).has(w.template_A)).toBe(false);
    expect(b.rows.every((r) => r.org_id === null || r.org_id === w.orgB)).toBe(true);
    const ins = asApp.withTenant({ orgId: w.orgB, userId: w.users.b_owner }, (tx) =>
      tx.query(
        `INSERT INTO app.templates (org_id, kind, title, content) VALUES (NULL, 'petition', 'Örnek veri', '{}'::jsonb)`,
      ),
    );
    expect(await codeOf(ins)).toBe('42501');
  });
});

describe('KK-P03c-4 (KK-031-9): app.admin_* dönüş kolonları içerik listesinde yok', () => {
  it('her admin_* fonksiyonunun dönüş kolonları content_columns dışında (dinamik tarama)', async () => {
    const res = await owner.query<{ fn: string; cols: string[] | null; result: string }>(
      `SELECT p.oid::regprocedure::text AS fn, pg_get_function_result(p.oid) AS result,
              ARRAY(SELECT a.name FROM unnest(p.proargnames, p.proargmodes::text[]) AS a(name, mode)
                    WHERE a.mode IN ('t', 'o')) AS cols
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app' AND p.proname LIKE 'admin\\_%'`,
    );
    expect(res.rows.map((r) => r.fn)).toContain('app.admin_list_orgs(text,uuid,integer)');
    for (const r of res.rows) {
      for (const c of r.cols ?? []) expect(CONTENT.has(c), `${r.fn}: ${c}`).toBe(false);
    }
  });

  it('p_actor_id alan admin yazma fonksiyonları platform rolü uygun olmayan kullanıcıyla 42501 (P27 genişletir)', async () => {
    const writers = await owner.query<{ fn: string; proname: string }>(
      `SELECT p.oid::regprocedure::text AS fn, p.proname
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app' AND p.proname LIKE 'admin\\_%' AND 'p_actor_id' = ANY (p.proargnames)`,
    );
    const admin = await adminDb();
    try {
      for (const r of writers.rows) {
        // Bu imzalar P27'de eklenir; ilk parametre p_actor_id, kalanlar NULL ile denenir.
        const argc = Number(
          (
            await owner.query<{ n: number }>(
              'SELECT pronargs AS n FROM pg_proc WHERE oid = $1::regprocedure',
              [r.fn],
            )
          ).rows[0]?.n,
        );
        const params = [w.users.a_lawyer1, ...Array.from({ length: argc - 1 }, () => null)];
        const ph = params.map((_, i) => `$${i + 1}`).join(', ');
        const err = await admin
          .query(`SELECT app.${r.proname}(${ph})`, params)
          .catch((e: unknown) => e);
        expect(pgCode(err).code, r.fn).toBe('42501');
      }
    } finally {
      await admin.end();
    }
  });
});

describe('KK-P03c-5 (KK-031-10): rollup tablolarında kullanıcı, içerik veya serbest metin kolonu yok', () => {
  const SNAPSHOT: Record<string, string> = {
    admin_rollup_orgs_daily:
      'day:date, org_id:uuid, plan_code:text, active_users:integer, seats:integer, storage_bytes:bigint, files_count:integer',
    admin_rollup_product_daily: 'day:date, metric:text, value:bigint',
    admin_rollup_sources_hourly:
      'hour:timestamp with time zone, source:text, requests:integer, errors:integer, p95_ms:integer, breaker_state:text, bucket_fill_pct:integer, live_fallback_count:integer',
    admin_rollup_usage_daily:
      'day:date, org_id:uuid, model_alias:text, provider_id:text, task:text, data_class:text, calls:integer, input_tokens:bigint, cached_input_tokens:bigint, output_tokens:bigint, reasoning_tokens:bigint, cost_micro_usd:bigint, credits:bigint',
    partner_rollup_monthly:
      'month:date, partner_code:text, org_id:uuid, credits_used:bigint, paid_amount_kurus:bigint',
  };
  /** Metin kolonları yalnız kod değerleri taşır (serbest metin değil). */
  const CODE_TEXT = new Set([
    'plan_code',
    'metric',
    'source',
    'breaker_state',
    'model_alias',
    'provider_id',
    'task',
    'data_class',
    'partner_code',
  ]);

  it('şema anlık görüntüsü eşit; user_id ve içerik kolonu yok; metin kolonları yalnız kod', async () => {
    const res = await owner.query<{ t: string; cols: string }>(
      `SELECT table_name AS t,
              string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) AS cols
       FROM information_schema.columns
       WHERE table_schema = 'app' AND (table_name LIKE 'admin\\_rollup\\_%' OR table_name = 'partner_rollup_monthly')
       GROUP BY table_name`,
    );
    const live = Object.fromEntries(res.rows.map((r) => [r.t, r.cols]));
    expect(live).toEqual(SNAPSHOT);
    for (const cols of Object.values(live)) {
      for (const part of cols.split(', ')) {
        const [name = '', type = ''] = part.split(':');
        expect(name).not.toBe('user_id');
        expect(CONTENT.has(name), name).toBe(false);
        if (type === 'text') expect(CODE_TEXT.has(name), name).toBe(true);
      }
    }
  });
});
