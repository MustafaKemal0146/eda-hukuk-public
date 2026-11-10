// Ham değer ve yasak yardımcı taraması (051 §4.11, §7.1, §10, §17; P05.6; KK-P05-3, KK-P05-13).
// Kullanım: node packages/ui/scripts/check-ui-tokens.mjs [dizin...]
// Dizin verilmezse packages/ui/src, apps/web/src, apps/admin/src taranır. Bulgu varsa çıkış 1,
// geçersiz dizin 2. Token dizini (src/tokens/) ve chart-palette.json hariçtir.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(PKG_ROOT, '..', '..');
export const DEFAULT_TARGETS = ['packages/ui/src', 'apps/web/src', 'apps/admin/src'];

const SCANNED_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|mdx)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'generated', '.turbo', 'coverage']);

/** Hariç tutulan yollar: token dizini ve grafik paleti (051 §4.11/6). */
export function isExcluded(path) {
  const p = path.split(sep).join('/');
  return /(^|\/)src\/tokens\//.test(p) || /(^|\/)chart-palette\.json$/.test(p);
}

function allowedSpacingSteps() {
  const source = JSON.parse(
    readFileSync(join(PKG_ROOT, 'src', 'tokens', 'tokens.source.json'), 'utf8'),
  );
  return new Set(source.spacing.allowedSteps.map(String));
}

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOR_UTIL =
  'bg|text|border|border-[trblxyse]|ring|ring-offset|outline|fill|stroke|divide|decoration|accent|caret|placeholder|shadow|from|via|to';
// Bir sınıf adının başlangıcı: önünde harf/rakam/tire/alt çizgi olmamalı; varyant önekleri serbest.
const B = '(?<![\\w-])(?:[\\w-]+:)*';

/** @type {{ id: string, message: string, pattern: RegExp }[]} */
const PATTERN_RULES = [
  {
    id: 'raw-hex',
    message: 'ham hex renk; semantik token sınıfı kullanın (051 §4.11)',
    pattern: /(?<![\w.&/$#-])#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    id: 'raw-color-fn',
    message: 'ham renk fonksiyonu (rgb/hsl/oklch); token kullanın (051 §4.11)',
    pattern: /\b(?:rgba?|hsla?|oklch|oklab)\(/g,
  },
  {
    id: 'palette-class',
    message: 'Tailwind varsayılan palet sınıfı; semantik token kullanın (051 §15)',
    pattern: new RegExp(`${B}(?:${COLOR_UTIL})-(?:(?:${PALETTE})-\\d|(?:white|black)\\b)`, 'g'),
  },
  {
    id: 'arbitrary-value',
    message: 'keyfi değer ([...]); token veya izinli ölçek adımı kullanın (051 §7.1, §15)',
    pattern: new RegExp(`${B}-?[a-z][\\w-]*-\\[[^\\]\\s]*\\](?!:)`, 'g'),
  },
  {
    id: 'alpha-class',
    message: 'alfa (/NN) sınıfı; metin ve sınırda yasak, zeminde yalnız scrim (051 §4.11/3)',
    pattern: new RegExp(`${B}(?:${COLOR_UTIL})-[a-z][\\w-]*\\/(?:\\d{1,3}|\\[)`, 'g'),
  },
  {
    id: 'opacity',
    message: 'opacity- ile soluklaştırma yasak; renk tokenı kullanın (051 §4.11, §13.1)',
    pattern: new RegExp(`${B}opacity-`, 'g'),
  },
  {
    id: 'backdrop-blur',
    message: 'bulanık arka plan yasak; düz scrim kullanın (051 §9)',
    pattern: /backdrop-blur|backdrop-filter/g,
  },
  {
    id: 'animate-pulse-ping',
    message: 'animate-pulse/ping yasak (051 §10.2)',
    pattern: new RegExp(`${B}animate-(?:pulse|ping)\\b`, 'g'),
  },
  {
    id: 'active-scale',
    message: 'basılı durumda scale yasak; primary-active rengi kullanın (051 §10.1)',
    pattern: /(?<![\w-])active:-?scale-/g,
  },
  {
    id: 'gradient',
    message: 'gradyan yasak (051 Yapma listesi)',
    pattern:
      /\bbg-(?:gradient|linear|radial|conic)-|\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/g,
  },
  {
    id: 'tr-casing',
    message:
      "düz toUpperCase()/toLowerCase() yasak; CSS text-transform veya toLocale*Case('tr-TR') (Y-104, KK-051-13)",
    pattern:
      /\.(?:toUpperCase|toLowerCase)\(\s*\)|\.toLocale(?:Upper|Lower)Case\((?!\s*['"`]tr(?:-TR)?['"`]\s*\))/g,
  },
];

const SPACING_UTIL =
  'p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|scroll-m|scroll-p';
const SPACING_RE = new RegExp(`${B}-?(?:${SPACING_UTIL})-(\\d+(?:\\.\\d+)?)(?![\\w./-])`, 'g');

/**
 * Tek dosya metnini tarar; bulgu listesi döner.
 * @param {string} file
 * @param {string} text
 * @param {Set<string>} [allowedSteps]
 * @returns {{ file: string, line: number, column: number, rule: string, match: string, message: string }[]}
 */
export function scanText(file, text, allowedSteps = allowedSpacingSteps()) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const rule of PATTERN_RULES) {
      for (const m of line.matchAll(rule.pattern)) {
        findings.push({
          file,
          line: i + 1,
          column: (m.index ?? 0) + 1,
          rule: rule.id,
          match: m[0],
          message: rule.message,
        });
      }
    }
    for (const m of line.matchAll(SPACING_RE)) {
      if (!allowedSteps.has(m[1])) {
        findings.push({
          file,
          line: i + 1,
          column: (m.index ?? 0) + 1,
          rule: 'spacing-step',
          match: m[0],
          message: `izinli boşluk adımları dışında (${[...allowedSteps].join(', ')}; 051 §7.1)`,
        });
      }
    }
  });
  return findings;
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(join(dir, entry.name)));
    } else if (SCANNED_EXT.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Dizinleri tarar.
 * @param {string[]} targets mutlak veya repo köküne göre yollar
 */
export function scanTargets(targets) {
  const steps = allowedSpacingSteps();
  const findings = [];
  for (const target of targets) {
    const abs = target.startsWith('/') ? target : join(REPO_ROOT, target);
    const files = statSync(abs).isDirectory() ? walk(abs) : [abs];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file);
      if (isExcluded(rel)) continue;
      findings.push(...scanText(rel, readFileSync(file, 'utf8'), steps));
    }
  }
  return findings;
}

function main(argv) {
  const targets = argv.length > 0 ? argv : DEFAULT_TARGETS;
  const missing = targets.filter((t) => !existsSync(t.startsWith('/') ? t : join(REPO_ROOT, t)));
  if (missing.length > 0) {
    process.stderr.write(`check-ui-tokens: hedef bulunamadı: ${missing.join(', ')}\n`);
    return 2;
  }
  const findings = scanTargets(targets);
  for (const f of findings) {
    process.stderr.write(`${f.file}:${f.line}:${f.column} [${f.rule}] ${f.match} — ${f.message}\n`);
  }
  if (findings.length > 0) {
    process.stderr.write(`check-ui-tokens: ${findings.length} bulgu\n`);
    return 1;
  }
  process.stdout.write(`check-ui-tokens: temiz (${targets.join(', ')})\n`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
