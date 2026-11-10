// @tk TK-28
// KK-P00-13 / KK-004-5: pre-commit yalnız sahnelenen dosyaları denetler (biome --staged).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const BIOME = join(ROOT, 'node_modules', '.bin', 'biome');

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

describe('KK-P00-13: git kancaları', () => {
  it('üç kanca çalıştırılabilir', () => {
    for (const h of ['pre-commit', 'commit-msg', 'pre-push']) {
      accessSync(join(ROOT, '.husky', h), constants.X_OK);
    }
  });

  it('biome --staged yalnız sahnelenmiş hatalı dosyada kırılır', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eda-precommit-'));
    try {
      git(dir, 'init', '-q');
      git(dir, 'config', 'user.email', 'test@example.invalid');
      git(dir, 'config', 'user.name', 'test');
      writeFileSync(
        join(dir, 'biome.json'),
        '{"vcs":{"enabled":true,"clientKind":"git","useIgnoreFile":false}}',
      );
      writeFileSync(join(dir, 'staged.ts'), 'debugger;\n');
      writeFileSync(join(dir, 'unstaged.ts'), 'debugger;\n');
      git(dir, 'add', 'biome.json', 'staged.ts');
      const r = spawnSync(
        BIOME,
        ['check', '--staged', '--no-errors-on-unmatched', '--colors=off'],
        {
          cwd: dir,
          encoding: 'utf8',
        },
      );
      const out = `${r.stdout}${r.stderr}`;
      assert.notEqual(r.status, 0);
      assert.match(out, /staged\.ts/);
      assert.doesNotMatch(out, /unstaged\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
