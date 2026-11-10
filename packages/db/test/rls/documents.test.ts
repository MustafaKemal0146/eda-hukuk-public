// @tk TK-01
// KK-P17b-1 (KK-031 belge satırları): belge, sürüm, öneri ve şablon kümeleri RLS ile izole; P17b'nin
// `subtype` kolonu CHECK ile kapalı kümedir; sürümler değişmezdir, yalnız `name` güncellenir.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { makePool, ownerDb } from '../fixtures/db.ts';
import { createDocument } from '../fixtures/factories.ts';
import { codeOf } from '../fixtures/rls-helpers.ts';
import { createRlsWorld, type RlsWorld } from '../fixtures/rls-world.ts';

let owner: pg.Client;
let ownerPool: pg.Pool;
let appPool: pg.Pool;
let asApp: TenantRunner;
let w: RlsWorld;
let versionId: string;
let suggestionId: string;

beforeAll(async () => {
  owner = await ownerDb();
  ownerPool = makePool('eda_owner');
  appPool = makePool('eda_app');
  asApp = createTenantRunner(appPool);
  w = await createRlsWorld(owner, createTenantRunner(ownerPool));
  // doc_trainee sahibi a_trainee: sürüm ve öneri sahibi olarak yazılır.
  versionId = await asApp.withTenant({ orgId: w.orgA, userId: w.users.a_trainee }, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO app.document_versions
         (org_id, document_id, version_no, source, trigger, content, base_draft_rev, created_by)
       VALUES ($1, $2, 1, 'user', 'manual', '{"type":"doc","content":[]}'::jsonb, 0, $3)
       RETURNING id`,
      [w.orgA, w.doc_trainee, w.users.a_trainee],
    );
    const s = await tx.query<{ id: string }>(
      `INSERT INTO app.document_suggestions (org_id, document_id, base_rev, ops, requested_by)
       VALUES ($1, $2, 0, '[{"opId":"o1"}]'::jsonb, $3) RETURNING id`,
      [w.orgA, w.doc_trainee, w.users.a_trainee],
    );
    suggestionId = s.rows[0]?.id ?? '';
    return r.rows[0]?.id ?? '';
  });
});
afterAll(async () => {
  await owner.end();
  await ownerPool.end();
  await appPool.end();
});

const rows = (orgId: string, userId: string, sql: string, params: unknown[]): Promise<number> =>
  asApp.withTenant({ orgId, userId }, async (tx) => (await tx.query(sql, params)).rowCount ?? 0);

describe('KK-P17b-1: belge kümeleri RLS izolasyonu', () => {
  it('sürüm ve öneri satırları belgeyi görene görünür; başka kullanıcı ve başka büro göremez', async () => {
    const q = 'SELECT id FROM app.document_versions WHERE id = $1';
    const s = 'SELECT id FROM app.document_suggestions WHERE id = $1';
    expect(await rows(w.orgA, w.users.a_trainee, q, [versionId])).toBe(1);
    expect(await rows(w.orgA, w.users.a_trainee, s, [suggestionId])).toBe(1);
    for (const who of [w.users.a_lawyer2, w.users.a_senior, w.users.a_owner]) {
      expect(await rows(w.orgA, who, q, [versionId])).toBe(0);
      expect(await rows(w.orgA, who, s, [suggestionId])).toBe(0);
    }
    await expect(rows(w.orgB, w.users.b_owner, q, [versionId])).resolves.toBe(0);
  });

  it('davalı belge: dava ekibi görür, ekip dışı görmez; davasız belge yalnız sahibinde', async () => {
    const q = 'SELECT id FROM app.documents WHERE id = $1';
    expect(await rows(w.orgA, w.users.a_lawyer1, q, [w.doc_restricted])).toBe(1);
    expect(await rows(w.orgA, w.users.a_lawyer2, q, [w.doc_restricted])).toBe(1);
    expect(await rows(w.orgA, w.users.a_admin, q, [w.doc_restricted])).toBe(0);
    expect(await rows(w.orgA, w.users.a_lawyer2, q, [w.doc_trainee])).toBe(0);
  });

  it('şablonlar: platform herkese; büro şablonu yalnız kendi bürosuna', async () => {
    const q = 'SELECT id FROM app.templates WHERE id = $1';
    expect(await rows(w.orgA, w.users.a_lawyer1, q, [w.template_platform])).toBe(1);
    expect(await rows(w.orgB, w.users.b_owner, q, [w.template_platform])).toBe(1);
    expect(await rows(w.orgA, w.users.a_lawyer1, q, [w.template_A])).toBe(1);
    expect(await rows(w.orgB, w.users.b_owner, q, [w.template_A])).toBe(0);
    expect(await rows(w.orgA, w.users.a_lawyer1, q, [w.template_B])).toBe(0);
  });
});

describe('KK-P17b-1: subtype kapalı küme (expand migrasyonu)', () => {
  const insertDoc = (subtype: string | null) =>
    asApp.withTenant({ orgId: w.orgA, userId: w.users.a_lawyer1 }, (tx) =>
      tx.query(
        `INSERT INTO app.documents (org_id, owner_id, kind, subtype, title, title_fold, draft)
         VALUES ($1, $2, 'petition', $3, 'T', 't', '{}'::jsonb)`,
        [w.orgA, w.users.a_lawyer1, subtype],
      ),
    );

  it('geçerli alt tür ve NULL kabul; kapalı küme dışı değer 23514', async () => {
    expect(await codeOf(insertDoc('claim'))).toBeUndefined();
    expect(await codeOf(insertDoc(null))).toBeUndefined();
    expect(await codeOf(insertDoc('uydurma'))).toBe('23514');
  });

  it('şablon alt türü de aynı kümedir', async () => {
    const insert = asApp.withTenant({ orgId: w.orgA, userId: w.users.a_owner }, (tx) =>
      tx.query(
        `INSERT INTO app.templates (org_id, kind, subtype, title, content, created_by)
         VALUES ($1, 'petition', 'uydurma', 'x', '{}'::jsonb, $2)`,
        [w.orgA, w.users.a_owner],
      ),
    );
    expect(await codeOf(insert)).toBe('23514');
  });
});

describe('KK-P17b-1: sürümler değişmez, yalnız name güncellenir', () => {
  const upd = (userId: string, set: string, params: unknown[] = []) =>
    asApp.withTenant({ orgId: w.orgA, userId }, async (tx) => {
      const r = await tx.query(`UPDATE app.document_versions SET ${set} WHERE id = $1`, [
        versionId,
        ...params,
      ]);
      return r.rowCount ?? 0;
    });

  it('belge sahibi name günceller; denetleyen/başkası 0 satır; içerik ve tetikleyici 42501', async () => {
    expect(await upd(w.users.a_trainee, 'name = $2', ['Mahkemeye verilen'])).toBe(1);
    expect(await upd(w.users.a_lawyer2, 'name = $2', ['x'])).toBe(0);
    for (const set of ["content = '{}'::jsonb", "trigger = 'restore'", 'version_no = 7']) {
      expect(await codeOf(upd(w.users.a_trainee, set))).toBe('42501');
    }
    const del = asApp.withTenant({ orgId: w.orgA, userId: w.users.a_trainee }, (tx) =>
      tx.query('DELETE FROM app.document_versions WHERE id = $1', [versionId]),
    );
    expect(await codeOf(del)).toBe('42501');
  });
});

describe('KK-P17b-1: createDocument fabrikası yeni kolonla uyumlu', () => {
  it('subtype verilmeyen belge NULL alt türle açılır', async () => {
    const id = await createDocument(w.ctx, {
      name: 'subtype_null',
      orgId: w.orgA,
      ownerId: w.users.a_lawyer1,
    });
    const r = await asApp.withTenant({ orgId: w.orgA, userId: w.users.a_lawyer1 }, (tx) =>
      tx.query<{ subtype: string | null }>('SELECT subtype FROM app.documents WHERE id = $1', [id]),
    );
    expect(r.rows[0]?.subtype).toBeNull();
  });
});
