// @tk TK-29
// check-migrations (032 §4.6, M-01…M-18; KK-032-5). Her kural için en az bir negatif örnek
// test/fixtures/migrations/bad/ altındadır; gerçek migrasyonlarda ihlal yoktur.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  lintDirectory,
  lintMigration,
  RULES,
  type Violation,
} from '../../scripts/check-migrations.ts';

const BAD = fileURLToPath(new URL('../fixtures/migrations/bad/', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));
// Y-96 deseni fixture dosyasında tutulmaz; testte parçalardan kurulur.
const MODEL_ID = ['gpt', '4o'].join('-');

interface Fixture {
  readonly file: string;
  readonly lintAs: string;
  readonly expect: string;
  readonly existing: string[];
  readonly dir?: string;
  readonly sql: string;
}

function meta(sql: string, key: string): string | undefined {
  return new RegExp(`^-- lint-${key}: (.+)$`, 'm').exec(sql)?.[1]?.trim();
}

const fixtures: Fixture[] = readdirSync(BAD)
  .filter((f) => f.endsWith('.sql'))
  .map((file) => {
    const sql = readFileSync(join(BAD, file), 'utf8').replaceAll('{{MODEL_ID}}', MODEL_ID);
    const dir = meta(sql, 'dir');
    return {
      file,
      lintAs: meta(sql, 'as') ?? file,
      expect: meta(sql, 'expect') ?? '',
      existing: (meta(sql, 'existing') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      ...(dir ? { dir } : {}),
      sql,
    };
  });

function lintDirWith(extraName: string, extraSql: string): Violation[] {
  const dir = mkdtempSync(join(tmpdir(), 'eda-lint-'));
  try {
    cpSync(MIGRATIONS, dir, { recursive: true });
    writeFileSync(join(dir, extraName), extraSql);
    return lintDirectory(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('KK-P03a-8 (KK-032-5): check-migrations M-01…M-18', () => {
  it('her kural için en az bir negatif örnek vardır', () => {
    const covered = new Set(fixtures.map((f) => f.expect));
    expect([...covered].sort()).toEqual([...RULES]);
  });

  for (const fx of fixtures) {
    it(`${fx.expect}: ${fx.file} ihlal olarak yakalanır`, () => {
      const violations =
        fx.dir === 'journal-missing'
          ? lintDirWith(fx.lintAs, fx.sql)
          : lintMigration(
              { name: fx.lintAs, sql: fx.sql },
              { existingTables: new Set(fx.existing) },
            );
      expect(violations.map((v) => v.code)).toContain(fx.expect);
    });
  }

  it('repodaki gerçek migrasyonlarda 0 ihlal', () => {
    expect(lintDirectory(MIGRATIONS)).toEqual([]);
  });

  it('geçerli örnekler geçer: işlemsiz yinelenebilir indeks, NOT VALID FK, sabit varsayılan', () => {
    const existing = { existingTables: new Set(['app.files', 'app.cases', 'app.deadlines']) };
    const good = [
      [
        '0020_index_files_org.sql',
        "-- eda:kind index\n-- eda:no-transaction\nSET lock_timeout = '2s';\nDROP INDEX CONCURRENTLY IF EXISTS app.files_org_idx;\n--> statement-breakpoint\nCREATE INDEX CONCURRENTLY IF NOT EXISTS files_org_idx ON app.files (org_id);\n",
      ],
      [
        '0021_expand_deadlines_case_fk.sql',
        '-- eda:kind expand\nALTER TABLE app.deadlines ADD CONSTRAINT deadlines_case_fk FOREIGN KEY (org_id, case_id) REFERENCES app.cases (org_id, id) NOT VALID;\n',
      ],
      [
        '0022_expand_cases_priority.sql',
        "-- eda:kind expand\nALTER TABLE app.cases ADD COLUMN priority text NOT NULL DEFAULT 'normal';\n",
      ],
      [
        '0023_fn_org_count.sql',
        '-- eda:kind fn\nCREATE FUNCTION app.org_count() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT count(*) FROM auth.organizations $$;\nREVOKE ALL ON FUNCTION app.org_count() FROM PUBLIC;\n',
      ],
    ] as const;
    for (const [name, sql] of good)
      expect(lintMigration({ name, sql }, existing), name).toEqual([]);
  });

  it('M-09: politika içinde geçersiz rol oturum değişkeni de yakalanır', () => {
    const roleVar = ['app', 'role'].join('.');
    const sql = `-- eda:kind rls\nCREATE POLICY cases_select ON app.cases FOR SELECT USING (${roleVar} IS NOT NULL);\n`;
    const codes = lintMigration(
      { name: '0009_rls_cases.sql', sql },
      { existingTables: new Set() },
    ).map((v) => v.code);
    expect(codes).toContain('M-09');
  });

  it('M-17: kapatılan kolona uygulama kodunda başvuru kalırsa yakalanır', () => {
    const sql =
      '-- eda:kind contract\n-- eda:contract-of 0016_expand_cases_ref\n-- eda:destructive eski kolon\nALTER TABLE app.cases DROP COLUMN legacy_ref;\n';
    const repo = new Map([['apps/api/src/repositories/cases.ts', 'select legacy_ref from cases']]);
    const v = lintMigration(
      { name: '0017_contract_cases_legacy_ref.sql', sql },
      { existingTables: new Set(['app.cases']), repoSources: repo },
    );
    expect(v.map((x) => x.code)).toEqual(['M-17']);
  });

  it('M-03: journal girdisinin dosyası veya snapshot dosyası yoksa yakalanır', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eda-lint-'));
    try {
      cpSync(MIGRATIONS, dir, { recursive: true });
      rmSync(join(dir, 'meta', '0001_snapshot.json'));
      rmSync(join(dir, '0003_rls_auth_column_grants.sql'));
      const v = lintDirectory(dir).filter((x) => x.code === 'M-03');
      expect(v.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AS-0125: REVOKE yetki listesi ve tetikleyici olay listesindeki TRUNCATE M-04/M-08 vermez; TRUNCATE deyimi verir', () => {
    const ok = [
      '-- eda:kind rls',
      'REVOKE UPDATE, DELETE, TRUNCATE ON app.audit_log FROM eda_app, eda_worker;',
      'CREATE TRIGGER audit_log_forbid_mutation BEFORE UPDATE OR DELETE OR TRUNCATE ON app.audit_log',
      '  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();',
      '',
    ].join('\n');
    expect(
      lintMigration({ name: '0030_rls_audit_guard.sql', sql: ok }, { existingTables: new Set() }),
    ).toEqual([]);
    const bad = '-- eda:kind rls\nTRUNCATE app.audit_log;\nTRUNCATE TABLE audit_log;\n';
    const codes = lintMigration(
      { name: '0031_rls_truncate.sql', sql: bad },
      { existingTables: new Set(['app.audit_log']) },
    ).map((v) => v.code);
    expect(codes).toContain('M-04');
    expect(codes).toContain('M-08');
  });
});
