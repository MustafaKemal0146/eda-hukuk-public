// @tk TK-01
// DB rolleri, rol üyelikleri, rol düzeyi ayarlar ve pg_hba (031 §2; KK-031-1, KK-031-7, KK-031-8).
// Taze tmpfs birimde initdb'nin kurduğu kümeye karşı koşar (infra/scripts/dev/test-db.sh).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseSetConfig,
  pgDuration,
  ROLE_SPECS,
  roleSettingDiffs,
} from '../../src/migrate/roles.ts';
import { connect, makeClient, ownerDb, pgCode, rolePassword } from '../fixtures/db.ts';

let owner: pg.Client;

beforeAll(async () => {
  owner = await ownerDb();
});
afterAll(async () => {
  await owner.end();
});

async function connectError(user: string, password?: string): Promise<string | undefined> {
  const c = makeClient(user, password ?? 'gecersiz-parola-ornek');
  try {
    await c.connect();
    await c.end();
    return undefined;
  } catch (err) {
    return pgCode(err).code ?? 'baglanti-hatasi';
  }
}

describe('KK-P03a-1 (KK-031-1): 11 rol ve nitelikleri', () => {
  it('pg_roles §2.1 tablosundaki LOGIN/BYPASSRLS niteliklerini taşır; yalnız postgres süper kullanıcı', async () => {
    const res = await owner.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolbypassrls: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(
      `SELECT rolname, rolcanlogin, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole
       FROM pg_roles WHERE rolname = 'postgres' OR rolname LIKE 'eda\\_%' ORDER BY rolname`,
    );
    const names = res.rows.map((r) => r.rolname);
    expect(names).toEqual([...ROLE_SPECS.map((s) => s.name), 'postgres'].sort());
    expect(names).toHaveLength(11);
    for (const spec of ROLE_SPECS) {
      const r = res.rows.find((x) => x.rolname === spec.name);
      expect(r, spec.name).toMatchObject({
        rolcanlogin: spec.login,
        rolbypassrls: spec.bypassRls,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
      });
    }
    const supers = await owner.query('SELECT rolname FROM pg_roles WHERE rolsuper');
    expect(supers.rows.map((r) => r.rolname)).toEqual(['postgres']);
    const bypass = await owner.query(
      "SELECT rolname FROM pg_roles WHERE rolbypassrls AND rolname <> 'postgres' ORDER BY rolname",
    );
    expect(bypass.rows.map((r) => r.rolname)).toEqual([
      'eda_jobs',
      'eda_rls_helper',
      'eda_sec_definer',
    ]);
  });

  it('Q7 benzeri sorgu 0 satır döner', async () => {
    const res = await owner.query(`
      SELECT rolname FROM pg_roles
      WHERE (rolsuper AND rolname <> 'postgres')
         OR (rolbypassrls AND rolname NOT IN ('postgres', 'eda_jobs', 'eda_rls_helper', 'eda_sec_definer'))
         OR (rolcanlogin AND rolname IN ('eda_rls_helper', 'eda_sec_definer'))`);
    expect(res.rows).toEqual([]);
  });

  it('rol üyelikleri: eda_worker ⊂ eda_app (INHERIT, SET yok); eda_owner -> NOLOGIN roller (SET, miras yok)', async () => {
    const res = await owner.query<{
      role: string;
      member: string;
      inherit_option: boolean;
      set_option: boolean;
    }>(
      `SELECT r.rolname AS role, m.rolname AS member, a.inherit_option, a.set_option
       FROM pg_auth_members a JOIN pg_roles r ON r.oid = a.roleid JOIN pg_roles m ON m.oid = a.member
       WHERE m.rolname LIKE 'eda\\_%' ORDER BY 1, 2`,
    );
    expect(res.rows).toEqual([
      { role: 'eda_app', member: 'eda_worker', inherit_option: true, set_option: false },
      { role: 'eda_rls_helper', member: 'eda_owner', inherit_option: false, set_option: true },
      { role: 'eda_sec_definer', member: 'eda_owner', inherit_option: false, set_option: true },
      { role: 'pg_monitor', member: 'eda_monitor', inherit_option: true, set_option: true },
      {
        role: 'pg_read_all_settings',
        member: 'eda_backup',
        inherit_option: true,
        set_option: true,
      },
      { role: 'pg_read_all_settings', member: 'eda_owner', inherit_option: true, set_option: true },
    ]);
  });

  it('LOGIN rolleri ağdan bağlanır; NOLOGIN roller, postgres ve eda_backup ağdan bağlanamaz (pg_hba)', async () => {
    for (const role of [
      'eda_auth',
      'eda_app',
      'eda_worker',
      'eda_jobs',
      'eda_readonly_admin',
      'eda_monitor',
    ] as const) {
      const c = await connect(role);
      const res = await c.query<{ u: string }>('SELECT current_user AS u');
      expect(res.rows[0]?.u).toBe(role);
      await c.end();
    }
    expect(await connectError('eda_rls_helper')).toBe('28000');
    expect(await connectError('eda_sec_definer')).toBe('28000');
    expect(await connectError('postgres', rolePassword('postgres'))).toBe('28000');
    expect(await connectError('eda_backup', rolePassword('eda_backup'))).toBe('28000');
    expect(await connectError('eda_app')).toBe('28P01');
  });
});

describe('KK-P03a-2 (KK-031-7): rol düzeyi ayarlar = defaults.ts db.* anahtarları', () => {
  it('pg_db_role_setting statement/idle/lock/search_path değerleri 031 §2.5 ile eşit', async () => {
    const res = await owner.query<{ rolname: string; setconfig: string[] }>(
      `SELECT r.rolname, s.setconfig FROM pg_db_role_setting s
       JOIN pg_roles r ON r.oid = s.setrole JOIN pg_database d ON d.oid = s.setdatabase
       WHERE d.datname = current_database()`,
    );
    const actual = new Map(res.rows.map((r) => [r.rolname, parseSetConfig(r.setconfig)]));
    expect(roleSettingDiffs(actual)).toEqual([]);
    const app = actual.get('eda_app');
    expect(app?.statement_timeout).toBe(pgDuration(CONFIG_DEFAULTS['db.statementTimeoutMs']));
    expect(app?.idle_in_transaction_session_timeout).toBe(
      pgDuration(CONFIG_DEFAULTS['db.idleInTxTimeoutMs']),
    );
    expect(app?.lock_timeout).toBe(pgDuration(CONFIG_DEFAULTS['db.lockTimeoutMs']));
    expect(app?.search_path).toBe('app, public');
    expect(actual.get('eda_auth')?.search_path).toBe('auth, public');
    expect(actual.get('eda_jobs')?.statement_timeout).toBe(
      pgDuration(CONFIG_DEFAULTS['db.jobsStatementTimeoutMs']),
    );
    expect(actual.get('eda_owner')?.statement_timeout).toBe('0');
  });
});

describe('KK-P03a-3 (KK-031-8): eda_app zaman aşımları', () => {
  it('SELECT pg_sleep(16) 57014 ile sonlanır', async () => {
    const app = await connect('eda_app');
    try {
      const err = await app.query('SELECT pg_sleep(16)').then(
        () => undefined,
        (e: unknown) => pgCode(e).code,
      );
      expect(err).toBe('57014');
    } finally {
      await app.end();
    }
  });

  it('BEGIN; SELECT 1; sonrası 11 sn bekleyen bağlantı sunucu tarafından kapatılır', async () => {
    const app = await connect('eda_app');
    let closed = false;
    app.on('end', () => {
      closed = true;
    });
    await app.query('BEGIN');
    await app.query('SELECT 1');
    await new Promise((r) => setTimeout(r, 11_000));
    await expect(app.query('SELECT 1')).rejects.toThrow();
    expect(closed).toBe(true);
    await app.end().catch(() => undefined);
  });
});
