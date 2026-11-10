// Migrasyon statik lint'i (032 §4.6, M-01…M-18; `make lint` ve `db:check` içinde).
// Kullanım: node packages/db/scripts/check-migrations.ts [--dir <migrations>] [--against-last-tag]
// SQL ayrıştırıcısı değildir: yorumlar, dize sabitleri ve $$ gövdeleri ayıklanmış metin üzerinde
// desen denetimi yapar. Negatif örnekler test/fixtures/migrations/bad/ (KK-P03a-8).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  headerLines,
  MAX_STATEMENT_TIMEOUT_MS,
  MIGRATION_KINDS,
  parseDurationMs,
  STATEMENT_BREAKPOINT,
} from '../src/migrate/header.ts';

export const RULES = [
  'M-01',
  'M-02',
  'M-03',
  'M-04',
  'M-05',
  'M-06',
  'M-07',
  'M-08',
  'M-09',
  'M-10',
  'M-11',
  'M-12',
  'M-13',
  'M-14',
  'M-15',
  'M-16',
  'M-17',
  'M-18',
] as const;
export type RuleCode = (typeof RULES)[number];

export interface Violation {
  readonly code: RuleCode;
  readonly file: string;
  readonly message: string;
}

export const NAME_RE = new RegExp(
  `^[0-9]{4}_(${MIGRATION_KINDS.join('|')})_[a-z0-9_]{3,60}\\.sql$`,
);
/** Y-96 model kimliği deseni (001 §8). */
export const MODEL_ID_RE =
  /deepseek-(chat|reasoner|flash|v\d)|deepseek-v\d|gpt-(\d|4o)|claude-(\d|opus|sonnet|haiku)|gemini-\d|mistral-(small|medium|large)/i;

// ---------- metin ayıklama ----------

/** Yorumları siler; dize sabitleri ve $$ gövdeleri korunur. */
export function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? sql.length : nl;
      continue;
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    const ch = sql[i] ?? '';
    if (ch === "'") {
      const end = closingQuote(sql, i);
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end < 0 ? sql.length : end + tag.length;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function closingQuote(sql: string, start: number): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return sql.length;
}

/** Dize sabitlerini `''`, $$ gövdelerini `$$ $$` ile değiştirir (girdi yorumsuz olmalı). */
export function stripLiterals(sql: string, keepBodies = false): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i] ?? '';
    if (ch === "'") {
      i = closingQuote(sql, i);
      out += "''";
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end < 0 ? sql.length : end + tag.length;
      out += keepBodies ? sql.slice(i, stop) : '$$ $$';
      i = stop;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Dolar gövdelerini kaldırır, dize sabitlerini korur. */
function stripBodies(noComments: string): string {
  return noComments.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '$$$$ $$$$');
}

const statements = (code: string): string[] =>
  code
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s !== '');

const IDENT = '"?[A-Za-z_][A-Za-z0-9_]*"?';
const QNAME = String.raw`${IDENT}(?:\.${IDENT})?`;
// SQL adları ASCII ve küçük harflidir (030 §1.9); yalnız tırnaklar kaldırılır.
const unquote = (s: string): string => s.replaceAll('"', '');

// ---------- başlık ----------

interface RawHeader {
  readonly directives: ReadonlyMap<string, string>;
  readonly duplicates: readonly string[];
  readonly unknown: readonly string[];
}

const KNOWN = new Set([
  'kind',
  'lock-timeout',
  'statement-timeout',
  'no-transaction',
  'patched',
  'contract-of',
  'destructive',
  'backfill',
  'backfill-batched',
]);

function readHeader(sql: string): RawHeader {
  const directives = new Map<string, string>();
  const duplicates: string[] = [];
  const unknown: string[] = [];
  for (const line of headerLines(sql)) {
    const m = /^--\s*eda:([a-z-]+)(?:\s+(.*))?$/.exec(line);
    if (!m) continue;
    const name = m[1] ?? '';
    if (!KNOWN.has(name)) unknown.push(name);
    if (directives.has(name)) duplicates.push(name);
    directives.set(name, (m[2] ?? '').trim());
  }
  return { directives, duplicates, unknown };
}

// ---------- tek dosya ----------

export interface LintContext {
  /** Önceki migrasyonlarda oluşturulmuş tablolar (`şema.tablo`, küçük harf). */
  readonly existingTables: ReadonlySet<string>;
  /** M-17: uygulama/paket kaynak dosyaları (migrasyonlar hariç): yol -> içerik. */
  readonly repoSources?: ReadonlyMap<string, string>;
}

export interface MigrationInput {
  readonly name: string;
  readonly sql: string;
}

/** Dosyanın oluşturduğu tablolar (`şema.tablo`). */
export function createdTables(sql: string): string[] {
  const code = stripLiterals(stripComments(sql));
  const re = new RegExp(
    String.raw`\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`,
    'gi',
  );
  return [...code.matchAll(re)].map((m) => unquote(m[1] ?? ''));
}

export function lintMigration(input: MigrationInput, ctx: LintContext): Violation[] {
  const v: Violation[] = [];
  const add = (code: RuleCode, message: string): void => {
    v.push({ code, file: input.name, message });
  };
  const { name, sql } = input;

  // M-01
  if (name.endsWith('.down.sql')) add('M-01', '.down.sql dosyası yasak (yalnız ileri)');
  else if (!NAME_RE.test(name)) add('M-01', 'dosya adı NNNN_<tür>_<konu>.sql biçiminde değil');

  // M-02 + M-18
  const header = readHeader(sql);
  const nameKind = /^[0-9]{4}_([a-z]+)_/.exec(name)?.[1];
  const kind = header.directives.get('kind');
  if (kind === undefined) add('M-02', '-- eda:kind eksik');
  else if (kind !== nameKind)
    add('M-02', `-- eda:kind ${kind} dosya adındaki tür (${nameKind ?? '?'}) ile eşit değil`);
  for (const d of header.unknown) add('M-02', `bilinmeyen direktif: eda:${d}`);
  for (const d of header.duplicates) add('M-02', `yinelenen direktif: eda:${d}`);
  const st = header.directives.get('statement-timeout');
  if (st !== undefined) {
    try {
      if (parseDurationMs(st) > MAX_STATEMENT_TIMEOUT_MS)
        add('M-18', 'statement-timeout 60 dakikayı aşıyor');
    } catch {
      add('M-18', 'statement-timeout değeri okunamadı');
    }
  }
  const noTx = header.directives.has('no-transaction');

  const noComments = stripComments(sql);
  const code = stripLiterals(noComments);
  const codeWithBodies = stripLiterals(noComments, true);
  const outsideBodies = stripBodies(noComments);
  const stmts = statements(code);
  const created = new Set(createdTables(sql));
  const isExisting = (t: string): boolean => {
    const n = unquote(t);
    return !created.has(n) && (ctx.existingTables.has(n) || !n.includes('.'));
  };

  // M-04: yıkıcı deyimler yalnız contract + eda:destructive
  const destructive = [
    /\bDROP\s+(TABLE|COLUMN|SCHEMA|CONSTRAINT)\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i,
    /\bRENAME\b/i,
  ];
  // TRUNCATE yalnız deyim başında yıkıcıdır; REVOKE yetki listesi ve tetikleyici olay listesindeki
  // (`BEFORE UPDATE OR DELETE OR TRUNCATE ON …`) sözcük deyim değildir.
  const truncates = stmts.some((st) => /^\s*TRUNCATE\b/i.test(st));
  if (truncates || destructive.some((re) => re.test(code))) {
    if (kind !== 'contract') add('M-04', 'yıkıcı deyim yalnız contract türünde');
    else if (!header.directives.has('destructive'))
      add('M-04', 'yıkıcı deyim -- eda:destructive gerektirir');
  }

  for (const s of stmts) {
    // M-05: mevcut tabloda indeks yalnız CONCURRENTLY + no-transaction
    const idx = new RegExp(
      String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:${IDENT}\s+)?ON\s+(?:ONLY\s+)?(${QNAME})`,
      'i',
    ).exec(s);
    if (idx && isExisting(idx[2] ?? '') && (!idx[1] || !noTx)) {
      add(
        'M-05',
        `mevcut tabloda indeks yalnız CONCURRENTLY ve -- eda:no-transaction ile: ${idx[2]}`,
      );
    }
    const alter = new RegExp(
      String.raw`^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(${QNAME})\s+(.*)$`,
      'i',
    ).exec(s);
    if (alter && isExisting(alter[1] ?? '')) {
      const rest = alter[2] ?? '';
      // M-06: mevcut tabloda NOT NULL yalnız sabit DEFAULT ile; değişken varsayılan yasak
      for (const col of rest.split(/,\s*(?=ADD\b)/i)) {
        if (!/^ADD\s+(COLUMN\s+)?/i.test(col) || /^ADD\s+CONSTRAINT/i.test(col)) continue;
        const def = /\bDEFAULT\s+([^\s,]+)/i.exec(col);
        const variable = def !== null && /\(/.test(def[1] ?? '');
        if (variable)
          add('M-06', 'mevcut tabloya değişken varsayılanlı kolon (önce NULL + backfill)');
        else if (/\bNOT\s+NULL\b/i.test(col) && def === null) {
          add('M-06', 'mevcut tabloya varsayılansız NOT NULL kolon');
        }
      }
      // M-07: mevcut tabloda FK/CHECK yalnız NOT VALID
      if (
        /\bADD\s+CONSTRAINT\b[\s\S]*?\b(FOREIGN\s+KEY|CHECK)\b/i.test(rest) &&
        !/\bNOT\s+VALID\b/i.test(rest)
      ) {
        add('M-07', 'mevcut tabloya FK/CHECK yalnız NOT VALID ile (VALIDATE ayrı dosyada)');
      }
    }
  }

  // M-08: şema-niteliksiz nesne adı
  const qualifiedTargets = [
    String.raw`\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`,
    String.raw`\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(${QNAME})`,
    String.raw`\bINDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:${IDENT}\s+)?ON\s+(?:ONLY\s+)?(${QNAME})`,
    String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|VIEW|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`,
    String.raw`\bALTER\s+(?:FUNCTION|PROCEDURE|VIEW|SEQUENCE)\s+(${QNAME})`,
    String.raw`\bTRIGGER\s+${IDENT}\s+(?:BEFORE|AFTER|INSTEAD\s+OF)\s+[\s\S]*?\bON\s+(${QNAME})`,
    String.raw`\bPOLICY\s+${IDENT}\s+ON\s+(${QNAME})`,
    String.raw`\b(?:INSERT\s+INTO|DELETE\s+FROM)\s+(${QNAME})`,
    String.raw`^\s*TRUNCATE(?:\s+TABLE)?\s+(?:ONLY\s+)?(${QNAME})`,
    String.raw`\b(?:GRANT|REVOKE)\s+[\s\S]*?\bON\s+(?:TABLE\s+|FUNCTION\s+|SEQUENCE\s+)?(?!SCHEMA\b|DATABASE\b|ALL\b|TABLES\b|FUNCTIONS\b|SEQUENCES\b|TYPES\b)(${QNAME})`,
  ];
  for (const s of stmts) {
    for (const pat of qualifiedTargets) {
      for (const m of s.matchAll(new RegExp(pat, 'gi'))) {
        const target = m[1] ?? '';
        if (!target.includes('.')) add('M-08', `şema-niteliksiz ad: ${target}`);
      }
    }
  }

  // M-09: politikada current_setting veya rol oturum değişkeni
  for (const s of statements(stripLiterals(noComments))) {
    if (/^CREATE\s+POLICY\b/i.test(s) && /\b(current_setting|app\.role)\b/i.test(s)) {
      add('M-09', 'CREATE POLICY içinde current_setting / rol oturum değişkeni');
    }
  }

  // M-10: app şemasında yetki yalnız rls/fn/backfill; app'te DEFAULT PRIVILEGES ve ON ALL TABLES yasak
  if (/\bGRANT\b[^;]*\bON\s+(?:TABLE\s+|SEQUENCE\s+|FUNCTION\s+)?"?app"?\./i.test(code)) {
    if (!['rls', 'fn', 'backfill'].includes(kind ?? ''))
      add('M-10', 'app nesnesine GRANT yalnız rls/fn/backfill türünde');
  }
  if (/\bALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*\bIN\s+SCHEMA\s+[^;]*\bapp\b/i.test(code)) {
    add('M-10', 'app şemasında DEFAULT PRIVILEGES yasak');
  }
  if (/\bGRANT\b[^;]*\bON\s+ALL\s+TABLES\b/i.test(code)) add('M-10', 'GRANT … ON ALL TABLES yasak');

  // M-11: SECURITY DEFINER -> SET search_path + aynı dosyada REVOKE … FROM PUBLIC
  const fnRe = new RegExp(
    String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(${QNAME})\s*\(([\s\S]*?)(?=\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b|$)`,
    'gi',
  );
  for (const m of codeWithBodies.matchAll(fnRe)) {
    const def = (m[2] ?? '').replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '');
    if (!/\bSECURITY\s+DEFINER\b/i.test(def)) continue;
    const fn = unquote(m[1] ?? '');
    if (!/\bSET\s+search_path\b/i.test(def))
      add('M-11', `SECURITY DEFINER search_path sabitlemiyor: ${fn}`);
    const esc = fn.replace('.', String.raw`"?\."?`);
    const revoke = new RegExp(
      String.raw`\bREVOKE\s+(?:ALL|EXECUTE)[^;]*\bON\s+FUNCTION\s+"?${esc}"?[^;]*\bFROM\s+PUBLIC\b`,
      'i',
    );
    if (!revoke.test(code)) add('M-11', `SECURITY DEFINER için REVOKE … FROM PUBLIC yok: ${fn}`);
  }

  // M-12
  if (
    /\b(CREATE|ALTER)\s+ROLE\b|\bCREATE\s+EXTENSION\b|\bCREATE\s+TYPE\s+[^;]*\bAS\s+ENUM\b/i.test(
      code,
    )
  ) {
    add('M-12', 'CREATE/ALTER ROLE, CREATE EXTENSION ve CREATE TYPE … AS ENUM migrasyonda yasak');
  }
  // M-13
  if (
    /\bVACUUM\s+(\([^)]*FULL[^)]*\)|FULL)\b|\bCLUSTER\b|\bREINDEX\b(?!\s+(?:\(\s*CONCURRENTLY|(?:INDEX|TABLE|SCHEMA)\s+CONCURRENTLY))/i.test(
      code,
    )
  ) {
    add('M-13', 'VACUUM FULL, CLUSTER ve CONCURRENTLY olmayan REINDEX yasak');
  }
  // M-14: kiracı bağı yalnız tenant.ts; app.deletion_reason yalnız fonksiyon gövdesinde
  if (
    /set_config\s*\(\s*'app\.(org_id|user_id)'/i.test(noComments) ||
    /\bSET\s+(LOCAL\s+)?app\.(org_id|user_id)\b/i.test(noComments)
  ) {
    add('M-14', "migrasyonda set_config('app.org_id'/'app.user_id') veya SET app.… yasak");
  } else if (
    /set_config\s*\(\s*'app\./i.test(outsideBodies) ||
    /\bSET\s+(LOCAL\s+)?app\./i.test(outsideBodies)
  ) {
    add('M-14', 'app.* oturum değişkeni yalnız imha fonksiyonu gövdesinde ayarlanabilir');
  }
  // M-15
  if (!name.includes('_seed_ai_') && MODEL_ID_RE.test(noComments)) {
    add('M-15', 'model kimliği deseni yalnız *_seed_ai_*.sql dosyalarında');
  }
  // M-16: işlemsiz dosyada her deyim IF [NOT] EXISTS
  if (noTx) {
    for (const chunk of sql.split(STATEMENT_BREAKPOINT)) {
      for (const s of statements(stripLiterals(stripComments(chunk)))) {
        if (/^(SET|RESET)\b/i.test(s)) continue;
        if (!/\bIF\s+(NOT\s+)?EXISTS\b/i.test(s))
          add('M-16', 'işlemsiz dosyada deyim yinelenebilir değil (IF [NOT] EXISTS)');
      }
    }
  }
  // M-17: contract dosyası contract-of taşır ve kapatılan nesneye kodda başvuru kalmaz
  if (kind === 'contract') {
    if (!header.directives.get('contract-of'))
      add('M-17', 'contract dosyasında -- eda:contract-of yok');
    const dropped = [
      ...[
        ...code.matchAll(
          new RegExp(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(${QNAME})`, 'gi'),
        ),
      ].map(
        (m) =>
          unquote(m[1] ?? '')
            .split('.')
            .pop() ?? '',
      ),
      ...[
        ...code.matchAll(
          new RegExp(String.raw`\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(${IDENT})`, 'gi'),
        ),
      ].map((m) => unquote(m[1] ?? '')),
    ].filter((n) => n !== '');
    for (const obj of dropped) {
      const re = new RegExp(String.raw`\b${obj}\b`);
      for (const [path, text] of ctx.repoSources ?? []) {
        if (re.test(text)) add('M-17', `kapatılan nesneye kodda başvuru var: ${obj} (${path})`);
      }
    }
  }
  return v;
}

// ---------- dizin ----------

interface JournalFile {
  readonly entries: readonly { idx: number; tag: string }[];
}

/** Migrasyon dizinini denetler (M-01…M-18). */
export function lintDirectory(dir: string, repoSources?: ReadonlyMap<string, string>): Violation[] {
  const v: Violation[] = [];
  const files = readdirSync(dir).filter((f) => !f.startsWith('.') && f !== 'meta');
  const metaDir = join(dir, 'meta');
  const journalPath = join(metaDir, '_journal.json');
  let journal: JournalFile = { entries: [] };
  if (existsSync(journalPath))
    journal = JSON.parse(readFileSync(journalPath, 'utf8')) as JournalFile;
  else v.push({ code: 'M-03', file: 'meta/_journal.json', message: 'journal dosyası yok' });

  const tags = journal.entries.map((e) => e.tag);
  const sqlFiles = files.filter((f) => f.endsWith('.sql'));
  for (const f of files) {
    if (!f.endsWith('.sql'))
      v.push({ code: 'M-01', file: f, message: 'migrasyon dizininde .sql dışı dosya' });
  }
  for (const [i, e] of journal.entries.entries()) {
    if (e.idx !== i)
      v.push({ code: 'M-03', file: `${e.tag}.sql`, message: 'journal sırası boşluklu veya ters' });
    if (!sqlFiles.includes(`${e.tag}.sql`))
      v.push({ code: 'M-03', file: `${e.tag}.sql`, message: 'journal girdisinin dosyası yok' });
    const snap = join(metaDir, `${String(e.idx).padStart(4, '0')}_snapshot.json`);
    if (!existsSync(snap))
      v.push({ code: 'M-03', file: `${e.tag}.sql`, message: 'snapshot dosyası yok' });
  }
  for (const f of sqlFiles) {
    if (!tags.includes(f.replace(/\.sql$/, '')))
      v.push({ code: 'M-03', file: f, message: "dosya journal'da yok" });
  }
  if (existsSync(metaDir)) {
    for (const s of readdirSync(metaDir).filter((x) => x.endsWith('_snapshot.json'))) {
      const idx = Number(s.slice(0, 4));
      if (!journal.entries.some((e) => e.idx === idx))
        v.push({ code: 'M-03', file: `meta/${s}`, message: "snapshot journal'da yok" });
    }
  }

  const existing = new Set<string>();
  const ordered = [
    ...tags.map((t) => `${t}.sql`).filter((f) => sqlFiles.includes(f)),
    ...sqlFiles.filter((f) => !tags.includes(f.replace(/\.sql$/, ''))),
  ];
  for (const f of ordered) {
    const sql = readFileSync(join(dir, f), 'utf8');
    v.push(
      ...lintMigration(
        { name: f, sql },
        { existingTables: existing, ...(repoSources ? { repoSources } : {}) },
      ),
    );
    for (const t of createdTables(sql)) existing.add(t);
  }
  return v;
}

// ---------- son etiket ----------

/** Son vX.Y.Z etiketindeki migrasyon/snapshot/journal dosyaları değişmemiş olmalı (032 §4.4). */
export function checkAgainstLastTag(repoRoot: string, migrationsRel: string): Violation[] {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  const tags = git(['tag', '--list', 'v*.*.*', '--sort=-v:refname'])
    .split('\n')
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  const tag = tags[0];
  if (tag === undefined) return [];
  const v: Violation[] = [];
  const files = git(['ls-tree', '-r', '--name-only', tag, '--', migrationsRel])
    .split('\n')
    .filter((f) => f !== '');
  for (const f of files) {
    const path = join(repoRoot, f);
    if (!existsSync(path)) {
      v.push({ code: 'M-03', file: f, message: `${tag} etiketindeki dosya silinmiş` });
      continue;
    }
    if (f.endsWith('_journal.json')) {
      const old = JSON.parse(git(['show', `${tag}:${f}`])) as JournalFile;
      const now = JSON.parse(readFileSync(path, 'utf8')) as JournalFile;
      old.entries.forEach((e, i) => {
        const cur = now.entries[i];
        if (cur?.tag !== e.tag || cur.idx !== e.idx)
          v.push({
            code: 'M-03',
            file: f,
            message: `${tag} etiketindeki journal satırı değişmiş: ${e.tag}`,
          });
      });
      continue;
    }
    if (git(['show', `${tag}:${f}`]) !== readFileSync(path, 'utf8')) {
      v.push({ code: 'M-03', file: f, message: `${tag} etiketinde yayımlanmış dosya değişmiş` });
    }
  }
  return v;
}

// ---------- CLI ----------

const PKG_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = join(PKG_ROOT, '..', '..');

/** M-17 için apps/** ve packages/** kaynakları (migrasyonlar hariç). */
export function loadRepoSources(root: string = REPO_ROOT): Map<string, string> {
  const out = execFileSync('git', ['ls-files', '-z', '--', 'apps', 'packages'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const map = new Map<string, string>();
  for (const f of out.split('\0')) {
    if (
      f === '' ||
      f.startsWith('packages/db/migrations/') ||
      f.startsWith('packages/db/test/fixtures/')
    )
      continue;
    if (!/\.(ts|tsx|sql)$/.test(f) || !existsSync(join(root, f))) continue;
    map.set(f, readFileSync(join(root, f), 'utf8'));
  }
  return map;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dirArg = args.indexOf('--dir');
  const dir = dirArg >= 0 ? (args[dirArg + 1] ?? '') : join(PKG_ROOT, 'migrations');
  const sqlFiles = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const contracts = sqlFiles.some((f) => /_contract_/.test(f));
  const violations = lintDirectory(dir, contracts ? loadRepoSources() : undefined);
  if (args.includes('--against-last-tag')) {
    violations.push(...checkAgainstLastTag(REPO_ROOT, relative(REPO_ROOT, dir)));
  }
  for (const x of violations) process.stderr.write(`${x.code} ${x.file}: ${x.message}\n`);
  if (violations.length > 0) {
    process.stderr.write(`check-migrations: ${violations.length} ihlal\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`check-migrations: ${sqlFiles.length} migrasyon, 0 ihlal\n`);
  }
}
