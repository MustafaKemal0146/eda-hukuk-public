// Bileşen envanteri denetimi (052 §1.6, KK-052-2; P05.8, KK-P05-17).
// Kural: `@eda/ui` (src/index.ts) ve varsa `@eda/ui/ai-elements` (src/ai-elements/index.ts) giriş
// noktalarının dışa aktardığı bileşen adları (PascalCase; tip ve SABIT_ADLAR hariç) ==
// src/inventory.json içindeki `layer` = ui|ai ve `status` = ready girdilerinin `exports` birleşimi.
// `planned` bir girdinin adı/dışa aktarımı giriş noktasında görünürse ya da `ready` bir ad dışa
// aktarılmıyorsa çıkış 1. Kullanım: node packages/ui/scripts/check-component-inventory.mjs [paket-kökü]
// (paket kökü verilmezse packages/ui; testler negatif fixture kökü verir).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(PKG_ROOT, '..', '..');
export const ENTRY_POINTS = ['src/index.ts', 'src/ai-elements/index.ts'];
export const INVENTORY = 'src/inventory.json';

const LAYERS = new Set(['ui', 'ai', 'feature', 'admin']);
const STATUSES = new Set(['ready', 'planned']);
/** Bileşen adı: büyük harfle başlar ve en az bir küçük harf içerir (SABIT_ADLAR ayrılır). */
const COMPONENT_NAME = /^[A-Z](?=[A-Za-z0-9]*[a-z])[A-Za-z0-9]*$/;

/**
 * Giriş noktası metninden dışa aktarılan bileşen adlarını çıkarır (tipler ve sabitler hariç).
 * Desteklenen biçimler: `export { A, type B, C as D } from '…'`, `export function A`,
 * `export const A`. `export *` yasaktır (hata).
 * @param {string} source
 * @returns {string[]}
 */
export function exportedComponentNames(source) {
  if (/^\s*export\s+\*/m.test(source)) {
    throw new Error('`export *` yasak: adlandırılmış dışa aktarım kullanın');
  }
  const names = new Set();
  for (const m of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    if (m[1]) continue;
    for (const raw of m[2].split(',')) {
      const spec = raw.replace(/\/\/.*$/gm, '').trim();
      if (spec === '' || spec.startsWith('type ')) continue;
      const alias = /\s+as\s+(\w+)$/.exec(spec);
      const name = alias ? alias[1] : spec;
      if (COMPONENT_NAME.test(name)) names.add(name);
    }
  }
  for (const m of source.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm,
  )) {
    if (COMPONENT_NAME.test(m[1])) names.add(m[1]);
  }
  return [...names].sort();
}

/**
 * Envanter girdilerini doğrular; yapısal hata listesi döner.
 * @param {unknown} inventory
 * @returns {string[]}
 */
export function validateInventory(inventory) {
  const errors = [];
  if (!Array.isArray(inventory)) return ['inventory.json bir dizi olmalı'];
  const seen = new Set();
  for (const [i, e] of inventory.entries()) {
    const where = `inventory[${i}]`;
    if (typeof e !== 'object' || e === null) {
      errors.push(`${where}: nesne olmalı`);
      continue;
    }
    if (typeof e.name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(e.name)) {
      errors.push(`${where}: geçersiz name`);
    }
    if (!LAYERS.has(e.layer)) errors.push(`${where} (${e.name}): geçersiz layer ${e.layer}`);
    if (!STATUSES.has(e.status)) errors.push(`${where} (${e.name}): geçersiz status ${e.status}`);
    if (typeof e.area !== 'string' || e.area === '') errors.push(`${where} (${e.name}): area boş`);
    if (e.exports !== undefined) {
      if (!Array.isArray(e.exports) || e.exports.some((x) => typeof x !== 'string')) {
        errors.push(`${where} (${e.name}): exports dizge dizisi olmalı`);
      } else if (e.status !== 'ready' || (e.layer !== 'ui' && e.layer !== 'ai')) {
        errors.push(`${where} (${e.name}): exports yalnız ui/ai katmanında ready girdide olur`);
      }
    }
    const key = `${e.layer}:${e.name}`;
    if (seen.has(key)) errors.push(`${where}: yinelenen girdi ${key}`);
    seen.add(key);
  }
  return errors;
}

/**
 * Envanter ile dışa aktarımları karşılaştırır.
 * @param {Array<{ name: string, layer: string, status: string, exports?: string[] }>} inventory
 * @param {string[]} exported
 * @returns {string[]}
 */
export function compareInventory(inventory, exported) {
  const errors = [];
  const exportedSet = new Set(exported);
  const packaged = inventory.filter((e) => e.layer === 'ui' || e.layer === 'ai');
  const expected = new Map();
  for (const e of packaged.filter((x) => x.status === 'ready')) {
    for (const name of e.exports ?? [e.name]) expected.set(name, e.name);
  }
  for (const e of packaged.filter((x) => x.status === 'planned')) {
    for (const name of [e.name, ...(e.exports ?? [])]) {
      if (exportedSet.has(name) && !expected.has(name)) {
        errors.push(`${name}: envanterde planned (${e.layer}) ama dışa aktarılıyor`);
      }
    }
  }
  for (const [name, owner] of expected) {
    if (!exportedSet.has(name)) {
      errors.push(`${name}: envanterde ready (${owner}) ama dışa aktarılmıyor`);
    }
  }
  for (const name of exported) {
    if (!expected.has(name)) errors.push(`${name}: dışa aktarılıyor ama envanterde ready değil`);
  }
  return errors;
}

/** @param {string} pkgRoot */
export function checkPackage(pkgRoot = PKG_ROOT) {
  const exported = [];
  for (const entry of ENTRY_POINTS) {
    const file = join(pkgRoot, entry);
    if (existsSync(file)) exported.push(...exportedComponentNames(readFileSync(file, 'utf8')));
  }
  const inventory = JSON.parse(readFileSync(join(pkgRoot, INVENTORY), 'utf8'));
  const structural = validateInventory(inventory);
  if (structural.length > 0) return structural;
  return compareInventory(inventory, exported);
}

function main(argv) {
  const root = argv[0] ?? PKG_ROOT;
  const errors = checkPackage(root);
  const label = relative(REPO_ROOT, join(root, INVENTORY));
  for (const e of errors) process.stderr.write(`${label}: ${e}\n`);
  if (errors.length > 0) {
    process.stderr.write(`check-component-inventory: ${errors.length} hata\n`);
    return 1;
  }
  process.stdout.write('check-component-inventory: envanter ve dışa aktarımlar eşit\n');
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
