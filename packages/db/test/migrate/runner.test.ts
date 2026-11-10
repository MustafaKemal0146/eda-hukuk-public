// @tk TK-29
// Migrasyon çalıştırıcısı (032 §4, §6; KK-032-1…4, KK-032-22). Gerçek defter (`public`) yalnız
// KK-P03a-4'ün ilk adımında okunur; diğer senaryolar yalıtılmış şemada koşar (fixtures/scratch.ts).
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, runMigrate } from '../../src/migrate/index.ts';
import {
  makeClient,
  ownerDb,
  pgTarget,
  ROLE_SECRET,
  rolePassword,
  secretPath,
} from '../fixtures/db.ts';
import {
  createScratch,
  ledgerCount,
  memoryLogger,
  relationExists,
  type Scratch,
} from '../fixtures/scratch.ts';

const PKG = fileURLToPath(new URL('../../', import.meta.url));
const allLogs: string[] = [];

let owner: pg.Client;
let scratch: Scratch;

beforeAll(async () => {
  owner = await ownerDb();
});
afterAll(async () => {
  await owner.end();
});
afterEach(async () => {
  await scratch?.drop(owner);
});

const BASIC = [
  {
    name: 'schema_alpha',
    sql: '-- eda:kind schema\nCREATE TABLE {s}.alpha (id int PRIMARY KEY);\n',
  },
  { name: 'schema_beta', sql: '-- eda:kind schema\nCREATE TABLE {s}.beta (id int PRIMARY KEY);\n' },
];

describe('KK-P03a-4 (KK-032-1): boş veritabanı, defter ve ikinci çalıştırma', () => {
  it('gerçek defter satır sayısı meta/_journal.json girdi sayısına eşit; ikinci çalıştırma 0 uygular', async () => {
    const journal = JSON.parse(readFileSync(`${PKG}migrations/meta/_journal.json`, 'utf8')) as {
      entries: unknown[];
    };
    const res = await owner.query<{ n: string }>(
      'SELECT count(*) AS n FROM public.schema_migrations',
    );
    expect(Number(res.rows[0]?.n)).toBe(journal.entries.length);

    const log = memoryLogger();
    const code = await runMigrate({ client: owner, edaEnv: 'test', log });
    allLogs.push(JSON.stringify(log.entries));
    expect(code).toBe(EXIT.ok);
    expect(log.events('migrations.pending')[0]?.pending).toBe(0);
    expect(log.events('migrate.done')[0]?.applied).toBe(0);
    expect(log.events('audit.ok')).toHaveLength(1);
  });

  it('yalıtılmış boş defter: çıkış 0, satır sayısı = journal; hemen ikinci çalıştırma uygulanan 0', async () => {
    scratch = await createScratch(owner);
    const ids = scratch.write(BASIC);
    const log = memoryLogger();
    expect(await scratch.run(owner, log)).toBe(EXIT.ok);
    expect(await ledgerCount(owner, scratch.schema)).toBe(ids.length);
    const again = memoryLogger();
    expect(await scratch.run(owner, again)).toBe(EXIT.ok);
    expect(again.events('migrate.done')[0]?.applied).toBe(0);
    const rows = await owner.query(
      `SELECT seq, id, kind, tx_mode, attempts FROM ${scratch.schema}.schema_migrations ORDER BY seq`,
    );
    expect(rows.rows).toEqual([
      { seq: 0, id: ids[0], kind: 'schema', tx_mode: 'transaction', attempts: 1 },
      { seq: 1, id: ids[1], kind: 'schema', tx_mode: 'transaction', attempts: 1 },
    ]);
    allLogs.push(JSON.stringify([...log.entries, ...again.entries]));
  });
});

describe('KK-P03a-5 (KK-032-2): değişmezlik ve sıra', () => {
  it('uygulanmış dosyada bir bayt değişince çıkış 20 ve hiçbir değişiklik yok', async () => {
    scratch = await createScratch(owner);
    const [first] = scratch.write(BASIC.slice(0, 1));
    expect(await scratch.run(owner, memoryLogger())).toBe(EXIT.ok);
    // Bekleyen ikinci migrasyon eklenir; ilk dosyada tek bayt değişir.
    scratch.write(BASIC);
    const path = scratch.file(first ?? '');
    writeFileSync(path, readFileSync(path, 'utf8').replace('PRIMARY KEY', 'PRIMARY  KEY'));
    const log = memoryLogger();
    expect(await scratch.run(owner, log)).toBe(EXIT.checksum);
    expect(await relationExists(owner, `${scratch.schema}.beta`)).toBe(false);
    expect(await ledgerCount(owner, scratch.schema)).toBe(1);
    allLogs.push(JSON.stringify(log.entries));
  });

  it('defterdeki dosya silinirse çıkış 20', async () => {
    scratch = await createScratch(owner);
    const ids = scratch.write(BASIC);
    expect(await scratch.run(owner, memoryLogger())).toBe(EXIT.ok);
    rmSync(scratch.file(ids[1] ?? ''));
    expect(await scratch.run(owner, memoryLogger())).toBe(EXIT.checksum);
  });

  it('journal sırası bozulursa çıkış 21', async () => {
    scratch = await createScratch(owner);
    scratch.write(BASIC);
    expect(await scratch.run(owner, memoryLogger())).toBe(EXIT.ok);
    const journalPath = `${scratch.dir}/meta/_journal.json`;
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
    journal.entries.reverse();
    writeFileSync(journalPath, JSON.stringify(journal));
    expect(await scratch.run(owner, memoryLogger())).toBe(EXIT.order);
  });
});

describe('KK-P03a-6 (KK-032-3): eşzamanlı iki migrate', () => {
  it('migrasyonlar tam bir kez uygulanır (ikinci süreç kilidi bekler, sonra bekleyen bulmaz)', async () => {
    scratch = await createScratch(owner);
    scratch.write([
      {
        name: 'schema_once',
        // IF NOT EXISTS yok: ikinci kez uygulanırsa hata verir; sayaç tam bir kez artar.
        sql: '-- eda:kind schema\nCREATE TABLE {s}.once (n int);\nINSERT INTO {s}.once VALUES (1);\nSELECT pg_sleep(0.3);\n',
      },
      ...BASIC,
    ]);
    const a = await ownerDb();
    const b = await ownerDb();
    try {
      const [la, lb] = [memoryLogger(), memoryLogger()];
      const codes = await Promise.all([scratch.run(a, la), scratch.run(b, lb)]);
      expect(codes).toEqual([EXIT.ok, EXIT.ok]);
      const applied = [la, lb].map((l) => l.events('migrate.done')[0]?.applied ?? -1).sort();
      expect(applied).toEqual([0, 3]);
      const once = await owner.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${scratch.schema}.once`,
      );
      expect(Number(once.rows[0]?.n)).toBe(1);
      expect(await ledgerCount(owner, scratch.schema)).toBe(3);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it('danışma kilidi süresi içinde alınamazsa çıkış 11', async () => {
    scratch = await createScratch(owner);
    scratch.write(BASIC);
    const holder = await ownerDb();
    try {
      await holder.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [scratch.lockKey]);
      const code = await scratch.run(owner, memoryLogger(), { settings: { advisoryWaitSec: 1 } });
      expect(code).toBe(EXIT.advisoryLock);
      expect(await ledgerCount(owner, scratch.schema)).toBeNull();
    } finally {
      await holder.end();
    }
  });
});

describe('KK-P03a-7 (KK-032-4): kilit çakışması ve yeniden deneme', () => {
  const LOCKING = {
    name: 'expand_locked_column',
    sql: [
      '-- eda:kind expand',
      '-- eda:lock-timeout 100ms',
      'CREATE TABLE {s}.partial (id int);',
      'ALTER TABLE {s}.locked ADD COLUMN x int;',
      '',
    ].join('\n'),
  };

  it('kilit bırakılırsa yeniden denemeyle tamamlanır', async () => {
    scratch = await createScratch(owner);
    await owner.query(`CREATE TABLE ${scratch.schema}.locked (id int)`);
    scratch.write([LOCKING]);
    const holder = await ownerDb();
    await holder.query('BEGIN');
    await holder.query(`LOCK TABLE ${scratch.schema}.locked IN ACCESS EXCLUSIVE MODE`);
    let sleeps = 0;
    const log = memoryLogger();
    try {
      const code = await scratch.run(owner, log, {
        sleep: async () => {
          sleeps += 1;
          if (sleeps === 2) await holder.query('COMMIT');
        },
      });
      expect(code).toBe(EXIT.ok);
      expect(log.events('migration.retry').map((e) => e.sqlstate)).toEqual(['55P03', '55P03']);
      const row = await owner.query(`SELECT attempts FROM ${scratch.schema}.schema_migrations`);
      expect(row.rows[0]?.attempts).toBe(3);
      expect(await relationExists(owner, `${scratch.schema}.partial`)).toBe(true);
    } finally {
      await holder.end();
    }
    allLogs.push(JSON.stringify(log.entries));
  });

  it('kilit bırakılmazsa db.migrationLockRetries kez dener, çıkış 31 ve kısmi değişiklik yok', async () => {
    scratch = await createScratch(owner);
    await owner.query(`CREATE TABLE ${scratch.schema}.locked (id int)`);
    scratch.write([LOCKING]);
    const holder = await ownerDb();
    await holder.query('BEGIN');
    await holder.query(`LOCK TABLE ${scratch.schema}.locked IN ACCESS EXCLUSIVE MODE`);
    const log = memoryLogger();
    try {
      const code = await scratch.run(owner, log);
      expect(code).toBe(EXIT.lockRetriesExhausted);
      expect(log.events('migration.retry')).toHaveLength(
        CONFIG_DEFAULTS['db.migrationLockRetries'],
      );
    } finally {
      await holder.end();
    }
    expect(await relationExists(owner, `${scratch.schema}.partial`)).toBe(false);
    const cols = await owner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'locked'`,
      [scratch.schema],
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual(['id']);
    expect(await ledgerCount(owner, scratch.schema)).toBe(0);
    allLogs.push(JSON.stringify(log.entries));
  });
});

describe('KK-P03a-5 / KK-P03a-7: işlemsiz dosya ve durdurma ilkesi', () => {
  it('no-transaction dosyası yarıda kalınca deftere yazılmaz; yeniden koşunca tamamlanır', async () => {
    scratch = await createScratch(owner);
    scratch.write([
      {
        name: 'index_nt',
        sql: [
          '-- eda:kind index',
          '-- eda:no-transaction',
          'CREATE TABLE IF NOT EXISTS {s}.nt (id int);',
          '--> statement-breakpoint',
          'CREATE INDEX CONCURRENTLY IF NOT EXISTS nt_id_idx ON {s}.nt (id);',
          '--> statement-breakpoint',
          'CREATE INDEX CONCURRENTLY IF NOT EXISTS nt_later_idx ON {s}.nt_later (id);',
          '',
        ].join('\n'),
      },
    ]);
    expect(await scratch.run(owner, memoryLogger())).toBe(EXIT.sqlError);
    expect(await relationExists(owner, `${scratch.schema}.nt_id_idx`)).toBe(true);
    expect(await ledgerCount(owner, scratch.schema)).toBe(0);
    await owner.query(`CREATE TABLE ${scratch.schema}.nt_later (id int)`);
    expect(await scratch.run(owner, memoryLogger())).toBe(EXIT.ok);
    const row = await owner.query(`SELECT tx_mode FROM ${scratch.schema}.schema_migrations`);
    expect(row.rows[0]?.tx_mode).toBe('none');
    expect(await relationExists(owner, `${scratch.schema}.nt_later_idx`)).toBe(true);
  });

  it('başarısız dosyadan sonrakiler koşmaz (çıkış 30, işlem geri alınır)', async () => {
    scratch = await createScratch(owner);
    scratch.write([
      BASIC[0] ?? { name: '', sql: '' },
      {
        name: 'schema_broken',
        sql: '-- eda:kind schema\nCREATE TABLE {s}.half (id int);\nSELECT 1 / 0;\n',
      },
      BASIC[1] ?? { name: '', sql: '' },
    ]);
    const log = memoryLogger();
    expect(await scratch.run(owner, log)).toBe(EXIT.sqlError);
    expect(await ledgerCount(owner, scratch.schema)).toBe(1);
    expect(await relationExists(owner, `${scratch.schema}.half`)).toBe(false);
    expect(await relationExists(owner, `${scratch.schema}.beta`)).toBe(false);
    expect(log.events('migration.failed')[0]?.sqlstate).toBe('22012');
    allLogs.push(JSON.stringify(log.entries));
  });

  it('eda:kind dosya adıyla uyuşmazsa uygulanmaz', async () => {
    scratch = await createScratch(owner);
    scratch.write([
      { name: 'schema_mismatch', sql: '-- eda:kind rls\nCREATE TABLE {s}.m (id int);\n' },
    ]);
    expect(await scratch.run(owner, memoryLogger())).toBe(EXIT.sqlError);
    expect(await relationExists(owner, `${scratch.schema}.m`)).toBe(false);
  });
});

function runBin(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/bin/migrate.ts'], { cwd: PKG, env });
    let out = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe('KK-P03a-9 (KK-032-22): migrate günlüğünde SQL, parametre, parola ve satır içeriği yok', () => {
  it('migrate girişi (bin) JSON günlük yazar, çıkış 0; profil kapısı çıkış 60', async () => {
    const t = pgTarget();
    const base = {
      EDA_ENV: 'test',
      NODE_ENV: 'test',
      PG_HOST: t.host,
      PG_PORT: String(t.port),
      PG_DATABASE: t.database,
      PG_USER: 'eda_owner',
      PG_PASSWORD_FILE: secretPath(ROLE_SECRET.eda_owner),
      S3_ENDPOINT: 'http://objstore:8333',
      S3_ADMIN_ACCESS_KEY_ID_FILE: secretPath('s3_admin_access_key_id'),
      S3_ADMIN_SECRET_ACCESS_KEY_FILE: secretPath('s3_admin_secret_access_key'),
      SEED_PROFILE: 'prod',
    };
    const ok = await runBin(base);
    expect(ok.code).toBe(EXIT.ok);
    const lines = ok.out.trim().split('\n');
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(lines.some((l) => JSON.parse(l).event === 'migrate.done')).toBe(true);
    allLogs.push(ok.out);

    const gated = await runBin({ ...base, EDA_ENV: 'production', SEED_PROFILE: 'dev' });
    expect(gated.code).toBe(EXIT.profileGate);
  });

  it('toplanan tüm günlüklerde SQL anahtar sözcüğü, parola veya satır değeri geçmez', () => {
    const text = allLogs.join('\n');
    expect(text.length).toBeGreaterThan(0);
    for (const word of [
      'CREATE ',
      'ALTER ',
      'INSERT ',
      'SELECT ',
      'UPDATE ',
      'DROP ',
      'GRANT ',
      'pg_sleep',
    ]) {
      expect(text).not.toContain(word);
    }
    for (const role of Object.keys(ROLE_SECRET) as (keyof typeof ROLE_SECRET)[]) {
      expect(text).not.toContain(rolePassword(role));
    }
    expect(text).not.toMatch(/password|parola|secret|token/i);
  });
});

describe('KK-P03a-16 öncülü: migrate yalnız eda_owner ile çalışır', () => {
  it('eda_app ile çalıştırma defteri kuramaz (yetki hatası, çıkış 30)', async () => {
    scratch = await createScratch(owner);
    scratch.write(BASIC);
    const app = makeClient('eda_app');
    await app.connect();
    try {
      expect(await scratch.run(app, memoryLogger())).toBe(EXIT.sqlError);
    } finally {
      await app.end();
    }
  });
});
