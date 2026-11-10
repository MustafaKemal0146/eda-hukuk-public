// @tk TK-05
// P04b DB yarısı (042 §4.3; 002 §9 "Büro, koltuk ve davet fonksiyonları"):
//  KK-P04b-1  (KK-042-9)  kapasitesi 1 kalan büroya iki ayrı bağlantıdan eşzamanlı INSERT: biri başarılı,
//                          diğeri EDA01; askıdaki üye koltuk tutar, silinen tutmaz; abonelik yokken 1.
//  KK-P04b-11 (KK-042-16) platform personeli üye yapılamaz (tetikleyici, eda_auth dahil).
//  app.org_seat_usage erişim sınırı, app.mark_profile_invitation_source ve email_enqueue davet dalı.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getInvitationRecipient } from '../../src/auth-read.ts';
import { enqueueEmailRow, lockDelivery } from '../../src/email.ts';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { authDb, makePool, ownerDb, pgCode } from '../fixtures/db.ts';
import { newWorldKey, shortKey } from '../fixtures/ids.ts';
import { grantSeats } from '../fixtures/seats.ts';
import { addMember, insertOrg, insertUser } from '../fixtures/tenant-world.ts';

let owner: pg.Client;
let appPool: pg.Pool;
let workerPool: pg.Pool;
let asApp: TenantRunner;
let asWorker: TenantRunner;

beforeAll(async () => {
  owner = await ownerDb();
  appPool = makePool('eda_app');
  workerPool = makePool('eda_worker');
  asApp = createTenantRunner(appPool);
  asWorker = createTenantRunner(workerPool);
});
afterAll(async () => {
  await owner.end();
  await appPool.end();
  await workerPool.end();
});

const key = () => shortKey(newWorldKey());

async function memberCount(orgId: string): Promise<number> {
  const r = await owner.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM auth.members WHERE organization_id = $1',
    [orgId],
  );
  return r.rows[0]?.n ?? -1;
}

async function invite(orgId: string, inviter: string, email: string, role = 'lawyer') {
  const r = await owner.query<{ id: string }>(
    `INSERT INTO auth.invitations (organization_id, email, role, status, expires_at, inviter_id)
     VALUES ($1, $2, $3, 'pending', now() + interval '72 hours', $4) RETURNING id`,
    [orgId, email, role, inviter],
  );
  return r.rows[0]?.id ?? '';
}

async function emailOf(userId: string): Promise<string> {
  const r = await owner.query<{ email: string }>('SELECT email FROM auth.users WHERE id = $1', [
    userId,
  ]);
  return r.rows[0]?.email ?? '';
}

describe('KK-P04b-1 (KK-042-9): koltuk tetikleyicisi', () => {
  it('abonelik yokken kapasite 1: ikinci üye EDA01 ile reddedilir', async () => {
    const k = key();
    const org = await insertOrg(owner, k, 'Tek Koltuk');
    const a = await insertUser(owner, k, 'birinci');
    const b = await insertUser(owner, k, 'ikinci');
    await addMember(owner, org, a, 'owner');
    await expect(addMember(owner, org, b, 'lawyer')).rejects.toMatchObject({ code: 'EDA01' });
    expect(await memberCount(org)).toBe(1);
  });

  it('kapasitesi 1 kalan büroya iki eşzamanlı ekleme: yalnız biri başarılı, diğeri EDA01', async () => {
    for (let round = 0; round < 5; round += 1) {
      const k = key();
      const org = await insertOrg(owner, k, 'Yaris');
      await grantSeats(owner, org, 2);
      const o = await insertUser(owner, k, 'sahip');
      const x = await insertUser(owner, k, 'aday1');
      const y = await insertUser(owner, k, 'aday2');
      await addMember(owner, org, o, 'owner');
      const c1 = await authDb();
      const c2 = await authDb();
      try {
        await c1.query('BEGIN');
        await c2.query('BEGIN');
        const insert = (c: pg.Client, u: string) =>
          c
            .query(
              `INSERT INTO auth.members (organization_id, user_id, role) VALUES ($1, $2, 'lawyer')`,
              [org, u],
            )
            .then(
              () => 'ok' as const,
              (e: unknown) => pgCode(e).code ?? 'err',
            );
        const first = await insert(c1, x);
        // İkinci bağlantı abonelik satırı kilidinde bekler; birinci commit edince sayım güncel olur.
        const second = insert(c2, y);
        await new Promise((r) => setTimeout(r, 100));
        await c1.query('COMMIT');
        const res2 = await second;
        await c2.query(res2 === 'ok' ? 'COMMIT' : 'ROLLBACK');
        expect([first, res2]).toEqual(['ok', 'EDA01']);
        expect(await memberCount(org)).toBe(2);
      } finally {
        await c1.end();
        await c2.end();
      }
    }
  });

  it('askıdaki üye koltuk tutar, silinen üye tutmaz', async () => {
    const k = key();
    const org = await insertOrg(owner, k, 'Aski');
    await grantSeats(owner, org, 2);
    const o = await insertUser(owner, k, 'sahip');
    const s = await insertUser(owner, k, 'askida');
    const n = await insertUser(owner, k, 'yeni');
    await addMember(owner, org, o, 'owner');
    await addMember(owner, org, s, 'lawyer', 'suspended');
    await expect(addMember(owner, org, n, 'lawyer')).rejects.toMatchObject({ code: 'EDA01' });
    await owner.query('DELETE FROM auth.members WHERE organization_id = $1 AND user_id = $2', [
      org,
      s,
    ]);
    await addMember(owner, org, n, 'lawyer');
    expect(await memberCount(org)).toBe(2);
  });

  it('plans.seat_max abonelik koltuğunu sınırlar (LEAST)', async () => {
    const k = key();
    const org = await insertOrg(owner, k, 'Deneme');
    await owner.query('BEGIN');
    await owner.query('ALTER TABLE app.subscriptions NO FORCE ROW LEVEL SECURITY');
    await owner.query(
      `INSERT INTO app.subscriptions (org_id, plan_code, status, provider, seats)
       VALUES ($1, 'trial', 'trialing', 'manual', 5)`,
      [org],
    );
    await owner.query('ALTER TABLE app.subscriptions FORCE ROW LEVEL SECURITY');
    await owner.query('COMMIT');
    const o = await insertUser(owner, k, 'sahip');
    const b = await insertUser(owner, k, 'ikinci');
    await addMember(owner, org, o, 'owner');
    await expect(addMember(owner, org, b, 'lawyer')).rejects.toMatchObject({ code: 'EDA01' });
  });
});

describe('KK-P04b-11 (KK-042-16): platform personeli büro üyesi yapılamaz', () => {
  it('support ve super_admin hesabı eda_auth ile de üye olamaz (23514)', async () => {
    const k = key();
    const org = await insertOrg(owner, k, 'Personel');
    await grantSeats(owner, org);
    for (const role of ['support', 'super_admin']) {
      const u = await insertUser(owner, k, `personel${role}`);
      await owner.query('UPDATE auth.users SET platform_role = $2 WHERE id = $1', [u, role]);
      const c = await authDb();
      try {
        const err = await c
          .query(
            `INSERT INTO auth.members (organization_id, user_id, role) VALUES ($1, $2, 'lawyer')`,
            [org, u],
          )
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(pgCode(err).code).toBe('23514');
      } finally {
        await c.end();
      }
    }
  });
});

describe('P04b: app.org_seat_usage erişim sınırı', () => {
  it('etkin üye aktif büro bağıyla okur; üye olmayan 42501; davetli kullanıcı bağıyla okur', async () => {
    const k = key();
    const org = await insertOrg(owner, k, 'Kullanim');
    await grantSeats(owner, org, 4);
    const o = await insertUser(owner, k, 'sahip');
    const out = await insertUser(owner, k, 'yabanci');
    const invited = await insertUser(owner, k, 'davetli');
    await addMember(owner, org, o, 'owner');
    await invite(org, o, await emailOf(invited));
    const usage = await asApp.withTenant({ orgId: org, userId: o }, async (tx) => {
      const r = await tx.query('SELECT * FROM app.org_seat_usage($1)', [org]);
      return r.rows[0];
    });
    expect(usage).toEqual({ capacity: 4, used: 1, pending_invitations: 1 });
    await expect(
      asApp.withUserScope({ userId: out }, (tx) =>
        tx.query('SELECT * FROM app.org_seat_usage($1)', [org]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const viaInvite = await asApp.withUserScope({ userId: invited }, async (tx) => {
      const r = await tx.query('SELECT * FROM app.org_seat_usage($1)', [org]);
      return r.rows[0];
    });
    expect(viaInvite).toEqual({ capacity: 4, used: 1, pending_invitations: 1 });
  });
});

describe('P04b: davetle meslek profili kaynağı ve davet e-postası dalı', () => {
  it('mark_profile_invitation_source yalnız kendi adresine gelen meslek rolü davetinde yazar', async () => {
    const k = key();
    const org = await insertOrg(owner, k, 'Profil');
    const o = await insertUser(owner, k, 'sahip');
    const u = await insertUser(owner, k, 'avukat');
    const other = await insertUser(owner, k, 'baska');
    await addMember(owner, org, o, 'owner');
    const invLawyer = await invite(org, o, await emailOf(u), 'lawyer');
    const invOther = await invite(org, o, await emailOf(other), 'lawyer');
    await asApp.withUserScope({ userId: u }, (tx) =>
      tx.query(
        `INSERT INTO app.lawyer_profiles (user_id, baro, sicil_no) VALUES ($1, 'Ankara Barosu', $2)`,
        [u, `S${k.slice(0, 8)}`],
      ),
    );
    const mark = (inv: string) =>
      asApp.withUserScope({ userId: u }, async (tx) => {
        const r = await tx.query<{ ok: boolean }>(
          'SELECT app.mark_profile_invitation_source($1) AS ok',
          [inv],
        );
        return r.rows[0]?.ok;
      });
    expect(await mark(invOther)).toBe(false);
    expect(await mark(randomUUID())).toBe(false);
    expect(await mark(invLawyer)).toBe(true);
    // İkinci çağrı değişiklik yapmaz (kaynak zaten yazılı).
    expect(await mark(invLawyer)).toBe(false);
    const p = await asApp.withUserScope({ userId: u }, (tx) =>
      tx.query<{ verification_source: string | null }>(
        'SELECT verification_source FROM app.lawyer_profiles WHERE user_id = $1',
        [u],
      ),
    );
    expect(p.rows[0]?.verification_source).toBe('org_invitation');
  });

  it('davet e-postası yalnız davet edenin oturumunda açılır; worker adresi davet edenin bağlamında okur', async () => {
    const k = key();
    const org = await insertOrg(owner, k, 'Davet');
    const o = await insertUser(owner, k, 'sahip');
    const stranger = await insertUser(owner, k, 'yabanci');
    await addMember(owner, org, o, 'owner');
    const email = `davetli.${k}@ornek.test`;
    const inv = await invite(org, o, email);
    const row = (userId: string) => ({
      kind: 'invitation',
      template: 'invitation',
      templateVersion: '2026-10-11.1',
      class: 'action' as const,
      userId,
      orgId: null,
      invitationId: inv,
      dedupeKey: `invitation:${randomUUID()}`,
      params: { role: 'lawyer', expiresInHours: 72 },
      sealed: Buffer.from('mühür-örnek'),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await expect(
      asApp.withUserScope({ userId: stranger }, (tx) => enqueueEmailRow(tx, row(stranger))),
    ).rejects.toMatchObject({ code: '42501' });
    const id = await asApp.withUserScope({ userId: o }, (tx) => enqueueEmailRow(tx, row(o)));
    expect(id).not.toBeNull();
    const seen = await asWorker.withUserScope({ userId: o }, async (tx) => ({
      delivery: await lockDelivery(tx, id ?? ''),
      recipient: await getInvitationRecipient(tx, inv),
    }));
    expect(seen.delivery?.invitationId).toBe(inv);
    expect(seen.recipient?.email).toBe(email);
    expect(seen.recipient?.status).toBe('pending');
    const foreign = await asWorker.withUserScope({ userId: stranger }, (tx) =>
      getInvitationRecipient(tx, inv),
    );
    expect(foreign).toBeNull();
  });
});
