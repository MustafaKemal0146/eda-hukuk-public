// @tk TK-26
// app.admin_audit_login_failures (0051): yönetim girişi başarısızlık/kilitlenme SAYAÇLARI. Yalnız personel
// çağırabilir (42501); yalnız metadata.surface = 'admin' olayları sayılır; backoff kilitlenmedir; çıktıda
// IP, e-posta veya kimlik yoktur (scope/key/n). Denetim günlüğü değiştirilemez; testler farkı ölçer.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AdminDb, createAdminDb } from '../../src/admin.ts';
import { createTenantRunner } from '../../src/tenant.ts';
import { appDb, makePool, ownerDb, pgCode } from '../fixtures/db.ts';
import { newWorldKey } from '../fixtures/ids.ts';
import { insertUser } from '../fixtures/tenant-world.ts';

let owner: pg.Client;
let rawApp: pg.Client;
let admin: AdminDb;
let appPool: ReturnType<typeof makePool>;
let supportId: string;
let memberId: string;
let key: string;

type Row = { scope: string; key: string; n: string };
const counts = async (actor: string) => {
  const rows = (
    await admin.withAdmin((tx) =>
      tx.query('SELECT * FROM app.admin_audit_login_failures($1)', [actor]),
    )
  ).rows as Row[];
  const total = (k: string) => Number(rows.find((r) => r.scope === 'total' && r.key === k)?.n ?? 0);
  const reason = (k: string) =>
    Number(rows.find((r) => r.scope === 'reason' && r.key === k)?.n ?? 0);
  return { rows, total, reason };
};

async function fail(metadata: Record<string, unknown>) {
  await createTenantRunner(appPool).withNoTenant('pre_auth_audit', (tx) =>
    tx.query(
      `SELECT app.audit_append('auth.login.failure', 'platform', 'session', NULL, $1::jsonb, NULL)`,
      [JSON.stringify(metadata)],
    ),
  );
}

beforeAll(async () => {
  owner = await ownerDb();
  rawApp = await appDb();
  appPool = makePool('eda_app');
  admin = createAdminDb(makePool('eda_readonly_admin'));
  key = newWorldKey();
  const r = await owner.query<{ id: string }>(
    `INSERT INTO auth.users (name, email, email_verified, platform_role, verification_status)
     VALUES ($1, $2, true, 'support', 'verified') RETURNING id`,
    ['Örnek destek', `lf-destek.${key}@ornek.test`],
  );
  supportId = r.rows[0]?.id ?? '';
  memberId = await insertUser(owner, key, 'lf-uye');
});
afterAll(async () => {
  await owner.end();
  await rawApp.end();
  await appPool.end();
  await admin.end();
});

describe('KK-GIRIS-DB: admin_audit_login_failures', () => {
  it('personel olmayan aktör 42501; uygulama rolü fonksiyonu çalıştıramaz', async () => {
    await expect(counts(memberId)).rejects.toSatisfy((e) => pgCode(e).code === '42501');
    expect(
      await rawApp.query('SELECT * FROM app.admin_audit_login_failures($1)', [supportId]).then(
        () => undefined,
        (e: unknown) => pgCode(e).code,
      ),
    ).toBe('42501');
  });

  it('yalnız admin yüzeyi sayılır; backoff kilitlenmedir; neden anahtarı kod benzeridir', async () => {
    const before = await counts(supportId);
    await fail({ reason: 'invalid_credentials', surface: 'admin' });
    await fail({ reason: 'invalid_credentials', surface: 'admin' });
    await fail({ reason: 'backoff', surface: 'admin' });
    await fail({ reason: 'invalid_credentials', surface: 'app' });
    await fail({ reason: 'passkey' });
    await fail({ reason: 'kişi@ornek.test serbest metin', surface: 'admin' });
    const after = await counts(supportId);
    expect(after.total('failures24h') - before.total('failures24h')).toBe(4);
    expect(after.total('failures7d') - before.total('failures7d')).toBe(4);
    expect(after.total('lockouts24h') - before.total('lockouts24h')).toBe(1);
    expect(after.reason('invalid_credentials') - before.reason('invalid_credentials')).toBe(2);
    expect(after.reason('backoff') - before.reason('backoff')).toBe(1);
    expect(after.reason('other') - before.reason('other')).toBe(1);
    expect(JSON.stringify(after.rows)).not.toContain('@');
    // Dönen sütunlar yalnız scope/key/n: kişi, IP veya kimlik sütunu yoktur.
    expect(Object.keys(after.rows[0] ?? {}).sort()).toEqual(['key', 'n', 'scope']);
  });
});
