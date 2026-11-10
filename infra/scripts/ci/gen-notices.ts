// THIRD_PARTY_NOTICES.md bölüm 1 (npm) ve 2 (Python) üretimi ve lisans izin listesi (013 §22).
// Bölüm 3-6 elle bakılır; betik "## 3." ve sonrasına dokunmaz.
// Kullanım: node gen-notices.ts [--python <json>] [--check]
//   --python: `doc-engine-run.sh licenses` çıktısı (make notices üretir).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/repo.ts';

export const ALLOWED = new Set([
  'MIT',
  // MIT-0 (atıfsız MIT; nodemailer): izinli kümeden daha serbest, bildirim yükümlülüğü yok.
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'PostgreSQL',
  'Python-2.0',
  'PSF-2.0',
  'MPL-2.0',
  'Unicode-3.0',
]);

/** Gerekçeli paket istisnaları. Yeni istisna CODEOWNERS onayı ister. */
export const EXCEPTIONS: Readonly<Record<string, string>> = {
  '@img/sharp-libvips-linux-x64':
    'LGPL-3.0-or-later; Next görsel optimizasyonu, değiştirilmemiş dinamik kütüphane',
  '@img/sharp-libvips-linux-arm64':
    'LGPL-3.0-or-later; Next görsel optimizasyonu, değiştirilmemiş dinamik kütüphane',
  'caniuse-lite': 'CC-BY-4.0; yalnız derleme zamanı tarayıcı verisi',
};

export type Dep = { name: string; version: string; license: string };

export function isAllowed(dep: Dep): boolean {
  if (dep.name in EXCEPTIONS) return true;
  const parts = dep.license.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/);
  return dep.license.includes(' OR ')
    ? parts.some((p) => ALLOWED.has(p))
    : parts.every((p) => ALLOWED.has(p));
}

export function npmDeps(): Dep[] {
  const out = execFileSync('pnpm', ['-r', 'licenses', 'list', '--prod', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const data = JSON.parse(out) as Record<string, { name: string; versions: string[] }[]>;
  const deps: Dep[] = [];
  for (const [license, list] of Object.entries(data)) {
    for (const p of list)
      for (const v of p.versions) deps.push({ name: p.name, version: v, license });
  }
  return deps.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function render(npm: Dep[], python: Dep[], tail: string): string {
  const table = (deps: Dep[]): string =>
    [
      '| Paket | Sürüm | Lisans |',
      '|---|---|---|',
      ...deps.map((d) => `| ${d.name} | ${d.version} | ${d.license} |`),
    ].join('\n');
  return [
    '# Üçüncü Taraf Bildirimleri',
    '',
    '<!-- Bölüm 1-2 infra/scripts/ci/gen-notices.ts ile üretilir (make notices); elle düzenlenmez. -->',
    '',
    '## 1. npm bağımlılıkları (üretim)',
    '',
    table(npm),
    '',
    '## 2. Python bağımlılıkları (doc-engine)',
    '',
    table(python),
    '',
    tail.trimEnd(),
    '',
  ].join('\n');
}

if (import.meta.main) {
  const file = join(REPO_ROOT, 'THIRD_PARTY_NOTICES.md');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const tailIdx = current.indexOf('\n## 3.');
  const tail =
    tailIdx >= 0 ? current.slice(tailIdx + 1) : '## 3. Konteynır imajları ve ayrı süreçler\n';
  const pyIdx = process.argv.indexOf('--python');
  const pyFile = pyIdx >= 0 ? process.argv[pyIdx + 1] : undefined;
  const python: Dep[] = pyFile
    ? (JSON.parse(readFileSync(join(REPO_ROOT, pyFile), 'utf8')) as Dep[])
    : (/## 2\.[^\n]*\n\n([\s\S]*?)\n\n## 3\./.exec(current)?.[1] ?? '')
        .split('\n')
        .slice(2)
        .map((l) => l.split('|').map((c) => c.trim()))
        .filter((c) => c.length >= 4)
        .map((c) => ({ name: c[1] ?? '', version: c[2] ?? '', license: c[3] ?? '' }));
  const npm = npmDeps();
  const bad = [...npm, ...python].filter((d) => !isAllowed(d));
  for (const d of bad)
    console.error(`gen-notices: izin listesi dışı lisans: ${d.name}@${d.version} (${d.license})`);
  const next = render(npm, python, tail);
  if (process.argv.includes('--check')) {
    if (next !== current) {
      console.error('gen-notices: THIRD_PARTY_NOTICES.md güncel değil (make notices)');
      process.exitCode = 1;
    }
  } else {
    writeFileSync(file, next);
  }
  if (bad.length > 0) process.exitCode = 1;
}
