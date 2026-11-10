// @tk TK-26
//  DB kısmı (0047): `app.admin_ai_key_*` büro/kullanıcı anahtar atama fonksiyonları ve platform
// ortak anahtarı sayacı (`app.platform_key_usage`, `app.platform_key_usage_today`). Yazma yalnız
// super_admin'e açıktır; şifreli değer yalnız yazılır (eda_readonly_admin ham sütunu okuyamaz); denetim
// satırı anahtar değeri ve son 4 hane taşımaz; kullanıcı yalnız kendi kullanım satırını görür.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AdminDb, createAdminDb } from '../../src/admin.ts';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { adminDb, jobsDb, makePool, ownerDb, pgCode } from '../fixtures/db.ts';
import { newWorldKey } from '../fixtures/ids.ts';
import { grantSeats } from '../fixtures/seats.ts';
import { addMember, insertOrg, insertUser } from '../fixtures/tenant-world.ts';

let owner: pg.Client;
let jobs: pg.Client;
let rawAdmin: pg.Client;
let appPool: pg.Pool;
let asApp: TenantRunner;
let admin: AdminDb;
let key: string;
let superId: string;
let supportId: string;
let memberId: string;
let otherMemberId: string;
let orgA: string;
let orgB: string;
const boss: Record<string, string> = {};
const LAST4 = 'Zq9x';

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => pgCode(e).code,
  );
/** Ham büro anahtarı satırı (RLS altında, büro üyesi olarak). */
const orgRow = (org: string) =>
  asApp.withTenant({ orgId: org, userId: boss[org] ?? '' }, async (tx) => {
    const r = await tx.query(
      'SELECT ai_api_key_enc AS enc, ai_api_key_last4 AS l4, ai_api_key_version AS v FROM app.org_settings WHERE org_id = $1',
      [org],
    );
    return r.rows[0] as { enc: Buffer | null; l4: string | null; v: number | null };
  });
const userRow = (id: string) =>
  asApp.withUserScope({ userId: id }, async (tx) => {
    const r = await tx.query(
      'SELECT ai_key_source AS s, ai_api_key_enc AS e, ai_api_key_last4 AS l4 FROM app.user_preferences WHERE user_id = $1',
      [id],
    );
    return r.rows[0] as { s: string; e: Buffer | null; l4: string | null } | undefined;
  });
const auditCount = async (target: string) =>
  Number(
    (
      await jobs.query(
        `SELECT count(*)::int AS n FROM app.audit_log WHERE action = 'system_setting.changed' AND target_id = $1`,
        [target],
      )
    ).rows[0]?.n ?? 0,
  );
const read = (sql: string, params: unknown[]) => admin.withAdmin((tx) => tx.query(sql, params));
const write = (sql: string, params: unknown[]) =>
  admin.withAdminWrite((tx) => tx.query(sql, params));

async function staff(tag: string, role: 'support' | 'super_admin'): Promise<string> {
  const r = await owner.query<{ id: string }>(
    `INSERT INTO auth.users (name, email, email_verified, platform_role, verification_status)
     VALUES ($1, $2, true, $3, 'verified') RETURNING id`,
    [`Örnek ${tag}`, `${tag}.${key}@ornek.test`, role],
  );
  return r.rows[0]?.id ?? '';
}

beforeAll(async () => {
  owner = await ownerDb();
  jobs = await jobsDb();
  rawAdmin = await adminDb();
  appPool = makePool('eda_app');
  asApp = createTenantRunner(appPool);
  admin = createAdminDb(makePool('eda_readonly_admin'));
  key = newWorldKey();
  superId = await staff('ak-super', 'super_admin');
  supportId = await staff('ak-destek', 'support');
  memberId = await insertUser(owner, key, 'ak-uye');
  otherMemberId = await insertUser(owner, key, 'ak-uye2');
  orgA = await insertOrg(owner, key, 'ak-buro-a');
  orgB = await insertOrg(owner, key, 'ak-buro-b');
  for (const [i, org] of [orgA, orgB].entries()) {
    await grantSeats(owner, org);
    const head = await insertUser(owner, key, `ak-sahip-${i}`);
    boss[org] = head;
    await addMember(owner, org, head, 'owner');
    await asApp.withTenant({ orgId: org, userId: head }, async (tx) => {
      await tx.query('INSERT INTO app.org_settings (org_id) VALUES ($1)', [org]);
      await tx.query(
        `INSERT INTO app.org_keys (org_id, key_version, wrapped_dek, kek_version) VALUES ($1, 1, $2, 1)`,
        [org, randomBytes(60)],
      );
    });
  }
  await addMember(owner, orgA, memberId, 'lawyer');
  await addMember(owner, orgA, otherMemberId, 'lawyer');
});
afterAll(async () => {
  await owner.end();
  await jobs.end();
  await rawAdmin.end();
  await appPool.end();
  await admin.end();
});

describe('AS-0409: admin_ai_key_* aktör kapısı', () => {
  it('support ve sıradan kullanıcı hiçbir anahtar fonksiyonunu çalıştıramaz (42501)', async () => {
    const enc = randomBytes(40);
    for (const actor of [supportId, memberId]) {
      expect(
        await codeOf(read('SELECT * FROM app.admin_ai_key_org_list($1, NULL, 5)', [actor])),
      ).toBe('42501');
      expect(
        await codeOf(read('SELECT * FROM app.admin_ai_key_user_list($1, NULL, 5)', [actor])),
      ).toBe('42501');
      expect(
        await codeOf(read('SELECT * FROM app.admin_ai_key_org_dek($1, $2)', [actor, orgA])),
      ).toBe('42501');
      expect(await codeOf(read('SELECT * FROM app.admin_ai_platform_card($1)', [actor]))).toBe(
        '42501',
      );
      expect(
        await codeOf(
          write('SELECT app.admin_ai_key_org_set($1, $2, $3, $4, 1, now())', [
            actor,
            orgA,
            enc,
            LAST4,
          ]),
        ),
      ).toBe('42501');
      expect(
        await codeOf(
          write('SELECT app.admin_ai_key_user_set($1, $2, $3, $4, 1, now())', [
            actor,
            memberId,
            enc,
            LAST4,
          ]),
        ),
      ).toBe('42501');
      expect(await codeOf(write('SELECT app.admin_ai_key_org_clear($1, $2)', [actor, orgA]))).toBe(
        '42501',
      );
      expect(
        await codeOf(write('SELECT app.admin_ai_key_user_clear($1, $2)', [actor, memberId])),
      ).toBe('42501');
    }
  });

  it('personel hesabına kullanıcı anahtarı atanamaz (55000); bilinmeyen büro P0002', async () => {
    const enc = randomBytes(40);
    expect(
      await codeOf(
        write('SELECT app.admin_ai_key_user_set($1, $2, $3, $4, 1, now())', [
          superId,
          supportId,
          enc,
          LAST4,
        ]),
      ),
    ).toBe('55000');
    expect(
      await codeOf(
        write('SELECT app.admin_ai_key_org_set($1, $2, $3, $4, 1, now())', [
          superId,
          '00000000-0000-4000-8000-000000000000',
          enc,
          LAST4,
        ]),
      ),
    ).toBe('P0002');
  });
});

describe('AS-0409: büro anahtarı atama ve silme', () => {
  it('atama şifreli değeri yazar, listede yalnız son4 görünür; başka büro etkilenmez; denetim içeriksiz', async () => {
    const enc = randomBytes(48);
    const dek = await read('SELECT * FROM app.admin_ai_key_org_dek($1, $2)', [superId, orgA]);
    expect(dek.rows[0]).toMatchObject({ key_version: 1, kek_version: 1 });
    const r = await write('SELECT app.admin_ai_key_org_set($1, $2, $3, $4, 1, now()) AS prev', [
      superId,
      orgA,
      enc,
      LAST4,
    ]);
    expect(r.rows[0]).toEqual({ prev: false });
    const a = await orgRow(orgA);
    expect(Buffer.compare(a.enc ?? Buffer.alloc(0), enc)).toBe(0);
    expect(a).toMatchObject({ l4: LAST4, v: 1 });
    expect((await orgRow(orgB)).enc).toBeNull();
    const list = await read('SELECT * FROM app.admin_ai_key_org_list($1, $2, 5)', [superId, orgA]);
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ org_id: orgA, key_last4: LAST4 });
    expect(Object.keys(list.rows[0] as object)).not.toContain('ai_api_key_enc');
    const audit = await jobs.query(
      `SELECT metadata::text AS m FROM app.audit_log
        WHERE action = 'system_setting.changed' AND target_id = $1 AND actor_id = $2`,
      [orgA, superId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.m).toContain('"scope": "ai_key"');
    expect(audit.rows[0]?.m).not.toContain(LAST4);
  });

  it('eda_readonly_admin şifreli sütunu ham tablodan okuyamaz', async () => {
    expect(
      await codeOf(rawAdmin.query('SELECT ai_api_key_enc FROM app.org_settings LIMIT 1')),
    ).toBe('42501');
    expect(
      await codeOf(rawAdmin.query('SELECT ai_api_key_enc FROM app.user_preferences LIMIT 1')),
    ).toBe('42501');
  });

  it('silme anahtarı boşaltır, denetim yazar; ikinci silme no-op (denetim eklenmez)', async () => {
    const before = await auditCount(orgA);
    expect(
      (await write('SELECT app.admin_ai_key_org_clear($1, $2) AS done', [superId, orgA])).rows[0],
    ).toEqual({ done: true });
    expect(
      (await write('SELECT app.admin_ai_key_org_clear($1, $2) AS done', [superId, orgA])).rows[0],
    ).toEqual({ done: false });
    expect(await orgRow(orgA)).toMatchObject({ enc: null, l4: null });
    expect(await auditCount(orgA)).toBe(before + 1);
  });
});

describe('AS-0409: kullanıcı anahtarı atama ve silme', () => {
  it("atama kaynağı own yapar, silme org'a döndürür; yalnız hedef kullanıcı etkilenir", async () => {
    const enc = randomBytes(48);
    await write('SELECT app.admin_ai_key_user_set($1, $2, $3, $4, 1, now())', [
      superId,
      memberId,
      enc,
      LAST4,
    ]);
    expect(await userRow(memberId)).toMatchObject({ s: 'own', l4: LAST4 });
    expect(await userRow(otherMemberId)).toBeUndefined();
    const list = await read('SELECT * FROM app.admin_ai_key_user_list($1, $2, 5)', [
      superId,
      memberId,
    ]);
    expect(list.rows[0]).toMatchObject({ user_id: memberId, key_source: 'own', key_last4: LAST4 });
    await write('SELECT app.admin_ai_key_user_clear($1, $2)', [superId, memberId]);
    expect(await userRow(memberId)).toEqual({ s: 'org', e: null, l4: null });
  });
});

describe('AS-0409: platform ortak anahtarı sayacı', () => {
  const ctxA = () => ({ orgId: orgA, userId: memberId });

  it('kullanıcı kendi satırını yazar/okur; başkasının kimliğiyle yazamaz; başka kullanıcı görmez', async () => {
    await asApp.withTenant(ctxA(), (tx) =>
      tx.query(
        `INSERT INTO app.platform_key_usage (org_id, user_id, model_alias, input_tokens, output_tokens, cost_micro_usd, status)
         VALUES ($1, $2, 'edai-flash', 100, 50, 3, 'success')`,
        [orgA, memberId],
      ),
    );
    const forged = asApp.withTenant(ctxA(), (tx) =>
      tx.query(
        `INSERT INTO app.platform_key_usage (org_id, user_id, model_alias, status) VALUES ($1, $2, 'edai-flash', 'success')`,
        [orgA, otherMemberId],
      ),
    );
    expect(await codeOf(forged)).toBe('42501');
    const mine = await asApp.withTenant(ctxA(), (tx) =>
      tx.query('SELECT user_id FROM app.platform_key_usage'),
    );
    expect(mine.rows.map((x) => x.user_id)).toEqual([memberId]);
    const theirs = await asApp.withTenant({ orgId: orgA, userId: otherMemberId }, (tx) =>
      tx.query('SELECT user_id FROM app.platform_key_usage'),
    );
    expect(theirs.rowCount).toBe(0);
  });

  it('platform_key_usage_today: kullanıcı ve büro toplamı, koltuk; başka kullanıcı satırını saymaz', async () => {
    await asApp.withTenant({ orgId: orgA, userId: otherMemberId }, (tx) =>
      tx.query(
        `INSERT INTO app.platform_key_usage (org_id, user_id, model_alias, input_tokens, output_tokens, cost_micro_usd, status)
         VALUES ($1, $2, 'edai-pro', 10, 5, 7, 'success')`,
        [orgA, otherMemberId],
      ),
    );
    const r = await asApp.withTenant(ctxA(), (tx) =>
      tx.query('SELECT * FROM app.platform_key_usage_today()'),
    );
    expect(r.rows[0]).toMatchObject({
      user_turns_day: '1',
      user_tokens_day: '150',
      org_cost_day: '10',
      org_seats: 3,
      ov_turns_day: null,
    });
  });

  it('doğrulanmamış/üye olmayan kullanıcı kapıyı çalıştıramaz (42501)', async () => {
    const outsider = await insertUser(owner, key, 'ak-dis');
    expect(
      await codeOf(
        asApp.withTenant({ orgId: orgA, userId: outsider }, (tx) =>
          tx.query('SELECT * FROM app.platform_key_usage_today()'),
        ),
      ),
    ).toBeDefined();
    const pending = await insertUser(owner, key, 'ak-bekleyen');
    await owner.query(
      "UPDATE auth.users SET verification_status = 'pending_verification' WHERE id = $1",
      [pending],
    );
    await addMember(owner, orgA, pending, 'lawyer');
    expect(
      await codeOf(
        asApp.withTenant({ orgId: orgA, userId: pending }, (tx) =>
          tx.query('SELECT * FROM app.platform_key_usage_today()'),
        ),
      ),
    ).toBe('42501');
  });

  it('admin kartı son 24 saat toplamını verir (içerik kolonu yok)', async () => {
    const r = await read('SELECT * FROM app.admin_ai_platform_card($1)', [superId]);
    expect(Number(r.rows[0]?.turns)).toBeGreaterThanOrEqual(2);
    expect(Object.keys(r.rows[0] as object).sort()).toEqual([
      'cost_micro_usd',
      'orgs',
      'tokens',
      'turns',
      'users',
    ]);
  });
});
