// @tk TK-04
// KK-P04a-18 (Y-98, KK-031-4 uyumu): `authDb` (`@eda/db/auth`) ve Better Auth yalnız
// `apps/api/src/auth/**` içinden içe aktarılır; bu dizindeki Drizzle yazımları yalnız kimlik
// tablolarına (`AUTH_TABLES`) gider; `app.*` tablolarına SQL yazımı yalnız `withTenant` /
// `withUserScope` / `withNoTenant` geri çağrısı içinde yapılır; ham `pg` havuzu açılmaz.
// dependency-cruiser `db-auth-subpath` kuralının kaynak taraması eşidir.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const files = walk(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, 'utf8') }));
const inAuth = (p: string) => p.startsWith('auth/');
const IMPORT = (spec: string) => new RegExp(`from '${spec.replace('/', '\\/')}(?:/[^']*)?'`);

describe('KK-P04a-18 (Y-98): authDb ve Better Auth sınırı', () => {
  it('@eda/db/auth ve better-auth yalnız src/auth/** içinden içe aktarılır', () => {
    const offenders = files
      .filter((f) => !inAuth(f.path))
      .filter((f) => IMPORT('@eda/db/auth').test(f.text) || IMPORT('better-auth').test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
    expect(files.some((f) => inAuth(f.path) && IMPORT('@eda/db/auth').test(f.text))).toBe(true);
  });

  it('src/auth Drizzle yazımları yalnız kimlik tablolarına', () => {
    // `auth-db.ts` içe aktarılmaz (dependency-cruiser `auth-db-isolated`); küme kaynaktan okunur.
    const authDbSource = files.find((f) => f.path === 'auth/auth-db.ts')?.text ?? '';
    const tables = /AUTH_TABLES = \{([^}]*)\}/.exec(authDbSource)?.[1] ?? '';
    const allowed = new Set(
      tables
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
    );
    expect([...allowed].sort()).toEqual([
      'accounts',
      'invitations',
      'members',
      'organizations',
      'passkeys',
      'sessions',
      'twoFactors',
      'users',
    ]);
    const targets = files
      .filter((f) => inAuth(f.path))
      .flatMap((f) => [...f.text.matchAll(/\.(insert|update|delete)\((\w+)\)/g)].map((m) => m[2]));
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(allowed.has(t ?? '')).toBe(true);
  });

  it('src/auth içinde app.* yazımı yalnız appDb sarmalayıcılarının geri çağrısında', () => {
    let checked = 0;
    for (const f of files.filter((x) => inAuth(x.path))) {
      for (const m of f.text.matchAll(/(INSERT INTO|UPDATE|DELETE FROM) app\./g)) {
        const at = m.index ?? 0;
        const before = f.text.slice(0, at);
        const wrappers = [...before.matchAll(/\.with(?:Tenant|UserScope|NoTenant)\(/g)];
        const last = wrappers.at(-1);
        expect(last, `${f.path}: ${m[0]}`).toBeDefined();
        // Sarmalayıcı çağrısının parantezi yazım noktasında hâlâ açık olmalı (geri çağrı içi).
        let depth = 0;
        for (const ch of before.slice((last?.index ?? 0) + (last?.[0].length ?? 0) - 1)) {
          if (ch === '(') depth += 1;
          else if (ch === ')') depth -= 1;
        }
        expect(depth, `${f.path}: ${m[0]}`).toBeGreaterThan(0);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('src/** ham pg havuzu açmaz ve @eda/db/testing içe aktarmaz', () => {
    const offenders = files
      .filter((f) => IMPORT('pg').test(f.text) || IMPORT('@eda/db/testing').test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
