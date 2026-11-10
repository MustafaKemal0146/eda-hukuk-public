// @tk TK-28
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports?: Record<string, string>;
};

describe('KK-P00-2: paket alt yolları içe aktarılabilir', () => {
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    it(`${subpath} -> ${target}`, async () => {
      await expect(import(new URL(`../${target}`, import.meta.url).href)).resolves.toBeDefined();
    });
  }
});
