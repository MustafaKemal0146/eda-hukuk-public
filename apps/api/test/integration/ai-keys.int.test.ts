// @tk TK-04 TK-05
// #54 BYOK (gerçek PostgreSQL; `eda_app` çalıştırıcısı, RLS açık):
//  - büro anahtarı yalnız sahip/yönetici tarafından yazılır; avukat 403 benzeri `ORG_ROLE_INSUFFICIENT`
//  - şifreli kolonda düz metin yok; yanıt yalnız son 4 karakter; başka büro/kullanıcı göremez
//  - `resolve`: seçilen kaynağa göre çözer; anahtar yoksa eksik kaynak döner (sessiz düşme yok)
//  - reddedilen anahtar yazılmaz; denetim kaydına anahtar değeri girmez
import { randomBytes, randomUUID } from 'node:crypto';
import { wipe, wrapDek } from '@eda/crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAiKeysService } from '../../src/services/ai-keys/ai-keys.ts';
import { staticPlatformSettings } from '../../src/services/ai-keys/platform-settings.ts';

let db: TestingDb;
const KEK = { kek: Buffer.alloc(32, 5), kekVersion: 1 };
const w = {} as {
  orgA: string;
  orgB: string;
  owner: string;
  lawyer: string;
  other: string;
  bOwner: string;
};
const audits: { action: string; metadata?: unknown }[] = [];
let accepted = true;

const KEY1 = `sk-ant-${'A'.repeat(36)}wxyz`;
const KEY2 = `sk-ant-${'B'.repeat(36)}1234`;

const svc = () =>
  createAiKeysService({
    db: db.runner('eda_app'),
    kek: KEK,
    verify: async () => accepted,
    audit: async (e) => {
      audits.push({ action: e.action, metadata: e.metadata });
    },
    now: () => new Date('2026-10-14T10:00:00Z'),
  });

const actor = (orgId: string, userId: string, memberRole: 'owner' | 'admin' | 'lawyer') => ({
  orgId,
  userId,
  memberRole,
});

async function bootstrapOrg(orgId: string, ownerId: string): Promise<void> {
  const dek = randomBytes(32);
  const wrapped = wrapDek(KEK.kek, { orgId, dekVersion: 1, kekVersion: 1 }, dek);
  wipe(dek);
  await db.runner('eda_app').withTenant({ orgId, userId: ownerId }, async (tx) => {
    await tx.query('INSERT INTO app.org_settings (org_id) VALUES ($1)', [orgId]);
    await tx.query(
      'INSERT INTO app.org_keys (org_id, key_version, wrapped_dek, kek_version) VALUES ($1, 1, $2, 1)',
      [orgId, wrapped],
    );
  });
}

beforeAll(async () => {
  db = createTestingDb(inject('pg'));
  w.orgA = await db.auth.insertOrg('Örnek Büro A', 'firm');
  w.orgB = await db.auth.insertOrg('Örnek Büro B', 'firm');
  await db.auth.grantSeats(w.orgA, 5);
  await db.auth.grantSeats(w.orgB, 5);
  const mk = async (org: string, tag: string, role: string) => {
    const id = await db.auth.insertUser({
      name: `Örnek ${tag}`,
      email: `${tag}.${randomUUID().slice(0, 8)}@ornek.test`,
      emailVerified: true,
      verificationStatus: 'verified',
    });
    await db.auth.addMember(org, id, role);
    return id;
  };
  w.owner = await mk(w.orgA, 'sahip', 'owner');
  w.lawyer = await mk(w.orgA, 'avukat', 'lawyer');
  w.other = await mk(w.orgA, 'diger', 'lawyer');
  w.bOwner = await mk(w.orgB, 'bsahip', 'owner');
  await bootstrapOrg(w.orgA, w.owner);
  await bootstrapOrg(w.orgB, w.bOwner);
});

afterAll(async () => {
  await db.close();
});

const rawRow = (orgId: string, ownerId: string) =>
  db.runner('eda_app').withTenant({ orgId, userId: ownerId }, async (tx) => {
    const r = await tx.query(
      'SELECT ai_api_key_enc AS enc, ai_api_key_last4 AS last4 FROM app.org_settings WHERE org_id = $1',
      [orgId],
    );
    return r.rows[0] as { enc: Buffer | null; last4: string | null };
  });

describe('#54: büro anahtarı yazma', () => {
  it('sahip yazar: yanıt yalnız son 4 karakter; kolon şifreli, düz metin yok', async () => {
    accepted = true;
    const status = await svc().setOrgKey(actor(w.orgA, w.owner, 'owner'), KEY1);
    expect(status.org).toMatchObject({ configured: true, last4: 'wxyz' });
    expect(JSON.stringify(status)).not.toContain(KEY1);
    expect(JSON.stringify(status)).not.toContain('sk-ant');
    const row = await rawRow(w.orgA, w.owner);
    expect(row.enc).not.toBeNull();
    expect((row.enc as Buffer).includes(Buffer.from(KEY1))).toBe(false);
    expect((row.enc as Buffer).includes(Buffer.from('sk-ant'))).toBe(false);
    expect(row.last4).toBe('wxyz');
  });

  it('denetim kaydı alan adını ve değişikliği taşır, anahtar değerini taşımaz', async () => {
    const last = audits.at(-1);
    expect(last?.action).toBe('org.settings.changed');
    expect(JSON.stringify(last?.metadata)).toBe('{"field":"ai_api_key","change":"set"}');
    expect(JSON.stringify(audits)).not.toContain('sk-ant');
  });

  it('avukat büro anahtarını yazamaz ve silemez; kayıt değişmez', async () => {
    await expect(svc().setOrgKey(actor(w.orgA, w.lawyer, 'lawyer'), KEY2)).rejects.toMatchObject({
      code: 'ORG_ROLE_INSUFFICIENT',
    });
    await expect(svc().removeOrgKey(actor(w.orgA, w.lawyer, 'lawyer'))).rejects.toMatchObject({
      code: 'ORG_ROLE_INSUFFICIENT',
    });
    expect((await rawRow(w.orgA, w.owner)).last4).toBe('wxyz');
  });

  it('sağlayıcının reddettiği anahtar yazılmaz (422 api_key_rejected)', async () => {
    accepted = false;
    await expect(svc().setOrgKey(actor(w.orgA, w.owner, 'owner'), KEY2)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      reason: 'api_key_rejected',
    });
    accepted = true;
    expect((await rawRow(w.orgA, w.owner)).last4).toBe('wxyz');
  });
});

describe('#54: durum, kaynak seçimi ve çözüm', () => {
  it('büro anahtarı varken üye durumu görür (son 4); yönetme yetkisi role göre', async () => {
    const asLawyer = await svc().status(actor(w.orgA, w.lawyer, 'lawyer'));
    expect(asLawyer.org).toMatchObject({ configured: true, last4: 'wxyz' });
    expect(asLawyer.canManageOrg).toBe(false);
    expect(asLawyer.source).toBe('org');
    expect(asLawyer.usable).toBe(true);
    const asOwner = await svc().status(actor(w.orgA, w.owner, 'owner'));
    expect(asOwner.canManageOrg).toBe(true);
  });

  it('resolve: büro kaynağında anahtarın kendisini gerçekten geri verir', async () => {
    const r = await svc().resolve({ orgId: w.orgA, userId: w.lawyer });
    expect(r).toEqual({ apiKey: KEY1, source: 'org' });
  });

  it('DEK rotasyonundan sonra büro anahtarı hâlâ çözülür (yazıldığı sürümle)', async () => {
    const dek2 = randomBytes(32);
    const wrapped2 = wrapDek(KEK.kek, { orgId: w.orgA, dekVersion: 2, kekVersion: 1 }, dek2);
    wipe(dek2);
    // Rotasyon (bakım işi, eda_jobs yetkisiyle): eski sürüm `retiring` olur (sarmalı DEK korunur),
    // yeni sürüm tek `active` satırdır.
    await db.jobsQuery(
      "UPDATE app.org_keys SET status = 'retiring' WHERE org_id = $1 AND status = 'active'",
      [w.orgA],
    );
    await db.runner('eda_app').withTenant({ orgId: w.orgA, userId: w.owner }, async (tx) => {
      await tx.query(
        'INSERT INTO app.org_keys (org_id, key_version, wrapped_dek, kek_version) VALUES ($1, 2, $2, 1)',
        [w.orgA, wrapped2],
      );
    });
    expect(await svc().resolve({ orgId: w.orgA, userId: w.lawyer })).toEqual({
      apiKey: KEY1,
      source: 'org',
    });
  });

  it('başka büro anahtarı görmez: B bürosunda anahtar yok -> eksik (org)', async () => {
    expect(await svc().resolve({ orgId: w.orgB, userId: w.bOwner })).toEqual({ missing: 'org' });
    const st = await svc().status(actor(w.orgB, w.bOwner, 'owner'));
    expect(st.org.configured).toBe(false);
    expect(st.usable).toBe(false);
  });

  it('kendi anahtarını ekleyen kullanıcı kaynak seçebilir; diğerleri etkilenmez', async () => {
    const a = actor(w.orgA, w.lawyer, 'lawyer');
    // Kaynak "own" iken anahtar yoksa eksik döner (büro anahtarına sessiz düşme yok).
    await svc().setSource(a, 'own');
    expect(await svc().resolve({ orgId: w.orgA, userId: w.lawyer })).toEqual({ missing: 'own' });

    const st = await svc().setOwnKey(a, KEY2);
    expect(st.own).toMatchObject({ configured: true, last4: '1234' });
    expect(JSON.stringify(st)).not.toContain('sk-ant');
    expect(await svc().resolve({ orgId: w.orgA, userId: w.lawyer })).toEqual({
      apiKey: KEY2,
      source: 'own',
    });
    // Aynı bürodaki başka avukat hala büro anahtarını kullanır.
    expect(await svc().resolve({ orgId: w.orgA, userId: w.other })).toEqual({
      apiKey: KEY1,
      source: 'org',
    });
  });

  it('kişisel anahtarın şifreli kolonu düz metin içermez; başka kullanıcı okuyamaz (RLS)', async () => {
    const own = await db.runner('eda_app').withUserScope({ userId: w.lawyer }, async (tx) => {
      const r = await tx.query(
        'SELECT ai_api_key_enc AS enc FROM app.user_preferences WHERE user_id = $1',
        [w.lawyer],
      );
      return (r.rows[0] as { enc: Buffer }).enc;
    });
    expect(own.includes(Buffer.from(KEY2))).toBe(false);
    expect(own.includes(Buffer.from('sk-ant'))).toBe(false);
    const seen = await db.runner('eda_app').withUserScope({ userId: w.other }, async (tx) => {
      const r = await tx.query('SELECT 1 FROM app.user_preferences WHERE user_id = $1', [w.lawyer]);
      return r.rows.length;
    });
    expect(seen).toBe(0);
  });

  it('kendi anahtarını silen kullanıcı büro kaynağına döner', async () => {
    const st = await svc().removeOwnKey(actor(w.orgA, w.lawyer, 'lawyer'));
    expect(st.own.configured).toBe(false);
    expect(st.source).toBe('org');
    expect(await svc().resolve({ orgId: w.orgA, userId: w.lawyer })).toMatchObject({
      source: 'org',
    });
  });

  it('sahip büro anahtarını siler: eksik (org) döner ve denetim kaydı anahtar içermez', async () => {
    const st = await svc().removeOrgKey(actor(w.orgA, w.owner, 'owner'));
    expect(st.org.configured).toBe(false);
    expect(await svc().resolve({ orgId: w.orgA, userId: w.other })).toEqual({ missing: 'org' });
    expect(JSON.stringify(audits.at(-1)?.metadata)).toBe(
      '{"field":"ai_api_key","change":"removed"}',
    );
    expect((await rawRow(w.orgA, w.owner)).enc).toBeNull();
  });
});

describe('AS-0409: platform ortak anahtarı düşüşü (yalnız açık bayrakla)', () => {
  const PLATFORM = `sk-ant-test-${'P'.repeat(30)}plat`;
  const withPlatform = () =>
    createAiKeysService({
      db: db.runner('eda_app'),
      kek: KEK,
      verify: async () => true,
      audit: async () => undefined,
      now: () => new Date('2026-10-14T10:00:00Z'),
      platform: staticPlatformSettings({ apiKey: PLATFORM }),
    });

  it('bayrak kapalıyken (platform yok) anahtarsız büro/kullanıcı eksik döner; durum platform göstermez', async () => {
    expect(await svc().resolve({ orgId: w.orgB, userId: w.bOwner })).toEqual({ missing: 'org' });
    const st = await svc().status(actor(w.orgB, w.bOwner, 'owner'));
    expect(st).toMatchObject({ usable: false, effectiveSource: null, platformFallback: false });
  });

  it('bayrak açıkken anahtarsız büro kaynağı platform olur; yanıt anahtarı taşımaz', async () => {
    expect(await withPlatform().resolve({ orgId: w.orgB, userId: w.bOwner })).toEqual({
      apiKey: PLATFORM,
      source: 'platform',
    });
    const st = await withPlatform().status(actor(w.orgB, w.bOwner, 'owner'));
    expect(st).toMatchObject({ usable: true, effectiveSource: 'platform', platformFallback: true });
    expect(JSON.stringify(st)).not.toContain(PLATFORM);
    expect(JSON.stringify(st)).not.toContain('sk-ant');
  });

  it('kullanıcı kaynağı own ve anahtarı yoksa da platform (eksik değil) olur; kendi anahtarı önceliklidir', async () => {
    await svc().setSource(actor(w.orgB, w.bOwner, 'owner'), 'own');
    expect(await withPlatform().resolve({ orgId: w.orgB, userId: w.bOwner })).toMatchObject({
      source: 'platform',
    });
    expect(await svc().resolve({ orgId: w.orgB, userId: w.bOwner })).toEqual({ missing: 'own' });
    await svc().setOwnKey(actor(w.orgB, w.bOwner, 'owner'), KEY2);
    expect(await withPlatform().resolve({ orgId: w.orgB, userId: w.bOwner })).toEqual({
      apiKey: KEY2,
      source: 'own',
    });
  });
});
