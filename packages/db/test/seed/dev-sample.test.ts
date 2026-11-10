// @tk TK-29
// KK-P04b-13 (032 §11, KK-032-14 profil kapısı): `dev-sample-identity` 11 kullanıcı, örnek bürolar,
// bayi ve kupon, çok koltuklu deneme aboneliği + `trial_grant` yazar; ikinci uygulama yeni satır
// eklemez; `test` ortamında aşama seçilmez (development'ta seçilir); düz parola veritabanında yoktur
// ve özet sır dosyasındaki parolayla doğrulanır (gerçek giriş önkoşulu); platform hesaplarının parola
// kaydı yoktur. Seed bu dosyada açık işlem içinde uygulanır ve geri alınır (diğer dosyalar örnek dünya
// görmez; prod profili sayımı `seed.test.ts`'tedir).
import { readFileSync } from 'node:fs';
import { verify } from '@node-rs/argon2';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEV_SAMPLE_DOMAIN,
  devSampleIdentitySeed,
  SAMPLE_FIRM_SEATS,
  SAMPLE_USERS,
  sampleOrgId,
  sampleUserId,
} from '../../src/seed/dev/dev-sample-identity.ts';
import { seedsFor } from '../../src/seed/index.ts';
import { ownerDb, secretPath } from '../fixtures/db.ts';

let owner: pg.Client;

beforeAll(async () => {
  owner = await ownerDb();
});
afterAll(async () => {
  await owner.end();
});

const seed = devSampleIdentitySeed({
  passwordFile: secretPath('dev_seed_password'),
  kekFile: secretPath('kek_master'),
});

const n = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await owner.query<{ n: string }>(sql, params)).rows[0]?.n ?? -1);

describe('KK-P04b-13 (032 §11, KK-032-14): dev-sample-identity', () => {
  it('profil kapısı: test ortamında seçilmez, development ortamında seçilir; prod profilinde yok', () => {
    const names = (env: 'test' | 'development', p: 'dev' | 'prod') =>
      seedsFor(p, env).map((s) => s.name);
    expect(names('test', 'dev')).not.toContain('dev-sample-identity');
    expect(names('development', 'dev')).toContain('dev-sample-identity');
    expect(names('development', 'prod')).not.toContain('dev-sample-identity');
  });

  it('11 kullanıcı, örnek bürolar, bayi/kupon, abonelik + trial_grant; ikinci uygulama yeni satır eklemez', async () => {
    await owner.query('BEGIN');
    try {
      const first = await seed.apply(owner);
      expect(first.inserted).toBeGreaterThan(0);
      const emails = SAMPLE_USERS.map((u) => `${u.key}@${DEV_SAMPLE_DOMAIN}`);
      expect(
        await n('SELECT count(*) AS n FROM auth.users WHERE email = ANY($1::text[])', [emails]),
      ).toBe(11);
      expect(
        await n(
          `SELECT count(*) AS n FROM auth.users WHERE email = ANY($1::text[])
             AND (email_verified IS NOT TRUE OR name NOT LIKE 'Örnek %')`,
          [emails],
        ),
      ).toBe(0);
      expect(
        await n(
          `SELECT count(*) AS n FROM auth.organizations WHERE metadata = '{"sampleData":true}'`,
        ),
      ).toBeGreaterThanOrEqual(2);
      const firm = sampleOrgId('firm');
      expect(
        await n('SELECT count(*) AS n FROM auth.members WHERE organization_id = $1', [firm]),
      ).toBe(7);
      expect(
        await n(
          `SELECT count(*) AS n FROM auth.organizations WHERE id = $1 AND kind = 'firm'
             AND partner_code = 'ORNEK-BAYI'`,
          [firm],
        ),
      ).toBe(1);
      expect(await n("SELECT count(*) AS n FROM app.partners WHERE code = 'ORNEK-BAYI'")).toBe(1);
      expect(await n("SELECT count(*) AS n FROM app.coupons WHERE code = 'ORNEK-BARO'")).toBe(1);
      // Abonelik ve kredi FORCE RLS'li: sahip (eda_owner) bağsız göremez; jobs rolü kolon kısıtlı okur.
      await owner.query('ALTER TABLE app.subscriptions NO FORCE ROW LEVEL SECURITY');
      await owner.query('ALTER TABLE app.credit_ledger NO FORCE ROW LEVEL SECURITY');
      expect(
        await n(
          `SELECT count(*) AS n FROM app.subscriptions WHERE org_id = $1 AND status = 'trialing'
             AND seats = $2`,
          [firm, SAMPLE_FIRM_SEATS],
        ),
      ).toBe(1);
      expect(
        await n(
          `SELECT count(*) AS n FROM app.credit_ledger WHERE org_id = $1
             AND entry_type = 'trial_grant' AND amount = 30`,
          [firm],
        ),
      ).toBe(1);
      expect(
        await n(
          `SELECT count(*) AS n FROM auth.accounts a JOIN auth.users u ON u.id = a.user_id
           WHERE u.platform_role <> 'user' AND u.email = ANY($1::text[])`,
          [emails],
        ),
      ).toBe(0);
      const hash = (
        await owner.query<{ password: string }>(
          "SELECT password FROM auth.accounts WHERE user_id = $1 AND provider_id = 'credential'",
          [sampleUserId('owner')],
        )
      ).rows[0]?.password;
      expect(hash?.startsWith('$argon2id$')).toBe(true);
      const secret = readFileSync(secretPath('dev_seed_password'), 'utf8').trim();
      expect(await verify(hash ?? '', secret)).toBe(true);
      // Düz parola hiçbir kimlik/uygulama kolonunda yoktur.
      expect(await n('SELECT count(*) AS n FROM auth.accounts WHERE password = $1', [secret])).toBe(
        0,
      );
      const second = await seed.apply(owner);
      expect(second.inserted).toBe(0);
      expect(second.skipped).toBeGreaterThan(0);
    } finally {
      await owner.query('ROLLBACK');
    }
  });
});
