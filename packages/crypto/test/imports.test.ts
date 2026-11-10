// @tk TK-06
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const SPECIFIER_RES = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"`]([^'"`]+)['"`]/g,
  /\brequire\s*\(\s*['"`]([^'"`]+)['"`]/g,
];

describe('KK-P03c-15: src yalnız node:crypto içe aktarır', () => {
  const files = listTs(SRC);

  it('kaynak dosyaları bulunur', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(relative(SRC, file), () => {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\brequire\s*\(/);
      expect(text).not.toMatch(/\bimport\s*\(/);
      for (const re of SPECIFIER_RES) {
        for (const m of text.matchAll(re)) {
          const spec = m[1] ?? '';
          if (spec.startsWith('.')) {
            expect(spec).toMatch(/\.ts$/);
            const target = resolve(dirname(file), spec);
            expect(relative(SRC, target).startsWith('..')).toBe(false);
          } else {
            expect(spec).toBe('node:crypto');
          }
        }
      }
    });
  }
});
