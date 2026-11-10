// @tk TK-28
// KK-P00-13 / KK-004-4: commit mesajı denetimi 004 §6.2 tablolarını sınar.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const DIR = join(import.meta.dirname, '..');
const FIX = join(DIR, '__fixtures__', 'commit-msgs');
const run = (file: string): number =>
  spawnSync('bash', [join(DIR, 'check-commit-msg.sh'), file], { encoding: 'utf8' }).status ?? 1;

describe('KK-P00-13: check-commit-msg.sh', () => {
  for (const f of readdirSync(join(FIX, 'valid'))) {
    it(`geçerli: ${f}`, () => assert.equal(run(join(FIX, 'valid', f)), 0));
  }
  for (const f of readdirSync(join(FIX, 'invalid'))) {
    it(`geçersiz: ${f}`, () => assert.equal(run(join(FIX, 'invalid', f)), 1));
  }
});
