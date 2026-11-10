// MASKER_VERSION içerik özeti (026 §1.2): src altındaki kaynakların (version.ts, version.generated.ts ve
// index.ts hariç) yol + içerik özeti, sha256 ilk 8 hex. Betik ve test aynı işlevi kullanır.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const EXCLUDED = new Set(['version.ts', 'version.generated.ts', 'index.ts', 'testing.ts']);

export function sourceFiles(srcDir: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        const rel = relative(srcDir, full).split('\\').join('/');
        if (!EXCLUDED.has(rel)) out.push({ path: rel, content: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(srcDir);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function contentHash(files: readonly { path: string; content: string }[]): string {
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f.path);
    h.update('\u0000');
    h.update(f.content);
    h.update('\u0000');
  }
  return h.digest('hex').slice(0, 8);
}

export function generatedSource(hash: string): string {
  return `// Üretildi: scripts/gen-version.ts — elle düzenlemeyin.\nexport const MASKER_CONTENT_HASH = '${hash}';\n`;
}
