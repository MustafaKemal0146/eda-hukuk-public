// src/docast.ts ve src/doc-engine/*.ts Zod şemalarından generated/json-schema/<ad>.schema.json
// üretir (013 §17.2 adım 1-2). Çıktı deterministiktir: anahtarlar özyinelemeli sıralı, zaman damgası yok.
// Dosya tek Zod şeması dışa aktarırsa kök o şemadır; birden çoksa hepsi `$defs` altına yazılır.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const PKG_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(PKG_ROOT, '..', '..');
const SRC_DIR = join(PKG_ROOT, 'src', 'doc-engine');
const OUT_DIR = join(PKG_ROOT, 'generated', 'json-schema');
const ID_PREFIX = 'https://schemas.eda.internal/';

// `const` -> tek elemanlı `enum`: datamodel-codegen literal alanlar için Enum sınıfı üretir.
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const obj: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    if ('const' in obj && !('enum' in obj)) {
      obj.enum = [obj.const];
      delete obj.const;
    }
    // `format` uuid/date-time Pydantic'te UUID/AwareDatetime olur; Zod'un eşlik eden `pattern`'i bu
    // türlere uygulanamaz (TypeError). Biçim denetimi `format` ile kalır.
    if (obj.format === 'uuid' || obj.format === 'date-time') delete obj.pattern;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, normalize(obj[k])]),
    );
  }
  return value;
}

// DocAST (054 §11.2) doc-engine dizini dışındadır; aynı kuralla (dosya başına tek şema) üretilir.
const EXTRA_SOURCES = [join(PKG_ROOT, 'src', 'docast.ts')];

const sources = [
  ...EXTRA_SOURCES,
  ...readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(SRC_DIR, f)),
].sort();

mkdirSync(OUT_DIR, { recursive: true });
const written = new Set<string>();

type Exported = { srcPath: string; name: string; schemas: [string, z.ZodType][] };
const modules: Exported[] = [];
for (const srcPath of sources) {
  const mod = (await import(pathToFileURL(srcPath).href)) as Record<string, unknown>;
  const schemas = Object.entries(mod)
    .filter((entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (schemas.length === 0) throw new Error(`${basename(srcPath)}: Zod şeması dışa aktarılmalı`);
  modules.push({ srcPath, name: basename(srcPath, '.ts'), schemas });
}

// Tek şemalı dosyanın şeması başka dosyada alan olarak kullanılırsa çoğaltılmaz, `<ad>.schema.json`
// dosyasına `$ref` ile başvurulur (datamodel-codegen modüller arası içe aktarma üretir).
const singleOwners = new Map<z.ZodType, string>();
for (const m of modules) {
  const [only] = m.schemas;
  if (only !== undefined && m.schemas.length === 1) singleOwners.set(only[1], m.name);
}

function multiSchemaDefs(m: Exported): Record<string, unknown> {
  const local = new Set(m.schemas.map(([n]) => n));
  const registry = z.registry<{ id: string }>();
  for (const [schema, owner] of singleOwners) registry.add(schema, { id: `file:${owner}` });
  for (const [n, schema] of m.schemas) registry.add(schema, { id: n });
  const { schemas } = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    uri: (id) => (id.startsWith('file:') ? `${id.slice(5)}.schema.json` : `#/$defs/${id}`),
  }) as { schemas: Record<string, Record<string, unknown>> };
  const defs: Record<string, unknown> = {};
  for (const n of local) {
    const { $schema: _s, $id: _i, id: _id, ...rest } = schemas[n] ?? {};
    defs[n] = { ...rest, title: n };
  }
  return defs;
}

for (const m of modules) {
  const outName = `${m.name}.schema.json`;
  const base = {
    $id: `${ID_PREFIX}${outName}`,
    $comment: `URETILDI - elle duzenlemeyin; kaynak: ${relative(REPO_ROOT, m.srcPath)}`,
  };
  let doc: unknown;
  const [first] = m.schemas;
  if (first !== undefined && m.schemas.length === 1) {
    const [title, schema] = first;
    const json = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
    doc = normalize({ ...json, ...base, title });
  } else {
    // Çok şemalı dosya: kökte tür yok, her şema `$defs` altında kendi adıyla.
    const title = `${m.name.charAt(0).toUpperCase()}${m.name.slice(1)}Schemas`;
    doc = normalize({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      ...base,
      title,
      $defs: multiSchemaDefs(m),
    });
  }
  writeFileSync(join(OUT_DIR, outName), `${JSON.stringify(doc, null, 2)}\n`);
  written.add(outName);
  process.stdout.write(`yazıldı: ${relative(REPO_ROOT, join(OUT_DIR, outName))}\n`);
}

for (const stale of readdirSync(OUT_DIR)) {
  if (stale.endsWith('.schema.json') && !written.has(stale)) {
    rmSync(join(OUT_DIR, stale));
    process.stdout.write(`silindi: ${stale}\n`);
  }
}
