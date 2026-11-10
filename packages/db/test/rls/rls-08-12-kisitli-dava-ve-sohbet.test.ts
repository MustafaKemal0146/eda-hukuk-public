// @tk TK-01
// KK-P03c-1 (KK-031-3): RLS-08…RLS-12 — kısıtlı dava ekibi, yöneticinin kısıtlı veriye erişememesi,
// ekipten çıkarma, oluşturan kuralı, paylaşılan sohbet (031 §12). Ekip değiştiren RLS-10/RLS-11 en
// sonda koşar (aynı dünyada RLS-12 ekip üyeliğine dayanır).
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { makePool, ownerDb } from '../fixtures/db.ts';
import { removeCaseMember } from '../fixtures/factories.ts';
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

/** Kullanıcının @A bağlamında `sql` sorgusuyla gördüğü satır sayısı. */
const seen = (userId: string, sql: string, params: unknown[]): Promise<number> =>
  asApp.withTenant(
    { orgId: w.orgA, userId },
    async (tx) => (await tx.query(sql, params)).rowCount ?? 0,
  );

const caseRows = (userId: string) =>
  seen(userId, 'SELECT id FROM app.cases WHERE id = $1', [w.case_A_restricted]);

describe('KK-P03c-1: RLS-08…RLS-12 kısıtlı dava ve sohbet', () => {
  it('RLS-08: case_A_restricted SELECT — a_lawyer2 1 / a_admin 0 / a_owner 0 / a_trainee 0', async () => {
    const u = w.users;
    expect([
      await caseRows(u.a_lawyer2),
      await caseRows(u.a_admin),
      await caseRows(u.a_owner),
      await caseRows(u.a_trainee),
    ]).toEqual([1, 0, 0, 0]);
  });

  it("RLS-09: a_admin @A — case_A_restricted'e bağlı files, file_chunks, documents, conversations, case_parties 0", async () => {
    const counts = await asApp.withTenant(
      { orgId: w.orgA, userId: w.users.a_admin },
      async (tx) => {
        const out: Record<string, number> = {};
        for (const t of ['files', 'file_chunks', 'documents', 'conversations', 'case_parties']) {
          const r = await tx.query<{ n: string }>(
            `SELECT count(*) AS n FROM app.${t} WHERE case_id = $1`,
            [w.case_A_restricted],
          );
          out[t] = Number(r.rows[0]?.n);
        }
        return out;
      },
    );
    expect(counts).toEqual({
      files: 0,
      file_chunks: 0,
      documents: 0,
      conversations: 0,
      case_parties: 0,
    });
    // Kontrol: ekip üyesi aynı satırları görür (sayım sıfırı veri yokluğundan değildir).
    const team = await asApp.withTenant(
      { orgId: w.orgA, userId: w.users.a_lawyer1 },
      async (tx) => {
        const r = await tx.query<{ n: string }>(
          `SELECT (SELECT count(*) FROM app.files WHERE case_id = $1)
              + (SELECT count(*) FROM app.file_chunks WHERE case_id = $1)
              + (SELECT count(*) FROM app.documents WHERE case_id = $1)
              + (SELECT count(*) FROM app.conversations WHERE case_id = $1)
              + (SELECT count(*) FROM app.case_parties WHERE case_id = $1) AS n`,
          [w.case_A_restricted],
        );
        return Number(r.rows[0]?.n);
      },
    );
    expect(team).toBe(5);
  });

  it('RLS-12: a_lawyer2 @A — conv_l1_private 0; conv_l1_restricted_shared SELECT 1 / UPDATE 0 satır / mesaj INSERT 42501', async () => {
    const u = w.users;
    expect(
      await seen(u.a_lawyer2, 'SELECT id FROM app.conversations WHERE id = $1', [
        w.conv_l1_private,
      ]),
    ).toBe(0);
    expect(
      await seen(u.a_lawyer2, 'SELECT id FROM app.conversations WHERE id = $1', [
        w.conv_l1_restricted_shared,
      ]),
    ).toBe(1);
    const updated = await asApp.withTenant({ orgId: w.orgA, userId: u.a_lawyer2 }, async (tx) => {
      const r = await tx.query(
        "UPDATE app.conversations SET title = 'Örnek veri değişiklik' WHERE id = $1",
        [w.conv_l1_restricted_shared],
      );
      return r.rowCount;
    });
    expect(updated).toBe(0);
    const ins = asApp.withTenant({ orgId: w.orgA, userId: u.a_lawyer2 }, (tx) =>
      tx.query(
        `INSERT INTO app.messages (org_id, conversation_id, role, user_id) VALUES ($1, $2, 'user', $3)`,
        [w.orgA, w.conv_l1_restricted_shared, u.a_lawyer2],
      ),
    );
    expect(await codeOf(ins)).toBe('42501');
  });

  it('RLS-10: a_lawyer2 ekipten çıkarıldıktan sonra — case_A_restricted, conv_l1_restricted_shared, file_restricted 0', async () => {
    const u = w.users;
    await removeCaseMember(w.ctx, {
      orgId: w.orgA,
      caseId: w.case_A_restricted,
      actorId: u.a_lawyer1,
      userId: u.a_lawyer2,
    });
    expect([
      await caseRows(u.a_lawyer2),
      await seen(u.a_lawyer2, 'SELECT id FROM app.conversations WHERE id = $1', [
        w.conv_l1_restricted_shared,
      ]),
      await seen(u.a_lawyer2, 'SELECT id FROM app.files WHERE id = $1', [w.file_restricted]),
    ]).toEqual([0, 0, 0]);
  });

  it('RLS-11: a_lawyer1 (oluşturan) ekipten çıkarıldıktan sonra — case_A_restricted 1 (oluşturan kuralı)', async () => {
    const u = w.users;
    await removeCaseMember(w.ctx, {
      orgId: w.orgA,
      caseId: w.case_A_restricted,
      actorId: u.a_lawyer1,
      userId: u.a_lawyer1,
    });
    // Ekip artık boştur; oluşturan yine de davayı ve (CA ile) ekip tablosunu görür.
    expect(
      await seen(u.a_lawyer1, 'SELECT id FROM app.case_members WHERE case_id = $1', [
        w.case_A_restricted,
      ]),
    ).toBe(0);
    expect(await caseRows(u.a_lawyer1)).toBe(1);
  });
});
