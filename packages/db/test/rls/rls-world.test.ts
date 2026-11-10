// @tk TK-01
// KK-P03c-14 (KK-032-18): rls-world.ts 031 §12 dünyasını kurar; ikinci kez (farklı worldKey) kurulunca
// çakışma olmaz. Sayımlar eda_jobs (BYPASSRLS, yalnız kimlik kolonları) ile doğrulanır.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { jobsDb, makePool, ownerDb } from '../fixtures/db.ts';
import { createRlsWorld } from '../fixtures/rls-world.ts';

let owner: pg.Client;
let jobs: pg.Client;
let ownerPool: pg.Pool;
let runner: TenantRunner;

beforeAll(async () => {
  owner = await ownerDb();
  jobs = await jobsDb();
  ownerPool = makePool('eda_owner');
  runner = createTenantRunner(ownerPool);
});
afterAll(async () => {
  await owner.end();
  await jobs.end();
  await ownerPool.end();
});

describe('KK-P03c-14 (KK-032-18): rls-world kurulumu', () => {
  it('031 §12 dünyası: 12 kullanıcı, iki büro, üyelikler, kısıtlı dava ekibi; ikinci dünya çakışmaz', async () => {
    const w1 = await createRlsWorld(owner, runner);
    const w2 = await createRlsWorld(owner, runner);
    expect(w1.key).not.toBe(w2.key);
    expect(Object.keys(w1.users).sort()).toEqual(
      [
        'a_admin',
        'a_assistant',
        'a_lawyer1',
        'a_lawyer2',
        'a_owner',
        'a_removed',
        'a_senior',
        'a_suspended',
        'a_trainee',
        'b_owner',
        'p_partner',
        's_admin',
      ].sort(),
    );
    const ids1 = new Set(Object.values(w1.users));
    expect(Object.values(w2.users).some((id) => ids1.has(id))).toBe(false);

    for (const w of [w1, w2]) {
      const members = await jobs.query<{ user_id: string; role: string; status: string }>(
        'SELECT user_id, role, status FROM auth.members WHERE organization_id = $1',
        [w.orgA],
      );
      const byUser = new Map(members.rows.map((m) => [m.user_id, `${m.role}/${m.status}`]));
      expect(byUser.get(w.users.a_senior)).toBe('senior_lawyer/active');
      expect(byUser.get(w.users.a_suspended)).toBe('lawyer/suspended');
      expect(byUser.has(w.users.a_removed)).toBe(false);
      expect(byUser.has(w.users.p_partner) || byUser.has(w.users.s_admin)).toBe(false);
      expect(members.rowCount).toBe(8);

      const restricted = await jobs.query<{ visibility: string }>(
        'SELECT visibility FROM app.cases WHERE id = $1',
        [w.case_A_restricted],
      );
      expect(restricted.rows[0]?.visibility).toBe('restricted');
      const team = await jobs.query<{ user_id: string }>(
        'SELECT user_id FROM app.case_members WHERE case_id = $1',
        [w.case_A_restricted],
      );
      expect(new Set(team.rows.map((r) => r.user_id))).toEqual(
        new Set([w.users.a_lawyer1, w.users.a_lawyer2]),
      );
      const caseB = await jobs.query<{ org_id: string }>(
        'SELECT org_id FROM app.cases WHERE id = $1',
        [w.case_B],
      );
      expect(caseB.rows[0]?.org_id).toBe(w.orgB);
    }
  });
});
