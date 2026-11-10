// @tk TK-26
//  platform ayarı (0049): `app.platform_settings` tek satırlı tablo ve `app.admin_platform_*` /
// `app.platform_settings_runtime` fonksiyonları. Yazma/okuma yalnız super_admin'e açıktır; uygulama
// rolleri tabloya erişemez; şifreli değer yalnız runtime fonksiyonundan çıkar; denetim satırı anahtar,
// ad ve son 4 hane taşımaz; kısıtlar sınırları dayatır. Tek satır paylaşıldığından test sonunda sıfırlanır.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AdminDb, createAdminDb } from '../../src/admin.ts';
import { adminDb, appDb, jobsDb, makePool, ownerDb, pgCode } from '../fixtures/db.ts';
import { newWorldKey } from '../fixtures/ids.ts';
import { insertUser } from '../fixtures/tenant-world.ts';

let owner: pg.Client;
let jobs: pg.Client;
let rawAdmin: pg.Client;
let rawApp: pg.Client;
let admin: AdminDb;
let key: string;
let superId: string;
let supportId: string;
let memberId: string;
const LAST4 = 'Zq9x';
const LABEL = 'Ortak Claude anahtarı';

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => pgCode(e).code,
  );
const read = (sql: string, params: unknown[] = []) =>
  admin.withAdmin((tx) => tx.query(sql, params));
const write = (sql: string, params: unknown[] = []) =>
  admin.withAdminWrite((tx) => tx.query(sql, params));
const runtime = async () =>
  (await read('SELECT * FROM app.platform_settings_runtime()')).rows[0] as Record<string, unknown>;
const auditRows = (scope: string) =>
  jobs.query<{ m: string }>(
    `SELECT metadata::text AS m FROM app.audit_log
      WHERE action = 'system_setting.changed' AND target_type = 'platform_settings'
        AND metadata->>'scope' = $1 AND actor_id = $2 ORDER BY created_at`,
    [scope, superId],
  );

async function staff(tag: string, role: 'support' | 'super_admin'): Promise<string> {
  const r = await owner.query<{ id: string }>(
    `INSERT INTO auth.users (name, email, email_verified, platform_role, verification_status)
     VALUES ($1, $2, true, $3, 'verified') RETURNING id`,
    [`Örnek ${tag}`, `${tag}.${key}@ornek.test`, role],
  );
  return r.rows[0]?.id ?? '';
}

async function reset(): Promise<void> {
  await write('SELECT app.admin_platform_key_clear($1)', [superId]);
  await write('SELECT app.admin_platform_limits_set($1, NULL, NULL, NULL)', [superId]);
  await write('SELECT app.admin_platform_cap_set($1, NULL)', [superId]);
  await write('SELECT app.admin_platform_fallback_set($1, true)', [superId]);
}

beforeAll(async () => {
  owner = await ownerDb();
  jobs = await jobsDb();
  rawAdmin = await adminDb();
  rawApp = await appDb();
  admin = createAdminDb(makePool('eda_readonly_admin'));
  key = newWorldKey();
  superId = await staff('ps-super', 'super_admin');
  supportId = await staff('ps-destek', 'support');
  memberId = await insertUser(owner, key, 'ps-uye');
});
afterAll(async () => {
  await reset();
  await owner.end();
  await jobs.end();
  await rawAdmin.end();
  await rawApp.end();
  await admin.end();
});

describe('AS-0409 platform ayarı: aktör kapısı ve tablo erişimi', () => {
  it('support ve sıradan kullanıcı hiçbir platform_settings fonksiyonunu çalıştıramaz (42501)', async () => {
    const enc = randomBytes(40);
    for (const actor of [supportId, memberId]) {
      expect(
        await codeOf(read('SELECT * FROM app.admin_platform_settings_card($1)', [actor])),
      ).toBe('42501');
      expect(
        await codeOf(
          write('SELECT app.admin_platform_key_set($1, $2, $3, 1, $4, now())', [
            actor,
            enc,
            LAST4,
            LABEL,
          ]),
        ),
      ).toBe('42501');
      expect(
        await codeOf(write('SELECT app.admin_platform_key_label_set($1, $2)', [actor, LABEL])),
      ).toBe('42501');
      expect(await codeOf(write('SELECT app.admin_platform_key_clear($1)', [actor]))).toBe('42501');
      expect(
        await codeOf(write('SELECT app.admin_platform_fallback_set($1, false)', [actor])),
      ).toBe('42501');
      expect(
        await codeOf(write('SELECT app.admin_platform_limits_set($1, 10, NULL, NULL)', [actor])),
      ).toBe('42501');
      expect(await codeOf(write('SELECT app.admin_platform_cap_set($1, 5000000)', [actor]))).toBe(
        '42501',
      );
    }
  });

  it('uygulama, iş ve ham yönetim rolleri tabloya ve runtime fonksiyonuna erişemez', async () => {
    for (const c of [rawApp, rawAdmin, jobs]) {
      expect(await codeOf(c.query('SELECT key_enc FROM app.platform_settings'))).toBe('42501');
      expect(await codeOf(c.query('SELECT id FROM app.platform_settings'))).toBe('42501');
      expect(
        await codeOf(c.query('UPDATE app.platform_settings SET fallback_enabled = false')),
      ).toBe('42501');
    }
    // eda_owner RLS zorlandığından satır göremez (tohum satırı yalnız fonksiyonlarla okunur).
    expect((await owner.query('SELECT id FROM app.platform_settings')).rowCount).toBe(0);
    expect(await codeOf(rawApp.query('SELECT * FROM app.platform_settings_runtime()'))).toBe(
      '42501',
    );
    expect(
      await codeOf(rawApp.query('SELECT * FROM app.admin_platform_settings_card($1)', [superId])),
    ).toBe('42501');
  });
});

describe('AS-0409 platform ayarı: anahtar atama, ad, silme', () => {
  it('başlangıçta tek satır var, anahtar yok, düşüş açık, sınırlar varsayılan (NULL)', async () => {
    const c = (await read('SELECT * FROM app.admin_platform_settings_card($1)', [superId])).rows[0];
    expect(c).toMatchObject({
      has_key: false,
      key_label: null,
      key_last4: null,
      fallback_enabled: true,
      user_turns_per_day: null,
      user_tokens_per_day: null,
      org_daily_cap_micro_usd: null,
    });
  });

  it('atama şifreli değeri yazar; kart yalnız ad ve son4 verir; runtime şifreli değeri verir; denetim içeriksiz', async () => {
    const enc = randomBytes(48);
    const r = await write('SELECT app.admin_platform_key_set($1, $2, $3, 3, $4, now()) AS prev', [
      superId,
      enc,
      LAST4,
      LABEL,
    ]);
    expect(r.rows[0]).toEqual({ prev: false });
    const card = (await read('SELECT * FROM app.admin_platform_settings_card($1)', [superId]))
      .rows[0] as Record<string, unknown>;
    expect(card).toMatchObject({ has_key: true, key_label: LABEL, key_last4: LAST4 });
    expect(Object.keys(card)).not.toContain('key_enc');
    const rt = await runtime();
    expect(Buffer.compare(rt.key_enc as Buffer, enc)).toBe(0);
    expect(rt).toMatchObject({ key_version: 3, key_label: LABEL, key_last4: LAST4 });
    const audit = await auditRows('platform_ai_key');
    expect(audit.rows.at(-1)?.m).toContain('"change": "set"');
    for (const a of audit.rows) {
      expect(a.m).not.toContain(LAST4);
      expect(a.m).not.toContain(LABEL);
      expect(a.m).not.toContain(enc.toString('hex'));
    }
  });

  it('yeniden atama değiştirir (replaced); yalnız ad değişimi anahtarı korur', async () => {
    const enc = randomBytes(48);
    const r = await write('SELECT app.admin_platform_key_set($1, $2, $3, 3, $4, now()) AS prev', [
      superId,
      enc,
      'Ab12',
      'İkinci anahtar',
    ]);
    expect(r.rows[0]).toEqual({ prev: true });
    expect((await auditRows('platform_ai_key')).rows.at(-1)?.m).toContain('"change": "replaced"');
    await write('SELECT app.admin_platform_key_label_set($1, $2)', [superId, 'Yeni ad']);
    const rt = await runtime();
    expect(rt).toMatchObject({ key_label: 'Yeni ad', key_last4: 'Ab12' });
    expect(Buffer.compare(rt.key_enc as Buffer, enc)).toBe(0);
    expect((await auditRows('platform_ai_key')).rows.at(-1)?.m).toContain('"change": "renamed"');
  });

  it('geçersiz ad ve kayıt 22023; anahtar yokken ad değişimi P0002', async () => {
    const enc = randomBytes(40);
    for (const bad of ['ab', 'x'.repeat(61), '<b>ad</b>', 'ad\nsatır', '   ']) {
      expect(
        await codeOf(
          write('SELECT app.admin_platform_key_set($1, $2, $3, 1, $4, now())', [
            superId,
            enc,
            LAST4,
            bad,
          ]),
        ),
        bad,
      ).toBe('22023');
    }
    expect(
      await codeOf(
        write('SELECT app.admin_platform_key_set($1, $2, $3, 1, $4, now())', [
          superId,
          enc,
          'abc',
          LABEL,
        ]),
      ),
    ).toBe('22023');
    expect(
      await codeOf(
        write('SELECT app.admin_platform_key_set($1, $2, $3, 0, $4, now())', [
          superId,
          enc,
          LAST4,
          LABEL,
        ]),
      ),
    ).toBe('22023');
    await write('SELECT app.admin_platform_key_clear($1)', [superId]);
    expect(
      await codeOf(write('SELECT app.admin_platform_key_label_set($1, $2)', [superId, LABEL])),
    ).toBe('P0002');
  });

  it('silme anahtarı, adı ve son4 ü boşaltır; ikinci silme no-op (denetim eklenmez)', async () => {
    await write('SELECT app.admin_platform_key_set($1, $2, $3, 1, $4, now())', [
      superId,
      randomBytes(40),
      LAST4,
      LABEL,
    ]);
    const before = (await auditRows('platform_ai_key')).rowCount;
    expect(
      (await write('SELECT app.admin_platform_key_clear($1) AS done', [superId])).rows[0],
    ).toEqual({ done: true });
    expect(
      (await write('SELECT app.admin_platform_key_clear($1) AS done', [superId])).rows[0],
    ).toEqual({ done: false });
    expect(await runtime()).toMatchObject({
      key_enc: null,
      key_label: null,
      key_last4: null,
      key_version: null,
    });
    expect((await auditRows('platform_ai_key')).rowCount).toBe((before ?? 0) + 1);
  });
});

describe('AS-0409 platform ayarı: düşüş anahtarı ve limitler', () => {
  it('düşüş anahtarı değişince denetim yazılır (eski/yeni değer); aynı değer no-op', async () => {
    expect(
      (await write('SELECT app.admin_platform_fallback_set($1, false) AS ch', [superId])).rows[0],
    ).toEqual({ ch: true });
    expect(await runtime()).toMatchObject({ fallback_enabled: false });
    expect(
      (await write('SELECT app.admin_platform_fallback_set($1, false) AS ch', [superId])).rows[0],
    ).toEqual({ ch: false });
    const last = (await auditRows('platform_ai_fallback')).rows.at(-1)?.m ?? '';
    expect(last).toContain('"newValue": false');
    expect(last).toContain('"oldValue": true');
    await write('SELECT app.admin_platform_fallback_set($1, true)', [superId]);
    expect(await runtime()).toMatchObject({ fallback_enabled: true });
  });

  it('limitler yazılır, NULL varsayılana döner; sınır dışı değer 22023', async () => {
    await write('SELECT app.admin_platform_limits_set($1, 75, 500000, 4000000)', [superId]);
    expect(await runtime()).toMatchObject({
      user_turns_per_day: 75,
      user_tokens_per_day: '500000',
      org_daily_cap_micro_usd: '4000000',
    });
    expect((await auditRows('platform_ai_limits')).rows.at(-1)?.m).toContain('"turns": 75');
    await write('SELECT app.admin_platform_limits_set($1, NULL, NULL, NULL)', [superId]);
    expect(await runtime()).toMatchObject({
      user_turns_per_day: null,
      user_tokens_per_day: null,
      org_daily_cap_micro_usd: null,
    });
    for (const args of [
      [0, null, null],
      [10001, null, null],
      [null, 999, null],
      [null, 100000001, null],
      [null, null, 99999],
      [null, null, 10000000001],
    ]) {
      expect(
        await codeOf(
          write('SELECT app.admin_platform_limits_set($1, $2, $3, $4)', [superId, ...args]),
        ),
        JSON.stringify(args),
      ).toBe('22023');
    }
  });

  it('KK-PLATFORM-TAVAN: platform günlük tavanı yazılır, kart ve runtime döndürür, aynı değer no-op, NULL varsayılana döner; sınır dışı 22023', async () => {
    const card = async () =>
      (await read('SELECT * FROM app.admin_platform_settings_card($1)', [superId])).rows[0];
    expect(await card()).toMatchObject({ platform_daily_cap_micro_usd: null });
    expect(
      (await write('SELECT app.admin_platform_cap_set($1, 250000000) AS ch', [superId])).rows[0],
    ).toEqual({ ch: true });
    expect(await runtime()).toMatchObject({ platform_daily_cap_micro_usd: '250000000' });
    expect(await card()).toMatchObject({ platform_daily_cap_micro_usd: '250000000' });
    const n = (await auditRows('platform_ai_cap')).rows.length;
    // Değişmeyen değer denetim satırı yazmaz.
    expect(
      (await write('SELECT app.admin_platform_cap_set($1, 250000000) AS ch', [superId])).rows[0],
    ).toEqual({ ch: false });
    expect((await auditRows('platform_ai_cap')).rows).toHaveLength(n);
    const last = (await auditRows('platform_ai_cap')).rows.at(-1)?.m ?? '';
    expect(last).toContain('"newValue": 250000000');
    expect(last).toContain('"oldValue": null');
    await write('SELECT app.admin_platform_cap_set($1, NULL)', [superId]);
    expect(await runtime()).toMatchObject({ platform_daily_cap_micro_usd: null });
    for (const v of [0, 999999, 100000000001]) {
      expect(
        await codeOf(write('SELECT app.admin_platform_cap_set($1, $2)', [superId, v])),
        `${v}`,
      ).toBe('22023');
    }
    // Uygulama rolü yeni fonksiyonları çalıştıramaz.
    expect(
      await codeOf(rawApp.query('SELECT app.admin_platform_cap_set($1, 5000000)', [superId])),
    ).toBe('42501');
  });

  it('tablo kısıtları: ikinci satır, yarım anahtar ve sınır dışı değer doğrudan reddedilir (sahip yetkisiyle)', async () => {
    // Sahip RLS'ten geçemez; kısıtlar yine de şemada bulunur.
    const cons = await owner.query<{ c: string }>(
      `SELECT conname AS c FROM pg_constraint WHERE conrelid = 'app.platform_settings'::regclass AND contype = 'c'`,
    );
    expect(cons.rows.map((x) => x.c).sort()).toEqual([
      'platform_settings_key_chk',
      'platform_settings_label_chk',
      'platform_settings_limits_chk',
      'platform_settings_platform_cap_chk',
      'platform_settings_singleton_chk',
    ]);
  });
});
