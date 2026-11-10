// @tk TK-01
// initdb betikleri ↔ beklenen rol tablosu (031 §2.1, §2.5; KK-031-7'nin statik yarısı). Canlı küme
// karşılaştırması test/roles/roles.test.ts'tedir; burada betik metni defaults.ts'e karşı denetlenir.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROLE_SPECS, roleSettingDiffs } from '../../src/migrate/roles.ts';

const INITDB = fileURLToPath(new URL('../../../../infra/postgres/initdb/', import.meta.url));
const read = (f: string) => readFileSync(`${INITDB}${f}`, 'utf8');

describe('KK-P03a-1 / KK-P03a-2: initdb betikleri', () => {
  it('010-roles.sql 10 rolü §2.1 LOGIN/BYPASSRLS nitelikleriyle oluşturur', () => {
    const sql = read('010-roles.sql');
    const roles = new Map(
      [...sql.matchAll(/^CREATE ROLE (\w+)\s+(.*);$/gm)].map((m) => [m[1] ?? '', m[2] ?? '']),
    );
    expect([...roles.keys()].sort()).toEqual(ROLE_SPECS.map((s) => s.name).sort());
    for (const spec of ROLE_SPECS) {
      const attrs = roles.get(spec.name) ?? '';
      expect(attrs, spec.name).toMatch(spec.login ? /\bLOGIN\b/ : /\bNOLOGIN\b/);
      expect(attrs, spec.name).toMatch(spec.bypassRls ? /\bBYPASSRLS\b/ : /\bNOBYPASSRLS\b/);
      expect(attrs, spec.name).toMatch(/\bNOSUPERUSER\b/);
    }
    expect(sql).toMatch(/GRANT eda_app TO eda_worker WITH INHERIT TRUE, SET FALSE;/);
    expect(sql).toMatch(/GRANT eda_rls_helper\s+TO eda_owner WITH INHERIT FALSE, SET TRUE;/);
    expect(sql).toMatch(/GRANT eda_sec_definer TO eda_owner WITH INHERIT FALSE, SET TRUE;/);
    expect(sql).not.toMatch(/CREATE EXTENSION/);
  });

  it('020-role-settings.sql değerleri defaults.ts db.* anahtarlarıyla eşit', () => {
    const actual = new Map<string, Record<string, string>>();
    for (const m of read('020-role-settings.sql').matchAll(
      /^ALTER ROLE (\w+)\s+IN DATABASE eda SET (\w+) = (.+);$/gm,
    )) {
      const role = m[1] ?? '';
      const value = (m[3] ?? '').replace(/^'(.*)'$/, '$1');
      actual.set(role, { ...actual.get(role), [m[2] ?? '']: value });
    }
    expect(roleSettingDiffs(actual)).toEqual([]);
  });
});
