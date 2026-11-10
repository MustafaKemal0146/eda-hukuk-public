// src/version.generated.ts üretir (MASKER_VERSION içerik özeti). `--check`: farklıysa çıkış 1.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contentHash, generatedSource, sourceFiles } from './version-hash.ts';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const target = fileURLToPath(new URL('../src/version.generated.ts', import.meta.url));
const next = generatedSource(contentHash(sourceFiles(srcDir)));
const current = readFileSync(target, 'utf8');

if (process.argv.includes('--check')) {
  if (current !== next) {
    process.stderr.write(
      'kvkk: src/version.generated.ts güncel değil; `pnpm --filter @eda/kvkk gen:schemas` çalıştırın\n',
    );
    process.exit(1);
  }
} else if (current !== next) {
  writeFileSync(target, next);
}
