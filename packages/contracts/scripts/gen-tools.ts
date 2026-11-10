// LLM araç tanımlarını üretir (021 §4.15): src/tools/llm-tools.generated.json + paket kökünde
// tools.lock.json. `--check`: dosyalar güncel değilse 1 ile çıkar.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LLM_TOOLS } from '../src/tools/index.ts';
import { buildLock } from './tools-canon.ts';

const ROOT = join(import.meta.dirname, '..');
const GEN = join(ROOT, 'src', 'tools', 'llm-tools.generated.ts');
const LOCK = join(ROOT, 'tools.lock.json');

const { generated, lock, errors } = buildLock(LLM_TOOLS);
if (errors.length > 0) {
  for (const e of errors) process.stderr.write(`gen-tools: ${e}\n`);
  process.exit(1);
}
const files: [string, string][] = [
  [
    GEN,
    `// ÜRETİLMİŞ DOSYA (gen-tools, 021 §4.15): elle düzenleme. Kilit: tools.lock.json.\nexport const LLM_TOOL_DEFS = ${JSON.stringify(generated, null, 2)} as const;\n`,
  ],
  [LOCK, `${JSON.stringify(lock, null, 2)}\n`],
];
if (process.argv.includes('--check')) {
  const stale = files.filter(([p, c]) => {
    try {
      return readFileSync(p, 'utf8') !== c;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) {
    process.stderr.write(`gen-tools: güncel değil: ${stale.map(([p]) => p).join(', ')}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `gen-tools: güncel (${lock.tools.length} araç, ~${lock.approx_tokens} token)\n`,
  );
} else {
  for (const [p, c] of files) writeFileSync(p, c);
  process.stdout.write(
    `gen-tools: yazıldı (${lock.tools.length} araç, ~${lock.approx_tokens} token)\n`,
  );
}
