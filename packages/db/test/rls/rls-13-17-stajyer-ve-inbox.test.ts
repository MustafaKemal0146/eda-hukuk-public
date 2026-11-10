// @tk TK-01
// KK-P03c-1 (KK-031-3): RLS-13…RLS-17 — stajyer denetimi (`trainee_supervision` kapalı/açık, tek yönlü,
// yalnız owner/admin/senior_lawyer, yalnız okuma) ve inbox evrakı (yalnız yükleyen; dava taşıması).
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { makePool, ownerDb } from '../fixtures/db.ts';
import { codeOf } from '../fixtures/rls-helpers.ts';
import { createRlsWorld, type RlsWorld } from '../fixtures/rls-world.ts';

let owner: pg.Client;
let ownerPool: pg.Pool;
let appPool: pg.Pool;
let asApp: TenantRunner;
let w: RlsWorld;

beforeAll(async () => {
  owner = await ownerDb();
  ownerPool = makePool('eda_owner');
  appPool = makePool('eda_app');
  asApp = createTenantRunner(appPool);
  w = await createRlsWorld(owner, createTenantRunner(ownerPool));
});
afterAll(async () => {
  await owner.end();
  await ownerPool.end();
  await appPool.end();
});

const seen = (userId: string, sql: string, params: unknown[]): Promise<number> =>
  asApp.withTenant(
    { orgId: w.orgA, userId },
    async (tx) => (await tx.query(sql, params)).rowCount ?? 0,
  );

const convRows = (userId: string, convId: string) =>
  seen(userId, 'SELECT id FROM app.conversations WHERE id = $1', [convId]);

/** Büro ayarını a_admin (OA) olarak değiştirir. */
async function setSupervision(on: boolean): Promise<void> {
  const n = await asApp.withTenant({ orgId: w.orgA, userId: w.users.a_admin }, async (tx) => {
    const r = await tx.query(
      'UPDATE app.org_settings SET trainee_supervision = $1 WHERE org_id = $2',
      [on, w.orgA],
    );
    return r.rowCount;
  });
  expect(n).toBe(1);
}

describe('KK-P03c-1: RLS-13…RLS-17 stajyer denetimi ve inbox', () => {
  it('RLS-13: a_senior @A, trainee_supervision=false — conv_trainee, doc_trainee 0', async () => {
    await setSupervision(false);
    expect([
      await convRows(w.users.a_senior, w.conv_trainee),
      await seen(w.users.a_senior, 'SELECT id FROM app.documents WHERE id = $1', [w.doc_trainee]),
    ]).toEqual([0, 0]);
  });

  it('RLS-14: a_senior @A, trainee_supervision=true — conv_trainee ve mesajları görünür; UPDATE 0 satır', async () => {
    await setSupervision(true);
    const u = w.users;
    expect(await convRows(u.a_senior, w.conv_trainee)).toBe(1);
    expect(
      await seen(u.a_senior, 'SELECT id FROM app.messages WHERE conversation_id = $1', [
        w.conv_trainee,
      ]),
    ).toBeGreaterThan(0);
    expect(
      await seen(u.a_senior, 'SELECT id FROM app.documents WHERE id = $1', [w.doc_trainee]),
    ).toBe(1);
    const updated = await asApp.withTenant({ orgId: w.orgA, userId: u.a_senior }, async (tx) => {
      const r = await tx.query(
        "UPDATE app.conversations SET title = 'Örnek veri denetim' WHERE id = $1",
        [w.conv_trainee],
      );
      return r.rowCount;
    });
    expect(updated).toBe(0);
  });

  it("RLS-15: a_trainee @A, trainee_supervision=true — a_senior'ın özel sohbeti 0 (denetim tek yönlü)", async () => {
    expect(await convRows(w.users.a_trainee, w.conv_senior_private)).toBe(0);
  });

  it('RLS-16: a_lawyer1 @A, trainee_supervision=true — conv_trainee 0 (lawyer denetleyemez)', async () => {
    expect(await convRows(w.users.a_lawyer1, w.conv_trainee)).toBe(0);
  });

  it("RLS-17: file_inbox_l1 — a_lawyer2 0 / a_lawyer1 1; case_A_restricted'e taşıma başarılı, case_B'ye hata", async () => {
    const u = w.users;
    const fileRows = (userId: string) =>
      seen(userId, 'SELECT id FROM app.files WHERE id = $1', [w.file_inbox_l1]);
    expect([await fileRows(u.a_lawyer2), await fileRows(u.a_lawyer1)]).toEqual([0, 1]);
    const toB = asApp.withTenant({ orgId: w.orgA, userId: u.a_lawyer1 }, (tx) =>
      tx.query('UPDATE app.files SET case_id = $1, inbox_expires_at = NULL WHERE id = $2', [
        w.case_B,
        w.file_inbox_l1,
      ]),
    );
    expect(await codeOf(toB)).toBe('42501');
    const moved = await asApp.withTenant({ orgId: w.orgA, userId: u.a_lawyer1 }, async (tx) => {
      const r = await tx.query(
        'UPDATE app.files SET case_id = $1, inbox_expires_at = NULL WHERE id = $2',
        [w.case_A_restricted, w.file_inbox_l1],
      );
      return r.rowCount;
    });
    expect(moved).toBe(1);
    // Taşındıktan sonra dava ekibi (a_lawyer2) görür; ekipte olmayan a_admin görmez.
    expect([await fileRows(u.a_lawyer2), await fileRows(u.a_admin)]).toEqual([1, 0]);
  });
});
