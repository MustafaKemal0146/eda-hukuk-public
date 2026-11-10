// @tk TK-29
// KK-P03a-18 (KK-030-18 auth kısmı): `drizzle-kit check` temiz; `db:generate` ikinci kez çalıştırıldığında
// yeni migrasyon üretmez (TS şeması ile son snapshot eşit). drizzle-kit yalnız dosya üretir (Y-99).
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const PKG = fileURLToPath(new URL('../../', import.meta.url));
const BIN = join(PKG, 'node_modules', '.bin', 'drizzle-kit');

describe('KK-P03a-18 KK-P03b-15 (KK-030-18): drizzle-kit check ve yeniden üretim', () => {
  it('drizzle-kit check snapshot tutarlılığını onaylar', async () => {
    const { stdout, stderr } = await run(BIN, ['check'], { cwd: PKG });
    expect(stderr).not.toMatch(/error/i);
    expect(stdout).toContain("Everything's fine");
  });

  it('db:generate ikinci kez yeni migrasyon üretmez', async () => {
    // Geçici kopya: aynı şema ve seçenekler, çıktı kopyaya (repo dosyaları değişmez). drizzle-kit
    // `out` yolunu çalışma dizinine göreli bekler.
    const work = mkdtempSync(join(tmpdir(), 'eda-gen-'));
    try {
      cpSync(join(PKG, 'migrations'), join(work, 'migrations'), { recursive: true });
      const before = readdirSync(join(work, 'migrations')).sort();
      const config = {
        dialect: 'postgresql',
        schema: relative(work, join(PKG, 'src', 'schema', 'index.ts')),
        out: './migrations',
        schemaFilter: ['auth', 'app', 'corpus'],
        entities: { roles: false },
        strict: true,
        breakpoints: true,
      };
      writeFileSync(join(work, 'drizzle.config.ts'), `export default ${JSON.stringify(config)};\n`);
      const { stdout, stderr } = await run(BIN, ['generate', '--name', 'schema_no_change'], {
        cwd: work,
      });
      expect(stderr).not.toMatch(/error/i);
      expect(`${stdout}${stderr}`).toContain('No schema changes');
      expect(readdirSync(join(work, 'migrations')).sort()).toEqual(before);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
