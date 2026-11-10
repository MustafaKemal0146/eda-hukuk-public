// @tk TK-29
// auth şeması ve app.partners (030 §3, §4, §14; 031 §3; 042 §12.2). Veri sentetiktir ve her senaryo
// geri alınan işlem içinde yazılır.
import {
  INVITATION_STATUSES,
  MEMBER_ROLES,
  MEMBER_STATUSES,
  MFA_LEVELS,
  ORG_KINDS,
  PLATFORM_ROLES,
  RECOVERY_APPROVAL_PATHS,
  RECOVERY_EVIDENCE_CODES,
  RECOVERY_KINDS,
  RECOVERY_STATUSES,
  SESSION_SURFACES,
  VERIFICATION_STATUSES,
} from '@eda/contracts/enums';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readTablesJson } from '../fixtures/canon-tables.ts';
import { connect, ownerDb, pgCode, sqlError } from '../fixtures/db.ts';
import { newWorldKey, shortKey } from '../fixtures/ids.ts';

let owner: pg.Client;
const world = shortKey(newWorldKey());
const email = (name: string) => `${name}.${world}@ornek.test`;

beforeAll(async () => {
  owner = await ownerDb();
});
afterAll(async () => {
  await owner.end();
});

async function inTx<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

let seq = 0;
/** Sentetik kullanıcı; e-posta ASCII ve küçük harfli üretilir (users_email_chk). */
async function insertUser(client: pg.Client, name: string, mail?: string): Promise<string> {
  seq += 1;
  const res = await client.query<{ id: string }>(
    'INSERT INTO auth.users (name, email) VALUES ($1, $2) RETURNING id',
    [name, mail ?? email(`kullanici${seq}`)],
  );
  return res.rows[0]?.id ?? '';
}

describe('KK-P03a-14 (KK-030-1 auth kısmı): tablo kümesi 002 §10.1 ile eşit', () => {
  it('auth şemasındaki tablolar tables.json auth listesine (api_keys hariç, V2) eşit', async () => {
    const res = await owner.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'auth' ORDER BY 1",
    );
    const expected = readTablesJson().auth.filter((t) => t !== 'api_keys');
    expect(res.rows.map((r) => r.table_name)).toEqual([...expected].sort());
    // app ve corpus tablo kümesi: test/schema/canon.test.ts (KK-P03b-1).
  });
});

describe('KK-P03a-13 (KK-030-5, KK-030-6): e-posta kısıtları ve kimlik varsayılanları', () => {
  it('Ali@Ornek.com users_email_chk, ikinci ali@ornek.com users_email_uq ile reddedilir', async () => {
    await inTx(owner, async () => {
      expect(
        await sqlError(owner, 'INSERT INTO auth.users (name, email) VALUES ($1, $2)', [
          'Ali',
          'Ali@Ornek.com',
        ]),
      ).toEqual({
        code: '23514',
        constraint: 'users_email_chk',
      });
      await insertUser(owner, 'Ali', 'ali@ornek.com');
      expect(
        await sqlError(owner, 'INSERT INTO auth.users (name, email) VALUES ($1, $2)', [
          'Ali',
          'ali@ornek.com',
        ]),
      ).toEqual({
        code: '23505',
        constraint: 'users_email_uq',
      });
      expect(
        (
          await sqlError(owner, 'INSERT INTO auth.users (name, email) VALUES ($1, $2)', [
            'Ayşe',
            'ayşe@ornek.com',
          ])
        ).constraint,
      ).toBe('users_email_chk');
    });
  });

  it('auth.invitations.id sürüm hanesi 4, diğer kimlikler uuidv7 (sürüm 7)', async () => {
    await inTx(owner, async () => {
      const userId = await insertUser(owner, 'Davet Eden');
      expect(userId[14]).toBe('7');
      const org = await owner.query<{ id: string }>(
        "INSERT INTO auth.organizations (name, slug) VALUES ('Örnek Büro', $1) RETURNING id",
        [`org-${world}`],
      );
      const orgId = org.rows[0]?.id ?? '';
      expect(orgId[14]).toBe('7');
      const inv = await owner.query<{ id: string }>(
        `INSERT INTO auth.invitations (organization_id, email, role, expires_at, inviter_id)
         VALUES ($1, $2, 'lawyer', now() + interval '72 hours', $3) RETURNING id`,
        [orgId, email('davetli'), userId],
      );
      expect(inv.rows[0]?.id[14]).toBe('4');
    });
  });

  it('uuid PK varsayılanları uuidv7(); tek istisna auth.invitations.id gen_random_uuid()', async () => {
    const res = await owner.query<{ tbl: string; def: string }>(`
      SELECT c.relnamespace::regnamespace::text || '.' || c.relname AS tbl, pg_get_expr(d.adbin, d.adrelid) AS def
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.conkey[1]
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE k.contype = 'p' AND a.atttypid = 'uuid'::regtype
        AND c.relnamespace::regnamespace::text = 'auth'
      ORDER BY 1`);
    // app ve corpus: test/schema/canon.test.ts (KK-P03b-3).
    expect(res.rows.length).toBe(10);
    for (const r of res.rows) {
      expect(r.def, r.tbl).toBe(r.tbl === 'auth.invitations' ? 'gen_random_uuid()' : 'uuidv7()');
    }
  });
});

const ENUM_CHECKS: Readonly<Record<string, readonly string[]>> = {
  'auth.users.users_platform_role_chk': PLATFORM_ROLES,
  'auth.users.users_verification_status_chk': VERIFICATION_STATUSES,
  'auth.sessions.sessions_mfa_level_chk': MFA_LEVELS,
  'auth.sessions.sessions_surface_chk': SESSION_SURFACES,
  'auth.organizations.organizations_kind_chk': ORG_KINDS,
  'auth.members.members_role_chk': MEMBER_ROLES,
  'auth.members.members_status_chk': MEMBER_STATUSES,
  'auth.invitations.invitations_role_chk': MEMBER_ROLES.filter((r) => r !== 'owner'),
  'auth.invitations.invitations_status_chk': INVITATION_STATUSES,
  'auth.account_recovery_requests.account_recovery_requests_kind_chk': RECOVERY_KINDS,
  'auth.account_recovery_requests.account_recovery_requests_approval_path_chk':
    RECOVERY_APPROVAL_PATHS,
  'auth.account_recovery_requests.account_recovery_requests_status_chk': RECOVERY_STATUSES,
  'auth.account_recovery_requests.account_recovery_requests_evidence_code_chk':
    RECOVERY_EVIDENCE_CODES,
};

describe('KK-P03a-14 (KK-030-3, KK-030-4 auth kısmı): enum CHECK listeleri ve tip kuralları', () => {
  it('her enum CHECK değer listesi @eda/contracts enums.ts dizisine eşittir', async () => {
    const res = await owner.query<{ key: string; def: string }>(`
      SELECT n.nspname || '.' || c.relname || '.' || k.conname AS key, pg_get_constraintdef(k.oid) AS def
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE k.contype = 'c' AND n.nspname = 'auth'
        AND pg_get_constraintdef(k.oid) LIKE '%= ANY (ARRAY[%'`);
    const found = new Map(
      res.rows.map((r) => [r.key, [...r.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1])]),
    );
    expect([...found.keys()].sort()).toEqual(Object.keys(ENUM_CHECKS).sort());
    for (const [key, values] of Object.entries(ENUM_CHECKS))
      expect(found.get(key), key).toEqual([...values]);
  });

  it('üç şemada zaman dilimsiz zaman, real, double precision, numeric kolon ve PG enum tipi yok', async () => {
    const cols = await owner.query(`
      SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema IN ('auth', 'app', 'corpus')
        AND data_type IN ('timestamp without time zone', 'real', 'double precision', 'numeric')`);
    expect(cols.rows).toEqual([]);
    const enums = await owner.query(`
      SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'e' AND n.nspname IN ('auth', 'app', 'corpus')`);
    expect(enums.rows).toEqual([]);
    const varchar = await owner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema IN ('auth', 'app', 'corpus') AND data_type = 'character varying'`);
    expect(varchar.rows).toEqual([]);
  });
});

describe('KK-P03a-15 (KK-030-14 auth kısmı): Türkçe sıralama ve harmanlama', () => {
  it('ORDER BY name: Cem, Çelik, Dede, Ilgaz, İnce', async () => {
    await inTx(owner, async () => {
      const ids: string[] = [];
      for (const [i, name] of ['İnce', 'Cem', 'Ilgaz', 'Dede', 'Çelik'].entries()) {
        ids.push(await insertUser(owner, name, email(`kisi${i}`)));
      }
      const res = await owner.query<{ name: string }>(
        'SELECT name FROM auth.users WHERE id = ANY ($1::uuid[]) ORDER BY name',
        [ids],
      );
      expect(res.rows.map((r) => r.name)).toEqual(['Cem', 'Çelik', 'Dede', 'Ilgaz', 'İnce']);
    });
  });

  it('ad kolonları tr-TR-x-icu, e-posta ve kod kolonları veritabanı varsayılanı C.UTF-8', async () => {
    const res = await owner.query<{ col: string; coll: string | null }>(`
      SELECT n.nspname || '.' || c.relname || '.' || a.attname AS col,
             CASE WHEN a.attcollation = 0 THEN NULL ELSE (SELECT collname FROM pg_collation WHERE oid = a.attcollation) END AS coll
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'auth' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
        AND a.atttypid = 'text'::regtype AND a.attcollation <> 100`);
    // app ve corpus harmanlaması: test/schema/canon.test.ts (KK-P03b-11).
    expect(res.rows.map((r) => `${r.col}:${r.coll}`).sort()).toEqual([
      'auth.organizations.name:tr-TR-x-icu',
      'auth.users.name:tr-TR-x-icu',
    ]);
    const db = await owner.query<{ datcollate: string }>(
      'SELECT datcollate FROM pg_database WHERE datname = current_database()',
    );
    expect(db.rows[0]?.datcollate).toBe('C.UTF-8');
  });
});

describe('KK-P03a-16 (031 §3, RLS-23/24 öncülü): auth kolon yetkileri', () => {
  it('eda_app gizli auth tablolarında 42501 alır; users(email) okur; invitations(id) okuyamaz', async () => {
    const app = await connect('eda_app');
    try {
      for (const t of [
        'accounts',
        'sessions',
        'two_factors',
        'verifications',
        'passkeys',
        'account_recovery_requests',
      ]) {
        const err = await app.query(`SELECT 1 FROM auth.${t} LIMIT 1`).then(
          () => undefined,
          (e: unknown) => pgCode(e).code,
        );
        expect(err, t).toBe('42501');
      }
      await expect(
        app.query('SELECT email, name, verification_status FROM auth.users LIMIT 1'),
      ).resolves.toBeDefined();
      await expect(
        app.query('SELECT organization_id, role, status, expires_at FROM auth.invitations LIMIT 1'),
      ).resolves.toBeDefined();
      const inv = await app.query('SELECT id FROM auth.invitations LIMIT 1').then(
        () => undefined,
        (e: unknown) => pgCode(e).code,
      );
      expect(inv).toBe('42501');
      const banned = await app.query('SELECT banned FROM auth.users LIMIT 1').then(
        () => undefined,
        (e: unknown) => pgCode(e).code,
      );
      expect(banned).toBe('42501');
      const partners = await app.query('SELECT code FROM app.partners LIMIT 1').then(
        () => undefined,
        (e: unknown) => pgCode(e).code,
      );
      expect(partners).toBe('42501');
    } finally {
      await app.end();
    }
  });

  it('eda_worker eda_app kolon yetkilerini miras alır', async () => {
    const worker = await connect('eda_worker');
    try {
      await expect(worker.query('SELECT email FROM auth.users LIMIT 1')).resolves.toBeDefined();
      const err = await worker.query('SELECT 1 FROM auth.accounts LIMIT 1').then(
        () => undefined,
        (e: unknown) => pgCode(e).code,
      );
      expect(err).toBe('42501');
    } finally {
      await worker.end();
    }
  });

  it('eda_auth auth şemasında DML yapar; app.partners erişimi 42501', async () => {
    const auth = await connect('eda_auth');
    try {
      await inTx(auth, async () => {
        const id = await insertUser(auth, 'Yetki Deneme');
        await auth.query("UPDATE auth.users SET verification_status = 'verified' WHERE id = $1", [
          id,
        ]);
        await auth.query(
          `INSERT INTO auth.verifications (identifier, value, expires_at) VALUES ($1, 'ornek', now() + interval '1 hour')`,
          [email('dogrulama')],
        );
        const del = await auth.query('DELETE FROM auth.users WHERE id = $1', [id]);
        expect(del.rowCount).toBe(1);
        expect((await sqlError(auth, 'SELECT code FROM app.partners')).code).toBe('42501');
      });
    } finally {
      await auth.end();
    }
  });
});

describe('KK-P03a-17 (042 §12.2): auth.account_recovery_requests kısıtları', () => {
  it('ikinci açık talep, aynı personel çift onayı ve new_email eksikliği reddedilir', async () => {
    await inTx(owner, async () => {
      const user = await insertUser(owner, 'Kurtarma Talep');
      const staff = await insertUser(owner, 'Personel Bir');
      const insert = (kind: string, extra = '', values: unknown[] = []) =>
        `INSERT INTO auth.account_recovery_requests (user_id, kind, approval_path, expires_at${extra})
         VALUES ('${user}', '${kind}', 'staff', now() + interval '7 days'${values.length ? `, ${values.map((_, i) => `$${i + 1}`).join(', ')}` : ''})`;
      await owner.query(insert('mfa_reset'));
      expect(await sqlError(owner, insert('mfa_reset'))).toEqual({
        code: '23505',
        constraint: 'recovery_open_uq',
      });
      expect(
        await sqlError(
          owner,
          insert('mfa_reset', ', status, staff_approver_1, staff_approver_2', [
            'completed',
            staff,
            staff,
          ]),
          ['completed', staff, staff],
        ),
      ).toEqual({ code: '23514', constraint: 'recovery_staff_distinct_chk' });
      expect(await sqlError(owner, insert('email_change'))).toEqual({
        code: '23514',
        constraint: 'recovery_email_chk',
      });
      expect(
        await sqlError(
          owner,
          insert('mfa_reset', ', status, new_email', ['completed', email('yeni')]),
          ['completed', email('yeni')],
        ),
      ).toEqual({
        code: '23514',
        constraint: 'recovery_email_chk',
      });
      await owner.query(insert('email_change', ', new_email', [email('yeni')]), [email('yeni')]);
      expect(
        await sqlError(owner, insert('mfa_reset', ', status, approved_by', ['completed', user]), [
          'completed',
          user,
        ]),
      ).toEqual({
        code: '23514',
        constraint: 'recovery_owner_not_self_chk',
      });
    });
  });
});
