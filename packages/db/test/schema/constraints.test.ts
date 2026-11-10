// @tk TK-29
// Kısıt ve tetikleyici davranışları (030 Kabul Kriterleri 7–11, 15, 16, 20; 031 §6.6): çapraz kiracı
// bileşik FK, ekli tablolar ve bölümler, ham json gidiş-dönüşü, veri sınıfı tetikleyicisi, EXCLUDE,
// deletion_log, sağlayıcı izin CHECK'leri ve bayi/üye dışlaması. Veri sentetiktir.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PARTITIONED_TABLES } from '../../src/rls/manifest.ts';
import { bindDeletionReason, createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { appDb, makePool, ownerDb, pgCode, sqlError } from '../fixtures/db.ts';
import { newWorldKey, shortKey } from '../fixtures/ids.ts';
import {
  addMember,
  createTenantWorld,
  insertConversation,
  insertFile,
  insertUser,
  type TenantWorld,
} from '../fixtures/tenant-world.ts';

let owner: pg.Client;
let ownerPool: pg.Pool;
let appPool: pg.Pool;
let asOwner: TenantRunner;
let asApp: TenantRunner;
let w: TenantWorld;

beforeAll(async () => {
  owner = await ownerDb();
  ownerPool = makePool('eda_owner');
  appPool = makePool('eda_app');
  asOwner = createTenantRunner(ownerPool);
  asApp = createTenantRunner(appPool);
  w = await createTenantWorld(owner, asOwner);
});
afterAll(async () => {
  await owner.end();
  await ownerPool.end();
  await appPool.end();
});

const codeOf = (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (e: unknown) => pgCode(e).code,
  );

/** eda_owner işleminde BYPASSRLS'li eda_sec_definer rolüne geçip yalnız FK'yi sınar (geri alınır). */
async function asBypass(
  sqls: [string, unknown[]][],
  grants: string[],
): Promise<string | undefined> {
  await owner.query('BEGIN');
  try {
    for (const g of grants) await owner.query(g);
    await owner.query('SET LOCAL ROLE eda_sec_definer');
    let code: string | undefined;
    for (const [text, values] of sqls) code = (await sqlError(owner, text, values)).code ?? code;
    return code;
  } finally {
    await owner.query('ROLLBACK');
  }
}

describe('KK-P03b-5 (KK-030-7): çapraz kiracı bağı', () => {
  it('withTenant(A) içinde eda_app ile B davasına bağlı sohbet/evrak reddedilir (RLS kapısı, 42501)', async () => {
    const conv = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
      tx.query(
        `INSERT INTO app.conversations (org_id, user_id, case_id, data_class) VALUES ($1, $2, $3, 'case')`,
        [w.orgA, w.aLawyer1, w.caseB],
      ),
    );
    expect(await codeOf(conv)).toBe('42501');
  });

  it('withTenant(A) içinde eda_app ile B evrakına bağlı belge 23503 (bileşik FK)', async () => {
    const fileB = await insertFile(asOwner, w.orgB, w.bOwner, w.caseB);
    const doc = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
      tx.query(
        `INSERT INTO app.documents (org_id, owner_id, kind, title, title_fold, draft, responds_to_file_id)
         VALUES ($1, $2, 'petition', 'Örnek', 'ornek', '{}'::jsonb, $3)`,
        [w.orgA, w.aLawyer1, fileB],
      ),
    );
    expect(await codeOf(doc)).toBe('23503');
  });

  it('RLS atlansa da (BYPASSRLS) B davasının kimliği A satırında 23503 verir: conversations, documents, files', async () => {
    const conv = await asBypass(
      [
        [
          `INSERT INTO app.conversations (org_id, user_id, case_id, data_class) VALUES ($1, $2, $3, 'case')`,
          [w.orgA, w.aLawyer1, w.caseB],
        ],
      ],
      ['GRANT INSERT ON app.conversations TO eda_sec_definer'],
    );
    expect(conv).toBe('23503');
    const doc = await asBypass(
      [
        [
          `INSERT INTO app.documents (org_id, owner_id, case_id, kind, title, title_fold, draft)
           VALUES ($1, $2, $3, 'petition', 'Örnek', 'ornek', '{}'::jsonb)`,
          [w.orgA, w.aLawyer1, w.caseB],
        ],
      ],
      ['GRANT INSERT ON app.documents TO eda_sec_definer'],
    );
    expect(doc).toBe('23503');
    const file = await asBypass(
      [
        [
          `INSERT INTO app.files (org_id, case_id, origin, original_name, name_fold, file_type, mime_type,
             size_bytes, sha256, object_key, key_version, wrap_dek_version, wrapped_file_key)
           VALUES ($1, $2, 'case_upload', 'x.pdf', 'x.pdf', 'pdf', 'application/pdf', 1, $3, $4, 1, 1, $5)`,
          [w.orgA, w.caseB, randomBytes(32), `t/${w.key}/fk`, randomBytes(60)],
        ],
      ],
      ['GRANT INSERT ON app.files TO eda_sec_definer'],
    );
    expect(file).toBe('23503');
  });
});

describe('KK-P03b-6 (KK-030-8, KK-031-11): ekli tablolar ve bölümler', () => {
  it('eda_app ile audit_log, ai_usage, custody_events, credit_ledger UPDATE/DELETE 42501', async () => {
    const app = await appDb();
    try {
      for (const t of PARTITIONED_TABLES) {
        expect((await codeOf(app.query(`UPDATE app.${t} SET org_id = org_id`))) ?? 'ok', t).toBe(
          '42501',
        );
        expect((await codeOf(app.query(`DELETE FROM app.${t}`))) ?? 'ok', t).toBe('42501');
      }
    } finally {
      await app.end();
    }
  });

  it('eda_owner ile ana tabloda UPDATE/DELETE forbid_mutation hatası (sahip dahil)', async () => {
    for (const t of PARTITIONED_TABLES) {
      await owner.query('BEGIN');
      try {
        const upd = await sqlError(owner, `UPDATE app.${t} SET org_id = org_id`);
        const del = await sqlError(owner, `DELETE FROM app.${t}`);
        expect([upd.code, del.code], t).toEqual(['42501', '42501']);
      } finally {
        await owner.query('ROLLBACK');
      }
    }
    await owner.query('BEGIN');
    try {
      await owner.query('SAVEPOINT s');
      await expect(owner.query('DELETE FROM app.audit_log')).rejects.toThrow(/ekli tablo/);
      await owner.query('ROLLBACK TO SAVEPOINT s');
    } finally {
      await owner.query('ROLLBACK');
    }
  });

  it('içinde bulunulan ay + 3 ay bölümü var, DEFAULT bölüm yok; bölümler FORCE RLS ve yetkisiz', async () => {
    const months = await owner.query<{ ym: string }>(
      `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => g), 'YYYY_MM') AS ym
       FROM generate_series(0, 3) g`,
    );
    const parts = await owner.query<{
      parent: string;
      name: string;
      bound: string;
      force: boolean;
      acl: string | null;
    }>(`
      SELECT p.relname AS parent, c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound,
             c.relrowsecurity AND c.relforcerowsecurity AS force, c.relacl::text AS acl
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relnamespace = 'app'::regnamespace AND c.relkind = 'r'`);
    for (const t of PARTITIONED_TABLES) {
      const names = parts.rows.filter((r) => r.parent === t).map((r) => r.name);
      for (const { ym } of months.rows) expect(names, t).toContain(`${t}_p${ym}`);
    }
    for (const r of parts.rows) {
      expect(r.bound, r.name).not.toBe('DEFAULT');
      expect(r.force, r.name).toBe(true);
      for (const role of ['eda_app', 'eda_worker', 'eda_jobs', 'eda_readonly_admin'])
        expect(r.acl ?? '', r.name).not.toContain(`${role}=`);
    }
  });
});

describe('KK-P03b-7 (KK-030-9): messages.llm_parts ham json', () => {
  it('llm_parts json, llm_context text; özel biçimli JSON dizesi bayt bayt aynı döner', async () => {
    const types = await owner.query<{ col: string; type: string }>(`
      SELECT a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a
      WHERE a.attrelid = 'app.messages'::regclass AND a.attname IN ('llm_parts', 'llm_context', 'reasoning')
      ORDER BY 1`);
    expect(types.rows).toEqual([
      { col: 'llm_context', type: 'text' },
      { col: 'llm_parts', type: 'json' },
      { col: 'reasoning', type: 'json' },
    ]);
    const conv = await insertConversation(asOwner, w.orgA, w.aLawyer1);
    const raw = '{"z":1,  "a":[ 3,1 ],"ç":"Örnek veri"}';
    const back = await asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async (tx) => {
      const res = await tx.query<{ llm_parts: string; parts: unknown }>(
        `INSERT INTO app.messages (org_id, conversation_id, role, user_id, llm_parts, llm_context)
         VALUES ($1, $2, 'user', $3, $4, 'Örnek veri bağlam') RETURNING llm_parts, parts`,
        [w.orgA, conv, w.aLawyer1, raw],
      );
      return res.rows[0];
    });
    expect(back?.llm_parts).toBe(raw);
    expect(back?.parts).toEqual([]);
  });
});

describe('KK-P03b-8 (KK-030-10): sohbet veri sınıfı yalnız yükselir', () => {
  it('case -> client güncellemesi reddedilir; public beyan olmadan eklenemez', async () => {
    const conv = await insertConversation(asOwner, w.orgA, w.aLawyer1, w.caseA);
    const down = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
      tx.query(`UPDATE app.conversations SET data_class = 'client', case_id = NULL WHERE id = $1`, [
        conv,
      ]),
    );
    await expect(down).rejects.toThrow(/düşürülemez/);
    const pub = asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
      tx.query(
        `INSERT INTO app.conversations (org_id, user_id, data_class) VALUES ($1, $2, 'public')`,
        [w.orgA, w.aLawyer1],
      ),
    );
    expect(await codeOf(pub)).toBe('23514');
    const up = await asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async (tx) => {
      const c = await tx.query<{ id: string }>(
        `INSERT INTO app.conversations (org_id, user_id, data_class, public_mode_declared_at)
         VALUES ($1, $2, 'public', now()) RETURNING id`,
        [w.orgA, w.aLawyer1],
      );
      const id = c.rows[0]?.id;
      const r = await tx.query(`UPDATE app.conversations SET data_class = 'client' WHERE id = $1`, [
        id,
      ]);
      return r.rowCount;
    });
    expect(up).toBe(1);
  });
});

describe('KK-P03b-9 (KK-030-11): EXCLUDE kısıtları', () => {
  it('çakışan law_article_versions ve aynı koldaki çakışan judicial_recesses 23P01', async () => {
    await owner.query('BEGIN');
    try {
      const law = await owner.query<{ id: string }>(
        `INSERT INTO corpus.laws (law_no, title, title_fold) VALUES ($1, 'Örnek Kanun', 'ornek kanun') RETURNING id`,
        [`T${w.key}`],
      );
      const art = await owner.query<{ id: string }>(
        `INSERT INTO corpus.law_articles (law_id, article_no, text, text_norm, sort_order)
         VALUES ($1, '1', 'Örnek madde', 'ornek madde', 1) RETURNING id`,
        [law.rows[0]?.id],
      );
      const artId = art.rows[0]?.id;
      await owner.query(
        `INSERT INTO corpus.law_article_versions (article_id, valid_during, text) VALUES ($1, '[2020-01-01,2025-01-01)', 'a')`,
        [artId],
      );
      expect(
        await sqlError(
          owner,
          `INSERT INTO corpus.law_article_versions (article_id, valid_during, text) VALUES ($1, '[2024-06-01,2026-01-01)', 'b')`,
          [artId],
        ),
      ).toEqual({ code: '23P01', constraint: 'law_article_versions_no_overlap' });
      await owner.query(
        `INSERT INTO app.judicial_recesses (branch, year, period, legal_basis) VALUES ('hmk', 2090, '[2090-07-20,2090-09-01)', 'Örnek')`,
      );
      expect(
        await sqlError(
          owner,
          `INSERT INTO app.judicial_recesses (branch, year, period, legal_basis) VALUES ('hmk', 2091, '[2090-08-01,2090-08-15)', 'Örnek')`,
        ),
      ).toEqual({ code: '23P01', constraint: 'judicial_recesses_no_overlap' });
    } finally {
      await owner.query('ROLLBACK');
    }
  });
});

describe('KK-P03b-12 (KK-030-15): deletion_log', () => {
  it('sohbet silinince app.conversations satırı yazılır; app.deletion_reason ayarlıysa reason o değer', async () => {
    const c1 = await insertConversation(asOwner, w.orgA, w.aLawyer2);
    const c2 = await insertConversation(asOwner, w.orgA, w.aLawyer2);
    await asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer2 }, async (tx) => {
      await tx.query('DELETE FROM app.conversations WHERE id = $1', [c1]);
    });
    await asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer2 }, async (tx) => {
      await bindDeletionReason(tx, 'retention');
      await tx.query('DELETE FROM app.conversations WHERE id = $1', [c2]);
    });
    const res = await owner.query<{
      row_id: string;
      table_name: string;
      org_id: string;
      reason: string;
    }>(
      'SELECT row_id, table_name, org_id, reason FROM app.deletion_log WHERE row_id = ANY ($1::uuid[]) ORDER BY reason DESC',
      [[c1, c2]],
    );
    expect(res.rows).toEqual([
      { row_id: c1, table_name: 'app.conversations', org_id: w.orgA, reason: 'user_request' },
      { row_id: c2, table_name: 'app.conversations', org_id: w.orgA, reason: 'retention' },
    ]);
  });
});

describe('KK-P03b-13 (KK-030-16): ai_providers izin CHECK’leri', () => {
  it("transfer_basis = 'none' iken client ve training_use = true iken case CHECK ihlali", async () => {
    await owner.query('BEGIN');
    try {
      const id = `t-${w.key.slice(0, 8)}`;
      expect(
        await sqlError(
          owner,
          `INSERT INTO app.ai_providers (id, kind, display_name, region, transfer_basis, allowed_data_classes)
           VALUES ($1, 'openai_compatible', 'Örnek', 'EU', 'none', '{public,client}')`,
          [id],
        ),
      ).toEqual({ code: '23514', constraint: 'ai_providers_class_basis_chk' });
      expect(
        await sqlError(
          owner,
          `INSERT INTO app.ai_providers (id, kind, display_name, region, transfer_basis, scc_notified_at,
             allowed_data_classes, training_use, human_review, retention_days)
           VALUES ($1, 'openai_compatible', 'Örnek', 'EU', 'scc_notified', now(), '{public,case}', true, false, 0)`,
          [id],
        ),
      ).toEqual({ code: '23514', constraint: 'ai_providers_class_terms_chk' });
    } finally {
      await owner.query('ROLLBACK');
    }
  });
});

describe('KK-P03b-16 (KK-030-20): bayi kullanıcısı büro üyesi olamaz ve tersi', () => {
  it('auth.members ve app.partner_members karşılıklı tetikleyiciyle reddedilir', async () => {
    const key = shortKey(newWorldKey());
    await owner.query('BEGIN');
    try {
      const partner = await owner.query<{ id: string }>(
        `INSERT INTO app.partners (code, name) VALUES ($1, 'Örnek Bayi') RETURNING id`,
        [`T${key.slice(0, 8).toUpperCase()}`],
      );
      const p = await insertUser(owner, key, 'bayi');
      await owner.query(
        `INSERT INTO app.partner_members (partner_id, user_id, role) VALUES ($1, $2, 'partner_owner')`,
        [partner.rows[0]?.id, p],
      );
      await owner.query('SAVEPOINT m');
      await expect(addMember(owner, w.orgA, p, 'lawyer')).rejects.toThrow(/bayi kullanıcısı/);
      await owner.query('ROLLBACK TO SAVEPOINT m');
      const member = await sqlError(
        owner,
        `INSERT INTO app.partner_members (partner_id, user_id, role) VALUES ($1, $2, 'partner_staff')`,
        [partner.rows[0]?.id, w.aLawyer1],
      );
      expect(member.code).toBe('23514');
    } finally {
      await owner.query('ROLLBACK');
    }
  });
});
