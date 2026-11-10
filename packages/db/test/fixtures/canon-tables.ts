// KK-030-1 beklenen tablo kümesi: 002 §10.1–§10.3 tablolarından üretilir (tables.json).
// Yeniden üretim: node packages/db/test/fixtures/canon-tables.ts --write
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CANON_PATH = fileURLToPath(
  new URL('../../../../plans/00-baslangic/002-kanonik-degerler.md', import.meta.url),
);
export const TABLES_JSON = fileURLToPath(new URL('./tables.json', import.meta.url));

export interface CanonTables {
  readonly auth: readonly string[];
  readonly app: readonly string[];
  readonly corpus: readonly string[];
}

/** §10.x tablolarının ilk hücresindeki ters tırnaklı adları şemaya göre toplar. */
export function parseCanonTables(md: string): CanonTables {
  const out: Record<keyof CanonTables, Set<string>> = {
    auth: new Set(),
    app: new Set(),
    corpus: new Set(),
  };
  let schema: keyof CanonTables | null = null;
  for (const line of md.split('\n')) {
    if (line.startsWith('## ') && !line.startsWith('## 10.')) schema = null;
    const h = /^### 10\.[123] `(auth|app|corpus)` şeması/.exec(line);
    if (h) {
      schema = h[1] as keyof CanonTables;
      continue;
    }
    if (line.startsWith('### ') && !h) schema = null;
    if (schema === null || !line.startsWith('| `')) continue;
    const cell = line.split('|')[1] ?? '';
    for (const m of cell.matchAll(/`([a-z_.]+)`/g)) {
      const name = (m[1] ?? '').replace(new RegExp(`^${schema}\\.`), '');
      out[schema].add(name);
    }
  }
  return {
    auth: [...out.auth].sort(),
    app: [...out.app].sort(),
    corpus: [...out.corpus].sort(),
  };
}

export function readTablesJson(): CanonTables {
  return JSON.parse(readFileSync(TABLES_JSON, 'utf8')) as CanonTables;
}

if (import.meta.main && process.argv.includes('--write')) {
  const tables = parseCanonTables(readFileSync(CANON_PATH, 'utf8'));
  writeFileSync(TABLES_JSON, `${JSON.stringify(tables, null, 2)}\n`);
}
