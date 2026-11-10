// @tk TK-26
// KK-P04a-12 (KK-045-4) önkoşulu: `app.email_enqueue` aynı `dedupe_key` ile tek satır; eda_app tabloya
// doğrudan yazamaz ve yalnız kendi kullanıcı bağı için kayıt açar; eda_worker satırı yönlendirme +
// alıcı bağlamıyla okur, kolon kısıtlı alıcı okuması yapar; `email_outbox.sweep` bayat/takılı/süresi
// geçen satırları işler. KK-P04a-11: süresi geçen satırın mühürlü parametresi açılmadan silinir.
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEmailRecipient } from '../../src/auth-read.ts';
import { enqueueEmailRow, lockDelivery, routeDelivery, updateDelivery } from '../../src/email.ts';
import { wrapJobsPool } from '../../src/jobs/db.ts';
import { runEmailOutboxSweep } from '../../src/jobs/email-outbox-sweep.ts';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { jobsDb, makePool, ownerDb, pgCode, workerDb } from '../fixtures/db.ts';
import { newWorldKey } from '../fixtures/ids.ts';
import { insertUser } from '../fixtures/tenant-world.ts';

let owner: pg.Client;
let appPool: pg.Pool;
let workerPool: pg.Pool;
let jobsPool: pg.Pool;
let asApp: TenantRunner;
let asWorker: TenantRunner;
let userA: string;
let userB: string;

beforeAll(async () => {
  owner = await ownerDb();
  appPool = makePool('eda_app');
  workerPool = makePool('eda_worker');
  jobsPool = makePool('eda_jobs');
  asApp = createTenantRunner(appPool);
  asWorker = createTenantRunner(workerPool);
  const key = newWorldKey();
  userA = await insertUser(owner, key, 'eposta-a');
  userB = await insertUser(owner, key, 'eposta-b');
});
afterAll(async () => {
  await owner.end();
  await appPool.end();
  await workerPool.end();
  await jobsPool.end();
});

const row = (
  userId: string,
  dedupeKey: string,
  over: Partial<Parameters<typeof enqueueEmailRow>[1]> = {},
) => ({
  kind: 'password_changed',
  template: 'password_changed',
  templateVersion: '2026-10-11.1',
  class: 'security' as const,
  userId,
  orgId: null,
  invitationId: null,
  dedupeKey,
  params: {},
  sealed: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  ...over,
});

describe('KK-P04a-12 (KK-045-4): app.email_enqueue', () => {
  it('aynı dedupe_key ile ikinci çağrı NULL döner; tek satır', async () => {
    const key = `test:${randomUUID()}`;
    const first = await asApp.withUserScope({ userId: userA }, (tx) =>
      enqueueEmailRow(tx, row(userA, key)),
    );
    const second = await asApp.withUserScope({ userId: userA }, (tx) =>
      enqueueEmailRow(tx, row(userA, key)),
    );
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBeNull();
    const n = await asWorker.withUserScope({ userId: userA }, (tx) =>
      tx.query('SELECT count(*)::int AS n FROM app.email_deliveries WHERE dedupe_key = $1', [key]),
    );
    expect(n.rows[0]?.n).toBe(1);
  });

  it('eda_app başka kullanıcı için kayıt açamaz ve tabloya doğrudan INSERT yapamaz', async () => {
    const err = await asApp
      .withUserScope({ userId: userA }, (tx) =>
        enqueueEmailRow(tx, row(userB, `test:${randomUUID()}`)),
      )
      .catch((e: unknown) => e);
    expect(pgCode(err).code).toBe('42501');
    const direct = await asApp
      .withUserScope({ userId: userA }, (tx) =>
        tx.query(
          `INSERT INTO app.email_deliveries (user_id, kind, template_code, template_version, class, dedupe_key, expires_at)
           VALUES ($1, 'x', 'x', 'x', 'security', $2, now())`,
          [userA, `test:${randomUUID()}`],
        ),
      )
      .catch((e: unknown) => e);
    expect(pgCode(direct).code).toBe('42501');
    const sel = await asApp
      .withUserScope({ userId: userA }, (tx) =>
        tx.query('SELECT id FROM app.email_deliveries LIMIT 1'),
      )
      .catch((e: unknown) => e);
    expect(pgCode(sel).code).toBe('42501');
  });

  it('parametreler nesne olmalı ve 2048 baytı aşamaz', async () => {
    const big = await asApp
      .withUserScope({ userId: userA }, (tx) =>
        enqueueEmailRow(
          tx,
          row(userA, `test:${randomUUID()}`, { params: { x: 'y'.repeat(4000) } }),
        ),
      )
      .catch((e: unknown) => e);
    expect(pgCode(big).code).toBe('22001');
  });
});

describe('KK-P04a-11: worker yönlendirme, alıcı bağlamı ve kolon kısıtları', () => {
  it('route -> withUserScope ile kilitli okuma, durum geçişi ve nihai durumda sealed NULL', async () => {
    const sealed = randomBytes(48);
    const id = await asApp.withUserScope({ userId: userA }, (tx) =>
      enqueueEmailRow(
        tx,
        row(userA, `test:${randomUUID()}`, {
          sealed,
          class: 'action',
          template: 'verify_email',
          kind: 'email_verification',
        }),
      ),
    );
    if (id === null) throw new Error('kayıt açılmadı');
    const route = await asWorker.withNoTenant('notification_route', (tx) => routeDelivery(tx, id));
    expect(route).toEqual({ userId: userA, orgId: null });
    // Bağsız worker satırı göremez (RLS alıcı bağı).
    const unbound = await asWorker.withNoTenant('notification_route', (tx) =>
      tx.query('SELECT id FROM app.email_deliveries WHERE id = $1', [id]),
    );
    expect(unbound.rowCount).toBe(0);
    await asWorker.withUserScope({ userId: userA }, async (tx) => {
      const d = await lockDelivery(tx, id);
      expect(d?.status).toBe('queued');
      expect(d?.sealedParams?.equals(sealed)).toBe(true);
      const r = await getEmailRecipient(tx, userA);
      expect(r?.email).toContain('@ornek.test');
      expect(r?.banned).toBe(false);
      await updateDelivery(tx, id, { status: 'sending' });
    });
    await asWorker.withUserScope({ userId: userA }, (tx) =>
      updateDelivery(tx, id, { status: 'sent', providerMessageId: 'test-1' }),
    );
    const after = await asWorker.withUserScope({ userId: userA }, (tx) =>
      tx.query('SELECT status, attempts, sealed_params FROM app.email_deliveries WHERE id = $1', [
        id,
      ]),
    );
    expect(after.rows[0]).toMatchObject({ status: 'sent', attempts: 1, sealed_params: null });
  });

  it('worker başka kullanıcının alıcı satırını ve sır kolonlarını okuyamaz', async () => {
    const other = await asWorker.withUserScope({ userId: userA }, (tx) =>
      getEmailRecipient(tx, userB),
    );
    expect(other).toBeNull();
    const w = await workerDb();
    try {
      for (const sql of [
        'SELECT password FROM auth.accounts LIMIT 1',
        'SELECT token FROM auth.sessions LIMIT 1',
        'SELECT value FROM auth.verifications LIMIT 1',
      ]) {
        const e = await w.query(sql).catch((err: unknown) => err);
        expect(pgCode(e).code, sql).toBe('42501');
      }
    } finally {
      await w.end();
    }
  });

  it('route fonksiyonu eda_app için kapalıdır', async () => {
    const e = await asApp
      .withNoTenant('notification_route', (tx) => routeDelivery(tx, randomUUID()))
      .catch((err: unknown) => err);
    expect(pgCode(e).code).toBe('42501');
  });
});

describe('KK-P04a-12, KK-P04a-11: email_outbox.sweep', () => {
  it('bayat queued döner, takılı sending queued olur, süresi geçen expired + sealed NULL', async () => {
    const mk = async (over: Partial<Parameters<typeof enqueueEmailRow>[1]> = {}) => {
      const id = await asApp.withUserScope({ userId: userA }, (tx) =>
        enqueueEmailRow(tx, row(userA, `test:${randomUUID()}`, over)),
      );
      if (id === null) throw new Error('kayıt açılmadı');
      return id;
    };
    const queued = await mk();
    const stuck = await mk();
    const soon = await mk({ sealed: randomBytes(40), expiresAt: new Date(Date.now() + 60_000) });
    await asWorker.withUserScope({ userId: userA }, (tx) =>
      updateDelivery(tx, stuck, { status: 'sending' }),
    );
    const db = wrapJobsPool(jobsPool);
    // Şimdi: hiçbiri bayat değil.
    const nowRun = await runEmailOutboxSweep(db, { staleMin: 2, batchSize: 10_000 });
    expect(nowRun.requeue.map((x) => x.id)).not.toContain(queued);
    // Sahte saat: 11 dk sonrası.
    const later = new Date(Date.now() + 11 * 60_000);
    const r = await runEmailOutboxSweep(db, { staleMin: 2, batchSize: 10_000, now: later });
    const ids = r.requeue.map((x) => x.id);
    expect(ids).toContain(queued);
    expect(ids).toContain(stuck);
    expect(ids).not.toContain(soon);
    expect(r.requeue.find((x) => x.id === queued)).toMatchObject({
      class: 'security',
      templateCode: 'password_changed',
    });
    const st = await asWorker.withUserScope({ userId: userA }, (tx) =>
      tx.query<{ id: string; status: string; sealed_params: Buffer | null }>(
        'SELECT id, status, sealed_params FROM app.email_deliveries WHERE id = ANY($1::uuid[])',
        [[stuck, soon]],
      ),
    );
    const by = new Map(st.rows.map((x) => [x.id, x]));
    expect(by.get(stuck)).toMatchObject({ status: 'queued' });
    expect(by.get(soon)).toMatchObject({ status: 'expired', sealed_params: null });
    const j = await jobsDb();
    try {
      const e = await j
        .query('SELECT sealed_params FROM app.email_deliveries LIMIT 1')
        .catch((x: unknown) => x);
      expect(pgCode(e).code).toBe('42501');
    } finally {
      await j.end();
    }
  });
});
