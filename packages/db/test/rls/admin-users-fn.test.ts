// @tk TK-26
// KK-053-11-4 / KK-053-11-10 DB kısmı (0038): `app.user_limit_overrides` RLS'i ve `app.admin_*` kullanıcı
// fonksiyonları. Okuma personele (support, super_admin), yazma yalnız super_admin'e açıktır; personel
// hesapları üzerinde eylem yoktur (55000); fonksiyon çıktısında içerik kolonu yoktur; eda_readonly_admin
// ham tablolara erişemez; askı ve limit yazımı denetim satırı üretir.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AdminDb, createAdminDb } from '../../src/admin.ts';
import { CONTENT_COLUMNS } from '../../src/rls/manifest.ts';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { adminDb, jobsDb, makePool, ownerDb, pgCode } from '../fixtures/db.ts';
import { newWorldKey } from '../fixtures/ids.ts';

let owner: pg.Client;
let jobs: pg.Client;
let rawAdmin: pg.Client;
let appPool: pg.Pool;
let asApp: TenantRunner;
let admin: AdminDb;
let key: string;
let superId: string;
let supportId: string;
let plainId: string;
let targetId: string;
let otherId: string;

async function user(tag: string, role: 'user' | 'support' | 'super_admin'): Promise<string> {
  const r = await owner.query<{ id: string }>(
    `INSERT INTO auth.users (name, email, email_verified, platform_role, verification_status)
     VALUES ($1, $2, true, $3, 'verified') RETURNING id`,
    [`Örnek ${tag}`, `${tag}.${key}@ornek.test`, role],
  );
  return r.rows[0]?.id ?? '';
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => pgCode(e).code,
  );

const read = (sql: string, params: unknown[]) =>
  admin.withAdmin((tx) => tx.query(sql, params as unknown[]));
const write = (sql: string, params: unknown[]) =>
  admin.withAdminWrite((tx) => tx.query(sql, params as unknown[]));

beforeAll(async () => {
  owner = await ownerDb();
  jobs = await jobsDb();
  rawAdmin = await adminDb();
  appPool = makePool('eda_app');
  asApp = createTenantRunner(appPool);
  admin = createAdminDb(makePool('eda_readonly_admin'));
  key = newWorldKey();
  superId = await user('kt-super', 'super_admin');
  supportId = await user('kt-destek', 'support');
  plainId = await user('kt-sade', 'user');
  targetId = await user('kt-hedef', 'user');
  otherId = await user('kt-diger', 'user');
});
afterAll(async () => {
  await owner.end();
  await jobs.end();
  await rawAdmin.end();
  await appPool.end();
  await admin.end();
});

describe('KK-053-11-4: admin_list_users ve admin_user_detail', () => {
  it('aktör: super_admin ve support okur; sıradan kullanıcı ve bilinmeyen kimlik 42501', async () => {
    const sql = 'SELECT * FROM app.admin_list_users($1, NULL, NULL, NULL, NULL, 10, NULL, NULL)';
    expect((await read(sql, [superId])).rowCount).toBeGreaterThan(0);
    expect((await read(sql, [supportId])).rowCount).toBeGreaterThan(0);
    expect(await codeOf(read(sql, [plainId]))).toBe('42501');
    expect(await codeOf(read(sql, ['00000000-0000-4000-8000-000000000000']))).toBe('42501');
    const d = 'SELECT * FROM app.admin_user_detail($1, $2)';
    expect(await codeOf(read(d, [plainId, targetId]))).toBe('42501');
    expect(await codeOf(read(d, [superId, '00000000-0000-4000-8000-000000000000']))).toBe('P0002');
  });

  it('arama e-posta önekini, tam kimliği ve kısa kimliği bulur; joker karakterler kaçırılır', async () => {
    const q = (text: string) =>
      read('SELECT user_id FROM app.admin_list_users($1, $2, NULL, NULL, NULL, 50, NULL, NULL)', [
        superId,
        text,
      ]);
    expect((await q(`kt-hedef.${key}`)).rows).toEqual([{ user_id: targetId }]);
    expect((await q(targetId)).rows).toEqual([{ user_id: targetId }]);
    expect((await q(targetId.slice(-8))).rows.map((r) => r.user_id)).toContain(targetId);
    expect((await q('%')).rowCount).toBe(0);
    expect((await q('_')).rowCount).toBe(0);
  });

  it('süzgeç ve imleç: durum/rol süzgeci uygulanır, (created_at, id) imleci tekrarsız ilerler', async () => {
    const roles = await read(
      "SELECT platform_role FROM app.admin_list_users($1, $2, NULL, 'support', NULL, 50, NULL, NULL)",
      [superId, `kt-destek.${key}`],
    );
    expect(roles.rows).toEqual([{ platform_role: 'support' }]);
    // Aynı milisaniyede, farklı mikrosaniyede kayıtlar: imleç mikrosaniye hassasiyetli olmalı.
    const ids: string[] = [];
    for (const [n, micros] of [
      ['a', '123456'],
      ['b', '123789'],
      ['c', '123123'],
    ] as const) {
      const r = await owner.query<{ id: string }>(
        `INSERT INTO auth.users (name, email, email_verified, created_at)
         VALUES ($1, $2, true, ('2026-01-01 00:00:00.' || $3)::timestamptz) RETURNING id`,
        [`Örnek mik-${n}`, `mik-${n}.${key}@ornek.test`, micros],
      );
      ids.push(r.rows[0]?.id ?? '');
    }
    const seen: string[] = [];
    let at: string | null = null;
    let id: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const r = await read(
        `SELECT user_id, created_at::text AS at FROM app.admin_list_users($1, $2, NULL, NULL, NULL, 1, $3, $4)`,
        [superId, `mik-`, at, id],
      );
      if (r.rowCount === 0) break;
      const row = r.rows[0] as { user_id: string; at: string };
      seen.push(row.user_id);
      at = row.at;
      id = row.user_id;
    }
    // Azalan sıra: .123789, .123456, .123123
    expect(seen.filter((u) => ids.includes(u))).toEqual([ids[1], ids[0], ids[2]]);
    expect(new Set(seen).size).toBe(seen.length);
    expect(
      await codeOf(
        read("SELECT * FROM app.admin_list_users($1, NULL, 'x', NULL, NULL, 1, NULL, NULL)", [
          superId,
        ]),
      ),
    ).toBe('22023');
  });

  it('çıktı kolonları içerik kolonu taşımaz ve e-posta takma adla döner', async () => {
    const cols = await owner.query<{ col: string }>(
      `SELECT unnest(proargnames) AS col FROM pg_proc
       WHERE pronamespace = 'app'::regnamespace AND proname IN ('admin_list_users', 'admin_user_detail')
         AND proargmodes IS NOT NULL`,
    );
    const names = cols.rows.map((r) => r.col).filter((c) => !c.startsWith('p_'));
    expect(names.length).toBeGreaterThan(10);
    for (const c of names) expect(CONTENT_COLUMNS as readonly string[], c).not.toContain(c);
    expect(names).toContain('user_email');
  });

  it('eda_readonly_admin ham tablolara erişemez (auth.users, user_limit_overrides, messages)', async () => {
    for (const t of ['auth.users', 'app.user_limit_overrides', 'app.messages', 'auth.sessions']) {
      expect(await codeOf(rawAdmin.query(`SELECT 1 FROM ${t} LIMIT 1`)), t).toBe('42501');
    }
  });
});

describe('KK-053-11-10: askı, oturum denetimi ve limitler', () => {
  it('yazma yalnız super_admin: support ve sıradan kullanıcı 42501', async () => {
    for (const actor of [supportId, plainId]) {
      expect(
        await codeOf(
          write('SELECT app.admin_set_user_suspended($1, $2, true, $3)', [
            actor,
            targetId,
            'abuse',
          ]),
        ),
      ).toBe('42501');
      expect(
        await codeOf(
          write('SELECT app.admin_set_user_limits($1, $2, 1, NULL, NULL, NULL)', [actor, targetId]),
        ),
      ).toBe('42501');
      expect(
        await codeOf(
          write('SELECT app.admin_audit_sessions_revoked($1, $2, 1)', [actor, targetId]),
        ),
      ).toBe('42501');
    }
    const row = await owner.query('SELECT banned FROM auth.users WHERE id = $1', [targetId]);
    expect(row.rows[0]?.banned).toBe(false);
  });

  it('personel hedef 55000, bilinmeyen hedef P0002, geçersiz neden 22023', async () => {
    expect(
      await codeOf(
        write('SELECT app.admin_set_user_suspended($1, $2, true, $3)', [
          superId,
          supportId,
          'abuse',
        ]),
      ),
    ).toBe('55000');
    expect(
      await codeOf(
        write('SELECT app.admin_set_user_suspended($1, $2, true, $3)', [
          superId,
          '00000000-0000-4000-8000-000000000000',
          'abuse',
        ]),
      ),
    ).toBe('P0002');
    expect(
      await codeOf(
        write('SELECT app.admin_set_user_suspended($1, $2, true, $3)', [
          superId,
          targetId,
          'uydurma',
        ]),
      ),
    ).toBe('22023');
    expect(
      await codeOf(
        write('SELECT app.admin_set_user_suspended($1, $2, true, NULL)', [superId, targetId]),
      ),
    ).toBe('22023');
  });

  it('askı: banned + neden yazılır, denetim satırı üretilir, tekrar çağrı no-op, kaldırma temizler', async () => {
    const a = await write('SELECT app.admin_set_user_suspended($1, $2, true, $3) AS changed', [
      superId,
      targetId,
      'security',
    ]);
    expect(a.rows[0]).toEqual({ changed: true });
    const u = await owner.query('SELECT banned, ban_reason FROM auth.users WHERE id = $1', [
      targetId,
    ]);
    expect(u.rows[0]).toEqual({ banned: true, ban_reason: 'security' });
    const again = await write('SELECT app.admin_set_user_suspended($1, $2, true, $3) AS changed', [
      superId,
      targetId,
      'abuse',
    ]);
    expect(again.rows[0]).toEqual({ changed: false });
    const detail = await read(
      'SELECT account_status, suspend_reason_code FROM app.admin_user_detail($1, $2)',
      [supportId, targetId],
    );
    expect(detail.rows[0]).toEqual({
      account_status: 'suspended',
      suspend_reason_code: 'security',
    });
    const lift = await write(
      'SELECT app.admin_set_user_suspended($1, $2, false, NULL) AS changed',
      [superId, targetId],
    );
    expect(lift.rows[0]).toEqual({ changed: true });
    const u2 = await owner.query('SELECT banned, ban_reason FROM auth.users WHERE id = $1', [
      targetId,
    ]);
    expect(u2.rows[0]).toEqual({ banned: false, ban_reason: null });
    await write('SELECT app.admin_audit_sessions_revoked($1, $2, 3)', [superId, targetId]);
    const audit = await jobs.query<{ action: string; metadata: unknown; actor_type: string }>(
      `SELECT action, metadata, actor_type FROM app.audit_log
       WHERE actor_id = $1 AND target_id = $2 ORDER BY created_at, id`,
      [superId, targetId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'admin.user.suspended',
      'admin.user.unsuspended',
      'admin.session.revoked',
    ]);
    expect(audit.rows[0]).toMatchObject({
      actor_type: 'platform_staff',
      metadata: { reasonCode: 'security' },
    });
    expect(audit.rows[2]?.metadata).toEqual({ count: 3 });
  });

  it('limitler: yaz, güncelle, sıfırla; negatif değer 22023; denetim satırı sayıları taşır', async () => {
    await write('SELECT app.admin_set_user_limits($1, $2, 10, NULL, 5000, NULL)', [
      superId,
      otherId,
    ]);
    let d = await read(
      'SELECT ov_chat_turns_per_day, ov_chat_turns_per_month, ov_tokens_per_day FROM app.admin_user_detail($1, $2)',
      [superId, otherId],
    );
    expect(d.rows[0]).toMatchObject({ ov_chat_turns_per_day: 10, ov_chat_turns_per_month: null });
    expect(Number(d.rows[0]?.ov_tokens_per_day)).toBe(5000);
    await write('SELECT app.admin_set_user_limits($1, $2, 20, 300, NULL, 9000)', [
      superId,
      otherId,
    ]);
    d = await read(
      'SELECT ov_chat_turns_per_day, ov_chat_turns_per_month, ov_tokens_per_month FROM app.admin_user_detail($1, $2)',
      [superId, otherId],
    );
    expect(d.rows[0]).toMatchObject({ ov_chat_turns_per_day: 20, ov_chat_turns_per_month: 300 });
    expect(Number(d.rows[0]?.ov_tokens_per_month)).toBe(9000);
    expect(
      await codeOf(
        write('SELECT app.admin_set_user_limits($1, $2, -1, NULL, NULL, NULL)', [superId, otherId]),
      ),
    ).toBe('22023');
    await write('SELECT app.admin_set_user_limits($1, $2, NULL, NULL, NULL, NULL)', [
      superId,
      otherId,
    ]);
    const left = await owner.query('SELECT 1 FROM app.user_limit_overrides WHERE user_id = $1', [
      otherId,
    ]);
    expect(left.rowCount).toBe(0);
    const audit = await jobs.query<{ action: string; metadata: Record<string, unknown> }>(
      `SELECT action, metadata FROM app.audit_log WHERE actor_id = $1 AND target_id = $2 ORDER BY created_at, id`,
      [superId, otherId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'system_setting.changed',
      'system_setting.changed',
      'system_setting.changed',
    ]);
    expect(audit.rows[0]?.metadata).toMatchObject({
      scope: 'user_limit',
      chatTurnsPerDay: 10,
      tokensPerDay: 5000,
    });
  });

  it('RLS: kullanıcı yalnız kendi limit satırını okur ve yazamaz', async () => {
    await write('SELECT app.admin_set_user_limits($1, $2, 7, NULL, NULL, NULL)', [
      superId,
      plainId,
    ]);
    const own = await asApp.withUserScope({ userId: plainId }, (tx) =>
      tx.query('SELECT chat_turns_per_day FROM app.user_limit_overrides'),
    );
    expect(own.rows).toEqual([{ chat_turns_per_day: 7 }]);
    const foreign = await asApp.withUserScope({ userId: otherId }, (tx) =>
      tx.query('SELECT 1 FROM app.user_limit_overrides'),
    );
    expect(foreign.rowCount).toBe(0);
    const bind = await asApp.withNoTenant('health', (tx) =>
      tx.query('SELECT 1 FROM app.user_limit_overrides'),
    );
    expect(bind.rowCount).toBe(0);
    expect(
      await codeOf(
        asApp.withUserScope({ userId: plainId }, (tx) =>
          tx.query('UPDATE app.user_limit_overrides SET chat_turns_per_day = 99'),
        ),
      ),
    ).toBe('42501');
    expect(
      await codeOf(
        asApp.withUserScope({ userId: plainId }, (tx) =>
          tx.query('DELETE FROM app.user_limit_overrides'),
        ),
      ),
    ).toBe('42501');
  });
});
