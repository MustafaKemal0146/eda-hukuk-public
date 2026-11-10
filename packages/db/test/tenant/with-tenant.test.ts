// @tk TK-01
// withTenant sözleşmesi (031 §4; KK-031-5, RLS-25): üye olmayan büroda `fn` hiç çağrılmaz
// (ORG_NOT_MEMBER), iç içe çağrı hata, işlem sonrası bağlantıda kiracı bağı kalmaz, afterCommit
// yalnız commit sonrası çalışır, 40001/40P01 bir kez yeniden denenir, yavaş işlem içeriksiz uyarılır.
import { AppError } from '@eda/contracts/errors';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createTenantRunner,
  type TenantLogEntry,
  TenantNestingError,
  type TenantRunner,
  type TenantTx,
  TenantTxClosedError,
} from '../../src/tenant.ts';
import { makePool, ownerDb } from '../fixtures/db.ts';
import { createTenantWorld, type TenantWorld } from '../fixtures/tenant-world.ts';

let owner: pg.Client;
let ownerPool: pg.Pool;
let appPool: pg.Pool;
let asApp: TenantRunner;
let w: TenantWorld;

beforeAll(async () => {
  owner = await ownerDb();
  ownerPool = makePool('eda_owner');
  appPool = makePool('eda_app', 1);
  asApp = createTenantRunner(appPool);
  w = await createTenantWorld(owner, createTenantRunner(ownerPool));
});
afterAll(async () => {
  await owner.end();
  await ownerPool.end();
  await appPool.end();
});

describe('KK-P03b-20 (KK-031-5): withTenant sözleşmesi', () => {
  it('üyesi olunmayan büroda fn hiç çağrılmadan ORG_NOT_MEMBER', async () => {
    const fn = vi.fn(async () => 'çalışmamalı');
    const err = await asApp
      .withTenant({ orgId: w.orgB, userId: w.aLawyer1 }, fn)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('ORG_NOT_MEMBER');
    expect(fn).not.toHaveBeenCalled();
  });

  it('geçersiz uuid VALIDATION_FAILED; veritabanına gidilmez', async () => {
    const connect = vi.fn(async () => {
      throw new Error('bağlantı açılmamalı');
    });
    const runner = createTenantRunner({ connect } as unknown as pg.Pool);
    const err = await runner
      .withTenant({ orgId: 'gecersiz', userId: w.aLawyer1 }, async () => 1)
      .catch((e: unknown) => e);
    expect((err as AppError).code).toBe('VALIDATION_FAILED');
    expect((err as AppError).fields).toEqual([{ path: 'orgId', issue: 'invalid_uuid' }]);
    expect(connect).not.toHaveBeenCalled();
  });

  it('iç içe withTenant / withUserScope / withNoTenant hata fırlatır', async () => {
    const other = createTenantRunner(ownerPool);
    const nested = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async () => {
      await other.withNoTenant('health', async () => 1);
    });
    await expect(nested).rejects.toBeInstanceOf(TenantNestingError);
    const nestedUser = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async () =>
      other.withUserScope({ userId: w.aLawyer1 }, async () => 1),
    );
    await expect(nestedUser).rejects.toBeInstanceOf(TenantNestingError);
  });

  it('RLS-25: işlem sonrası aynı fiziksel bağlantıda app.org_id ve app.user_id boş (havuz sızıntısı yok)', async () => {
    const pids = new Set<number>();
    const role = await asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async (tx, r) => {
      const res = await tx.query<{ pid: number; org: string }>(
        "SELECT pg_backend_pid() AS pid, current_setting('app.org_id', true) AS org",
      );
      pids.add(res.rows[0]?.pid ?? 0);
      expect(res.rows[0]?.org).toBe(w.orgA);
      return r;
    });
    expect(role).toBe('lawyer');
    const after = await appPool.query<{ pid: number; org: string | null; usr: string | null }>(
      "SELECT pg_backend_pid() AS pid, current_setting('app.org_id', true) AS org, current_setting('app.user_id', true) AS usr",
    );
    expect(pids.has(after.rows[0]?.pid ?? -1)).toBe(true);
    expect([after.rows[0]?.org ?? '', after.rows[0]?.usr ?? '']).toEqual(['', '']);
  });

  it('afterCommit commit sonrası çalışır, geri almada çalışmaz', async () => {
    const calls: string[] = [];
    await asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async (tx) => {
      tx.afterCommit(() => {
        calls.push('commit');
      });
      calls.push('fn');
    });
    expect(calls).toEqual(['fn', 'commit']);
    const failing = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async (tx) => {
      tx.afterCommit(() => {
        calls.push('rollback-sonrasi');
      });
      throw new Error('örnek hata');
    });
    await expect(failing).rejects.toThrow('örnek hata');
    expect(calls).toEqual(['fn', 'commit']);
  });

  it('tx işlem kapandıktan sonra kullanılamaz', async () => {
    let leaked: TenantTx | undefined;
    await asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async (tx) => {
      leaked = tx;
    });
    expect(() => leaked?.query('SELECT 1')).toThrow(TenantTxClosedError);
  });

  it('40001 bir kez yeniden denenir; ikinci hata yayılır', async () => {
    let attempts = 0;
    const res = await asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('serileştirme'), { code: '40001' });
      return 'tamam';
    });
    expect([res, attempts]).toEqual(['tamam', 2]);
    let again = 0;
    const fail = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async () => {
      again += 1;
      throw Object.assign(new Error('kilitlenme'), { code: '40P01' });
    });
    await expect(fail).rejects.toThrow('kilitlenme');
    expect(again).toBe(2);
  });

  it('2 sn üstü işlem yalnız label, süre ve requestId ile uyarılır', async () => {
    const entries: TenantLogEntry[] = [];
    let t = 0;
    const runner = createTenantRunner(appPool, {
      logger: { write: (e) => entries.push(e) },
      now: () => {
        t += 2500;
        return t;
      },
    });
    await runner.withTenant(
      { orgId: w.orgA, userId: w.aLawyer1, requestId: 'istek-1' },
      async () => undefined,
      { label: 'kk-yavas' },
    );
    expect(entries).toEqual([
      { level: 'warn', event: 'db.tx.slow', label: 'kk-yavas', ms: 2500, requestId: 'istek-1' },
    ]);
  });

  it('withUserScope yalnız kullanıcı bağı kurar: current_org_id NULL, E tablolar 0, kullanıcı tablosu ME', async () => {
    const res = await asApp.withUserScope({ userId: w.aLawyer1 }, async (tx) => {
      await tx.query('INSERT INTO app.user_preferences (user_id) VALUES ($1)', [w.aLawyer1]);
      const r = await tx.query<{ org: string | null; usr: string; cases: string; prefs: string }>(
        `SELECT app.current_org_id() AS org, app.current_user_id() AS usr,
                (SELECT count(*) FROM app.cases) AS cases,
                (SELECT count(*) FROM app.user_preferences) AS prefs`,
      );
      return r.rows[0];
    });
    expect(res).toEqual({ org: null, usr: w.aLawyer1, cases: '0', prefs: '1' });
  });
});
