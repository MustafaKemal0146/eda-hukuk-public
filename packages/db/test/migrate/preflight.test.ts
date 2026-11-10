// @tk TK-29
// Ön koşul denetimi (032 §6.2; çıkış 10). Canlı küme olguları toplanır; her eksiklik olguların
// değiştirilmesiyle ayrı ayrı simüle edilir (initdb nesneleri testte silinemez).
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EXIT } from '../../src/migrate/index.ts';
import {
  evaluatePreflight,
  gatherPreflightFacts,
  type PreflightFacts,
} from '../../src/migrate/preflight.ts';
import { ownerDb } from '../fixtures/db.ts';
import { createScratch, ledgerCount, memoryLogger, type Scratch } from '../fixtures/scratch.ts';

let owner: pg.Client;
let facts: PreflightFacts;
let scratch: Scratch | undefined;

beforeAll(async () => {
  owner = await ownerDb();
  facts = await gatherPreflightFacts(owner);
});
afterEach(async () => {
  await scratch?.drop(owner);
  scratch = undefined;
});
afterAll(async () => {
  await owner.end();
});

const without = <T>(list: readonly T[], item: T): T[] => list.filter((x) => x !== item);

const MUTATIONS: readonly [string, (f: PreflightFacts) => PreflightFacts][] = [
  ['PostgreSQL < 18', (f) => ({ ...f, serverVersionNum: 170006 })],
  ['data_checksums kapalı', (f) => ({ ...f, dataChecksums: false })],
  [
    'rol eksik (eda_rls_helper)',
    (f) => ({ ...f, roles: f.roles.filter((r) => r.name !== 'eda_rls_helper') }),
  ],
  [
    'rol niteliği yanlış (eda_app BYPASSRLS)',
    (f) => ({
      ...f,
      roles: f.roles.map((r) => (r.name === 'eda_app' ? { ...r, bypassRls: true } : r)),
    }),
  ],
  [
    'NOLOGIN rol oturum açabiliyor',
    (f) => ({
      ...f,
      roles: f.roles.map((r) => (r.name === 'eda_sec_definer' ? { ...r, login: true } : r)),
    }),
  ],
  [
    'rol ayarı farklı (eda_app statement_timeout)',
    (f) => {
      const m = new Map(f.roleSettings);
      m.set('eda_app', { ...m.get('eda_app'), statement_timeout: '60s' });
      return { ...f, roleSettings: m };
    },
  ],
  [
    'eklenti eksik (btree_gist)',
    (f) => ({ ...f, extensions: without(f.extensions, 'btree_gist') }),
  ],
  ['eklenti eksik (vector)', (f) => ({ ...f, extensions: without(f.extensions, 'vector') })],
  [
    'shared_preload_libraries eksik (pg_textsearch)',
    (f) => ({ ...f, sharedPreloadLibraries: without(f.sharedPreloadLibraries, 'pg_textsearch') }),
  ],
  ['tr_hukuk yapılandırması eksik', (f) => ({ ...f, ftsConfig: false })],
  [
    'tr_hukuk_stem sözlüğü eksik',
    (f) => ({ ...f, dictionaries: without(f.dictionaries, 'tr_hukuk_stem') }),
  ],
  [
    'tr_hukuk_protected sözlüğü eksik',
    (f) => ({ ...f, dictionaries: without(f.dictionaries, 'tr_hukuk_protected') }),
  ],
  ['ts_debug duman testi başarısız', (f) => ({ ...f, tsSmokeLexemes: ['kanunun', 'maddesi'] })],
  ['tr-TR-x-icu eksik', (f) => ({ ...f, trCollation: false })],
  ['uuidv7() eksik', (f) => ({ ...f, uuidv7: false })],
];

describe('KK-P03a-12: ön koşul denetimi', () => {
  it('canlı TEST kümesi tüm ön koşulları sağlar (initdb 010-050)', () => {
    const result = evaluatePreflight(facts);
    expect(result.errors).toEqual([]);
    expect(facts.serverVersionNum).toBeGreaterThanOrEqual(180000);
    expect(facts.tsSmokeLexemes).toEqual(['kanun', 'madde']);
  });

  for (const [label, mutate] of MUTATIONS) {
    it(`${label}: migrate çıkış 10 ve hiçbir migrasyon uygulanmaz`, async () => {
      expect(evaluatePreflight(mutate(facts)).errors.length).toBeGreaterThan(0);
      scratch = await createScratch(owner);
      scratch.write([
        { name: 'schema_never', sql: '-- eda:kind schema\nCREATE TABLE {s}.never (id int);\n' },
      ]);
      const log = memoryLogger();
      const code = await scratch.run(owner, log, { preflight: async () => mutate(facts) });
      expect(code).toBe(EXIT.preflight);
      expect(log.events('preflight.failed').length).toBeGreaterThan(0);
      expect(await ledgerCount(owner, scratch.schema)).toBeNull();
    });
  }

  it('max_connections > 100 yalnız uyarıdır', () => {
    const result = evaluatePreflight({ ...facts, maxConnections: 200 });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});
