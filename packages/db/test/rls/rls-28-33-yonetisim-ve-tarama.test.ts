// @tk TK-01
// KK-P03c-1 (KK-031-3): RLS-28…RLS-33 — yönetişim kısıtları (OA/OW), kredi defteri, oluşturan kuralı,
// içerik devri ve manifestteki her E tablonun genel taraması. RLS-33 tablo listesini manifestten alır
// ve canlı katalogdaki RLS'li tablo kümesine eşitliğini doğrular: yeni kiracılı tablo (manifest testi
// gereği manifestte olmak zorundadır) taramaya kendiliğinden girer.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RLS_MANIFEST, RLS_TABLES } from '../../src/rls/manifest.ts';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { jobsDb, makePool, ownerDb } from '../fixtures/db.ts';
import { createConversation } from '../fixtures/factories.ts';
import { appUnselectableTables, codeOf } from '../fixtures/rls-helpers.ts';
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
});
afterAll(async () => {
  await owner.end();
  await jobs.end();
  await ownerPool.end();
  await appPool.end();
});

const errCode = (err: unknown): string | undefined => (err as { code?: string }).code;

describe('KK-P03c-1: RLS-28…RLS-33 yönetişim ve genel tarama', () => {
  it('RLS-28: org_settings UPDATE — a_lawyer1 0 satır / a_admin başarılı', async () => {
    const upd = (userId: string) =>
      asApp.withTenant({ orgId: w.orgA, userId }, async (tx) => {
        const r = await tx.query(
          'UPDATE app.org_settings SET show_reasoning = true WHERE org_id = $1',
          [w.orgA],
        );
        return r.rowCount;
      });
    expect([await upd(w.users.a_lawyer1), await upd(w.users.a_admin)]).toEqual([0, 1]);
  });

  it("RLS-29: credit_ledger INSERT — entry_type='purchase' 42501; 'consume' başarılı", async () => {
    const ins = (entryType: string, amount: number) =>
      asApp.withTenant({ orgId: w.orgA, userId: w.users.a_lawyer1 }, (tx) =>
        tx.query(
          `INSERT INTO app.credit_ledger (org_id, entry_type, amount, balance_after, op_code, user_id)
           VALUES ($1, $2, $3, 0, 'chat_fast', $4)`,
          [w.orgA, entryType, amount, w.users.a_lawyer1],
        ),
      );
    expect(await codeOf(ins('purchase', 10))).toBe('42501');
    expect(await codeOf(ins('consume', -1))).toBeUndefined();
  });

  it("RLS-30: a_lawyer1 — restricted dava INSERT … RETURNING, ardından kendini case_members'a ekler", async () => {
    const caseId = await asApp.withTenant(
      { orgId: w.orgA, userId: w.users.a_lawyer1 },
      async (tx) => {
        const r = await tx.query<{ id: string }>(
          `INSERT INTO app.cases (org_id, owner_id, title, title_fold, visibility, created_by)
         VALUES ($1, $2, 'Örnek veri kısıtlı', 'ornek veri kisitli', 'restricted', $2) RETURNING id`,
          [w.orgA, w.users.a_lawyer1],
        );
        const id = r.rows[0]?.id ?? '';
        await tx.query(
          'INSERT INTO app.case_members (org_id, case_id, user_id, added_by) VALUES ($1, $2, $3, $3)',
          [w.orgA, id, w.users.a_lawyer1],
        );
        return id;
      },
    );
    expect(caseId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("RLS-31: ai_policy_acceptances kind='public_mode_enable' INSERT — a_admin 42501 / a_owner başarılı", async () => {
    const ins = (userId: string) =>
      asApp.withTenant({ orgId: w.orgA, userId }, (tx) =>
        tx.query(
          `INSERT INTO app.ai_policy_acceptances (org_id, kind, policy_version, text_sha256, accepted_by)
           VALUES ($1, 'public_mode_enable', 'v1', $2, $3)`,
          [w.orgA, randomBytes(32), userId],
        ),
      );
    expect(await codeOf(ins(w.users.a_admin))).toBe('42501');
    expect(await codeOf(ins(w.users.a_owner))).toBeUndefined();
  });

  it('RLS-32: app.transfer_member_content(a_lawyer2, a_owner) — a_lawyer1 hata / a_owner başarılı + org.conversations.transferred', async () => {
    const u = w.users;
    await createConversation(w.ctx, {
      name: 'conv_l2_private',
      orgId: w.orgA,
      userId: u.a_lawyer2,
    });
    const call = (userId: string) =>
      asApp.withTenant({ orgId: w.orgA, userId }, async (tx) => {
        const r = await tx.query<{ n: number }>('SELECT app.transfer_member_content($1, $2) AS n', [
          u.a_lawyer2,
          u.a_owner,
        ]);
        return r.rows[0]?.n;
      });
    const denied = await call(u.a_lawyer1).catch((e: unknown) => e);
    expect(errCode(denied)).toBe('42501');
    expect(await call(u.a_owner)).toBe(1);
    const ev = await jobs.query<{ actor_id: string; target_id: string }>(
      `SELECT actor_id, target_id FROM app.audit_log
       WHERE org_id = $1 AND action = 'org.conversations.transferred'`,
      [w.orgA],
    );
    expect(ev.rows).toEqual([{ actor_id: u.a_owner, target_id: u.a_lawyer2 }]);
  });

  it("RLS-33: b_owner @B — manifestteki HER E tabloda A'nın org_id'siyle count(*) 0", async () => {
    // Taranan küme = canlı RLS'li app tabloları (bölümler hariç); manifestten türetilir.
    const live = await owner.query<{ t: string }>(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relrowsecurity`,
    );
    expect([...RLS_TABLES].sort()).toEqual(live.rows.map((r) => r.t).sort());

    const cols = await owner.query<{ t: string; c: string }>(
      `SELECT table_name AS t, column_name AS c FROM information_schema.columns
       WHERE table_schema = 'app' AND column_name IN ('org_id', 'user_id')`,
    );
    const has = (t: string, c: string) => cols.rows.some((r) => r.t === t && r.c === c);
    const aUsers = Object.entries(w.users)
      .filter(([name]) => name.startsWith('a_'))
      .map(([, id]) => id);
    const unselectable = new Set(appUnselectableTables());

    // Ön koşul: A verisi gerçekten vardır (eda_jobs BYPASSRLS, yalnız kimlik kolonları).
    let withData = 0;
    for (const t of RLS_TABLES) {
      const jc = RLS_MANIFEST[t]?.jobsColumns?.select ?? [];
      if (!has(t, 'org_id') || !jc.includes('org_id')) continue;
      const r = await jobs.query<{ n: string }>(
        `SELECT count(*) AS n FROM app.${t} WHERE org_id = $1`,
        [w.orgA],
      );
      if (Number(r.rows[0]?.n) > 0) withData += 1;
    }
    expect(withData).toBeGreaterThanOrEqual(10);

    const seen = await asApp.withTenant({ orgId: w.orgB, userId: w.users.b_owner }, async (tx) => {
      const out: Record<string, number | string> = {};
      for (const t of RLS_TABLES) {
        if (unselectable.has(t)) {
          await tx.query('SAVEPOINT s');
          const code = await codeOf(tx.query(`SELECT 1 FROM app.${t} LIMIT 1`));
          await tx.query('ROLLBACK TO SAVEPOINT s');
          out[t] = code ?? 'erişildi';
          continue;
        }
        const r = has(t, 'org_id')
          ? await tx.query<{ n: string }>(`SELECT count(*) AS n FROM app.${t} WHERE org_id = $1`, [
              w.orgA,
            ])
          : await tx.query<{ n: string }>(
              `SELECT count(*) AS n FROM app.${t} WHERE user_id = ANY ($1::uuid[])`,
              [aUsers],
            );
        out[t] = Number(r.rows[0]?.n);
      }
      return out;
    });
    for (const t of RLS_TABLES) {
      expect(seen[t], t).toBe(unselectable.has(t) ? '42501' : 0);
    }
  });
});
