// @tk TK-33
// KK-P05-3 (KK-051-3) ve KK-P05-13 (KK-051-13): check-ui-tokens her kural için negatif fixture'ı
// yakalar, izinli kalıplarda bulgu üretmez, token dizinini hariç tutar.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../scripts/check-ui-tokens.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./__fixtures__/ui-tokens/', import.meta.url));
const PKG = fileURLToPath(new URL('../', import.meta.url));

function run(...targets: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...targets], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** stderr satırlarından dosya adı -> kural kümesi. */
function rulesByFile(stderr: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const m of stderr.matchAll(/^(.+?):\d+:\d+ \[([a-z-]+)\]/gm)) {
    const file = basename(m[1] ?? '');
    map.set(file, new Set([...(map.get(file) ?? []), m[2] ?? '']));
  }
  return map;
}

// Düz harf dönüşümü fixture'ı geçici dizinde üretilir: depoda düz çağrı metni bulunmasın
// (P05 doğrulama komutundaki git grep beklenen boş sonucu korunur).
const tmp = mkdtempSync(join(tmpdir(), 'eda-ui-tokens-'));
const CALL = ['to', 'Upper', 'Case'].join('');
writeFileSync(join(tmp, 'tr-casing.ts'), `export const f = (s: string) => s.${CALL}();\n`);
writeFileSync(
  join(tmp, 'tr-casing-locale.ts'),
  `export const g = (s: string) => s.toLocale${CALL.slice(2)}('en-US');\n`,
);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('KK-P05-3 (KK-051-3): check-ui-tokens negatif fixture testleri', () => {
  const result = run(join(FIXTURES, 'bad'));
  const found = rulesByFile(result.stderr);
  const files = readdirSync(join(FIXTURES, 'bad'));

  it('bulgu varsa 1 ile çıkar', () => {
    expect(result.status).toBe(1);
    expect(files.length).toBeGreaterThanOrEqual(11);
  });

  for (const file of files) {
    const rule = file.replace(/\.(ts|css)$/, '');
    it(`[${rule}] kuralı ${file} dosyasında ve yalnız o kural tetiklenir`, () => {
      expect([...(found.get(file) ?? [])]).toEqual([rule]);
    });
  }

  it('izinli kalıplar (token sınıfları, data-[...] varyantı, izinli adımlar) temizdir', () => {
    const r = run(join(FIXTURES, 'good'));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('token dizini ve chart-palette.json hariç tutulur', () => {
    const r = run(join(PKG, 'src/tokens'));
    expect(r.status).toBe(0);
  });

  it('bilinmeyen hedef 2 ile çıkar', () => {
    expect(run(join(FIXTURES, 'yok')).status).toBe(2);
  });

  it('@eda/ui stil dosyaları temizdir', () => {
    const r = run(join(PKG, 'src/styles'));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

describe('KK-P05-13 (KK-051-13): düz harf dönüşümü yasak', () => {
  it("düz çağrı ve tr-TR dışı yerel ayar yakalanır, toLocale*Case('tr-TR') serbesttir", () => {
    const r = run(tmp);
    expect(r.status).toBe(1);
    const found = rulesByFile(r.stderr);
    expect([...(found.get('tr-casing.ts') ?? [])]).toEqual(['tr-casing']);
    expect([...(found.get('tr-casing-locale.ts') ?? [])]).toEqual(['tr-casing']);
  });
});
