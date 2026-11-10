// Token üretici (051 §3, §14; P05.4): tokens.source.json -> tokens.css, contrast-pairs.json,
// chart-palette.json. Kullanım: `pnpm --filter @eda/ui gen:tokens` (yazar) veya `... -- --check`
// (çıktı diskteki dosyadan farklıysa 1 ile çıkar). Saf `renderAll` testlerden de çağrılır.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ThemedValue = { light: string; dark: string };
export type ColorToken = ThemedValue & { use: string };
export type ChartSlot = ThemedValue & { hue: string };
export type TypeStep = {
  size: string;
  lineHeight: string;
  weight: string;
  tracking?: string;
  belowMd?: { size: string; lineHeight: string };
};
export type LayoutToken = { value: string; belowMd?: string };
export type ContrastPair = { fg: string; bg: string; min: number; use: string; exempt?: boolean };

export type TokenSource = {
  source: string;
  colors: Record<string, ColorToken>;
  aliases: Record<string, string>;
  chart: {
    slots: Record<string, ChartSlot>;
    helpers: Record<string, ColorToken>;
    sequential: Record<string, string>;
    sequentialNote: string;
    surface: { light: string; dark: string };
    thresholds: Record<string, number>;
    documented: Record<string, unknown>;
    rules: string[];
  };
  elevation: { themed: Record<string, ThemedValue>; shell: Record<string, ThemedValue> };
  typography: { families: Record<string, string>; scale: Record<string, TypeStep> };
  spacing: { unit: string; allowedSteps: number[] };
  layout: Record<string, LayoutToken>;
  paper: Record<string, string>;
  radius: Record<string, string>;
  zIndex: Record<string, string>;
  motion: {
    durations: Record<string, { value: string; reduced: string }>;
    easings: Record<string, string>;
  };
  density: { comfortable: Record<string, string>; compact: Record<string, string> };
  target: Record<string, string>;
  breakpoints: Record<string, string>;
  contrastPairs: ContrastPair[];
};

export type Theme = 'light' | 'dark';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TOKENS_DIR = join(PKG_ROOT, 'src', 'tokens');
export const SOURCE_PATH = join(TOKENS_DIR, 'tokens.source.json');
export const OUTPUT_FILES = ['tokens.css', 'contrast-pairs.json', 'chart-palette.json'] as const;
export type OutputFile = (typeof OUTPUT_FILES)[number];

const HEX = /^#[0-9a-fA-F]{6}$/;
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function loadSource(path: string = SOURCE_PATH): TokenSource {
  const source = JSON.parse(readFileSync(path, 'utf8')) as TokenSource;
  const errors = validateSource(source);
  if (errors.length > 0) {
    throw new Error(`tokens.source.json geçersiz:\n${errors.join('\n')}`);
  }
  return source;
}

/** Kaynak dosyanın yapısal denetimi: ad biçimi, hex biçimi, takma ad ve çift başvuruları. */
export function validateSource(source: TokenSource): string[] {
  const errors: string[] = [];
  const themedNames = new Set([
    ...Object.keys(source.colors),
    ...Object.keys(source.chart.slots),
    ...Object.keys(source.chart.helpers),
  ]);
  const checkThemedHex = (name: string, value: ThemedValue): void => {
    if (!NAME.test(name)) errors.push(`${name}: ad kebab-case olmalı`);
    for (const theme of ['light', 'dark'] as const) {
      if (!HEX.test(value[theme])) errors.push(`${name}.${theme}: 6 haneli hex olmalı`);
    }
  };
  for (const [name, value] of Object.entries(source.colors)) checkThemedHex(name, value);
  for (const [name, value] of Object.entries(source.chart.slots)) checkThemedHex(name, value);
  for (const [name, value] of Object.entries(source.chart.helpers)) checkThemedHex(name, value);
  for (const [name, value] of Object.entries(source.chart.sequential)) {
    if (!HEX.test(value)) errors.push(`${name}: 6 haneli hex olmalı`);
  }
  for (const [name, target] of Object.entries(source.aliases)) {
    if (!NAME.test(name)) errors.push(`${name}: ad kebab-case olmalı`);
    if (!(target in source.colors)) errors.push(`${name}: bilinmeyen hedef token "${target}"`);
  }
  for (const pair of source.contrastPairs) {
    for (const side of [pair.fg, pair.bg]) {
      if (!themedNames.has(side)) errors.push(`kontrast çifti: bilinmeyen token "${side}"`);
    }
  }
  const seen = new Set<string>();
  const all = [
    ...themedDecls(source, 'light'),
    ...staticDecls(source),
    ...Object.entries(source.density.comfortable),
  ];
  for (const [name] of all) {
    if (seen.has(name)) errors.push(`--eda-${name}: aynı ad iki kez tanımlı`);
    seen.add(name);
  }
  return errors;
}

type Decl = readonly [name: string, value: string];

const LINE_WIDTH = 100;

/** Üst düzey virgüllerden böler (parantez içindekiler korunur). */
function splitTopLevel(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      items.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  items.push(value.slice(start).trim());
  return items;
}

/**
 * Tek bildirim satırı. Çıktı Biome CSS biçimlendiricisiyle kararlıdır (hex küçük harf; 100 sütunu
 * aşan değer alt satıra iner ve virgüllü liste satır doldurmayla kırılır), böylece `biome check
 * --write` ile `--check` çelişmez.
 */
function declLine(indent: string, name: string, value: string): string {
  const v = value.replace(/#[0-9a-fA-F]{3,8}\b/g, (h) => h.toLowerCase());
  const one = `${indent}  --eda-${name}: ${v};`;
  if (one.length <= LINE_WIDTH) return one;
  const inner = `${indent}    `;
  const items = splitTopLevel(v);
  const lines: string[] = [];
  let current = '';
  items.forEach((item, i) => {
    const piece = `${item}${i === items.length - 1 ? ';' : ','}`;
    const candidate = current === '' ? piece : `${current} ${piece}`;
    if (current === '' || `${inner}${candidate}`.length <= LINE_WIDTH) {
      current = candidate;
    } else {
      lines.push(`${inner}${current}`);
      current = piece;
    }
  });
  lines.push(`${inner}${current}`);
  return `${indent}  --eda-${name}:\n${lines.join('\n')}`;
}

function block(selector: string, decls: readonly Decl[], indent = ''): string {
  const body = decls.map(([n, v]) => declLine(indent, n, v)).join('\n');
  return `${indent}${selector} {\n${body}\n${indent}}`;
}

function schemeBlock(selector: string, scheme: Theme, decls: readonly Decl[], indent = ''): string {
  const body = decls.map(([n, v]) => declLine(indent, n, v)).join('\n');
  return `${indent}${selector} {\n${indent}  color-scheme: ${scheme};\n${body}\n${indent}}`;
}

/** Temaya bağlı bildirimler: §4.1 renkleri, grafik, gölge/scrim ve künye/veri sınıfı takma adları. */
export function themedDecls(source: TokenSource, theme: Theme): Decl[] {
  const decls: Decl[] = [];
  for (const [n, v] of Object.entries(source.colors)) decls.push([n, v[theme]]);
  for (const [n, v] of Object.entries(source.chart.slots)) decls.push([n, v[theme]]);
  for (const [n, v] of Object.entries(source.chart.helpers)) decls.push([n, v[theme]]);
  for (const [n, v] of Object.entries(source.elevation.themed)) decls.push([n, v[theme]]);
  // Takma adlar her tema bloğunda yeniden yazılır: var() bildirildiği öğede çözülür, böylece
  // alt ağaçtaki data-theme değişimi takma adlara da yansır.
  for (const [n, target] of Object.entries(source.aliases)) decls.push([n, `var(--eda-${target})`]);
  return decls;
}

function shellDecls(source: TokenSource, theme: Theme): Decl[] {
  return Object.entries(source.elevation.shell).map(([n, v]) => [n, v[theme]] as const);
}

function staticDecls(source: TokenSource): Decl[] {
  const decls: Decl[] = [];
  for (const [n, v] of Object.entries(source.typography.families)) decls.push([n, v]);
  for (const [n, s] of Object.entries(source.typography.scale)) {
    decls.push([`type-${n}-size`, s.size]);
    decls.push([`type-${n}-line-height`, s.lineHeight]);
    decls.push([`type-${n}-weight`, s.weight]);
    if (s.tracking !== undefined) decls.push([`type-${n}-tracking`, s.tracking]);
  }
  for (const [n, v] of Object.entries(source.layout)) decls.push([n, v.value]);
  for (const [n, v] of Object.entries(source.paper)) decls.push([n, v]);
  for (const [n, v] of Object.entries(source.radius)) decls.push([n, v]);
  for (const [n, v] of Object.entries(source.zIndex)) decls.push([n, v]);
  for (const [n, v] of Object.entries(source.motion.durations)) decls.push([n, v.value]);
  for (const [n, v] of Object.entries(source.motion.easings)) decls.push([n, v]);
  for (const [n, v] of Object.entries(source.target)) decls.push([n, v]);
  for (const [n, v] of Object.entries(source.chart.sequential)) decls.push([n, v]);
  decls.push(...shellDecls(source, 'light'));
  return decls;
}

function belowMdDecls(source: TokenSource): Decl[] {
  const decls: Decl[] = [];
  for (const [n, s] of Object.entries(source.typography.scale)) {
    if (s.belowMd) {
      decls.push([`type-${n}-size`, s.belowMd.size]);
      decls.push([`type-${n}-line-height`, s.belowMd.lineHeight]);
    }
  }
  for (const [n, v] of Object.entries(source.layout)) {
    if (v.belowMd !== undefined) decls.push([n, v.belowMd]);
  }
  return decls;
}

export function renderTokensCss(source: TokenSource): string {
  const md = source.breakpoints.md;
  if (md === undefined) throw new Error('breakpoints.md tanımsız');
  const reduced = Object.entries(source.motion.durations).map(([n, v]) => [n, v.reduced] as const);
  const dark = [...themedDecls(source, 'dark'), ...shellDecls(source, 'dark')];
  const parts = [
    [
      '/*',
      ' * ÜRETİLMİŞ DOSYA — elle düzenleme.',
      ' * Kaynak: packages/ui/src/tokens/tokens.source.json (değerler 051 §4-§12).',
      ' * Üretici: packages/ui/scripts/gen-tokens.ts — `pnpm --filter @eda/ui gen:tokens`;',
      ' * denetim: `pnpm --filter @eda/ui gen:tokens -- --check`.',
      ' */',
    ].join('\n'),
    '/* Tema bağımsız ölçekler: tipografi, yerleşim, kâğıt, yarıçap, z-index, hareket, hedef. */',
    block(':root', staticDecls(source)),
    `/* Dar ekran (< md ${md}). */`,
    `@media (width < ${md}) {\n${block(':root', belowMdDecls(source), '  ')}\n}`,
    '/* Yoğunluk (051 §7.3); varsayılan comfortable. */',
    block(':root,\n[data-density="comfortable"]', Object.entries(source.density.comfortable)),
    block('[data-density="compact"]', Object.entries(source.density.compact)),
    '/* Azaltılmış hareket (051 §10.2): süre tokenları 0ms. */',
    `@media (prefers-reduced-motion: reduce) {\n${block(':root', reduced, '  ')}\n}`,
    '/* Açık tema (varsayılan ve alt ağaç). */',
    schemeBlock(':root,\n[data-theme="light"]', 'light', themedDecls(source, 'light')),
    '/* Koyu tema. */',
    schemeBlock('[data-theme="dark"]', 'dark', dark),
    '/* Sistem teması: işletim sistemi koyu tercihindeyse koyu değerler. */',
    `@media (prefers-color-scheme: dark) {\n${schemeBlock(':root[data-theme="system"]', 'dark', dark, '  ')}\n}`,
  ];
  return `${parts.join('\n\n')}\n`;
}

export function renderContrastPairs(source: TokenSource): unknown {
  return {
    $comment:
      'ÜRETİLMİŞ DOSYA — elle düzenleme. Kaynak: tokens.source.json contrastPairs (051 §5.1-§5.2; iki temada aynı satırlar). min 0 + exempt: WCAG muafiyeti.',
    themes: ['light', 'dark'],
    pairs: source.contrastPairs,
  };
}

export function renderChartPalette(source: TokenSource): unknown {
  const { chart, colors } = source;
  const surface = (theme: Theme): string => {
    const token = colors[chart.surface[theme]];
    if (!token) throw new Error(`chart.surface.${theme} bilinmeyen token`);
    return token[theme];
  };
  return {
    $comment:
      'ÜRETİLMİŞ DOSYA — elle düzenleme. Kaynak: tokens.source.json chart (051 §4.10). Slot sırası sabittir.',
    surface: {
      light: { token: chart.surface.light, value: surface('light') },
      dark: { token: chart.surface.dark, value: surface('dark') },
    },
    slots: Object.entries(chart.slots).map(([token, v]) => ({
      token,
      hue: v.hue,
      light: v.light,
      dark: v.dark,
    })),
    helpers: Object.entries(chart.helpers).map(([token, v]) => ({
      token,
      light: v.light,
      dark: v.dark,
      use: v.use,
    })),
    sequential: Object.entries(chart.sequential).map(([token, value]) => ({ token, value })),
    sequentialNote: chart.sequentialNote,
    thresholds: chart.thresholds,
    documented: chart.documented,
    rules: chart.rules,
  };
}

/** Biome JSON biçimiyle uyumlu yazım: nesneler açık, yalnız ilkel değerli diziler sığarsa tek satır. */
export function formatJson(value: unknown, indent = 0, keyWidth = 0): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 2);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const primitive = value.every((v) => v === null || typeof v !== 'object');
    if (primitive) {
      const inline = `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
      if (indent + keyWidth + inline.length + 1 <= 100) return inline;
    }
    const items = value.map((v) => `${inner}${formatJson(v, indent + 2)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const items = entries.map(([k, v]) => {
      const key = `${JSON.stringify(k)}: `;
      return `${inner}${key}${formatJson(v, indent + 2, key.length)}`;
    });
    return `{\n${items.join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

export function renderAll(source: TokenSource): Record<OutputFile, string> {
  return {
    'tokens.css': renderTokensCss(source),
    'contrast-pairs.json': `${formatJson(renderContrastPairs(source))}\n`,
    'chart-palette.json': `${formatJson(renderChartPalette(source))}\n`,
  };
}

export type ParsedTokensCss = {
  /** `:root, [data-theme="light"]` bloğu. */
  light: Map<string, string>;
  /** `[data-theme="dark"]` bloğu. */
  dark: Map<string, string>;
  /** `@media (prefers-color-scheme: dark) { :root[data-theme="system"] }` bloğu. */
  system: Map<string, string>;
  /** Dosyanın herhangi bir yerinde bildirilen tüm `--eda-*` adları (önek olmadan). */
  declared: Set<string>;
};

function readBlock(css: string, header: string): string {
  const start = css.indexOf(header);
  if (start < 0) throw new Error(`tokens.css: blok yok: ${header}`);
  let depth = 0;
  for (let i = start + header.length - 1; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start + header.length, i);
  }
  throw new Error(`tokens.css: kapanmayan blok: ${header}`);
}

function readDecls(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of body.matchAll(/--eda-([a-z0-9-]+):\s*([^;]+);/g)) {
    if (m[1] !== undefined && m[2] !== undefined) map.set(m[1], m[2].replace(/\s+/g, ' ').trim());
  }
  return map;
}

/** Üretilmiş tokens.css'i tema bloklarına ayırır (testler ve denetimler için). */
export function parseTokensCss(css: string): ParsedTokensCss {
  return {
    light: readDecls(readBlock(css, ':root,\n[data-theme="light"] {')),
    dark: readDecls(readBlock(css, '\n[data-theme="dark"] {')),
    system: readDecls(readBlock(css, ':root[data-theme="system"] {')),
    declared: new Set(readDecls(css).keys()),
  };
}

/** Kaynaktan beklenen tüm `--eda-*` adları (önek olmadan). */
export function expectedTokenNames(source: TokenSource): Set<string> {
  return new Set([
    ...themedDecls(source, 'light').map(([n]) => n),
    ...staticDecls(source).map(([n]) => n),
    ...Object.keys(source.density.comfortable),
    ...Object.keys(source.density.compact),
  ]);
}

/** Diskteki üretilmiş dosyalardan kaynakla uyuşmayanların adları. */
export function staleOutputs(
  outputs: Record<OutputFile, string>,
  dir: string = TOKENS_DIR,
): OutputFile[] {
  return OUTPUT_FILES.filter((f) => {
    try {
      return readFileSync(join(dir, f), 'utf8') !== outputs[f];
    } catch {
      return true;
    }
  });
}

function main(argv: readonly string[]): number {
  const outputs = renderAll(loadSource());
  const rel = (f: string): string => relative(process.cwd(), join(TOKENS_DIR, f));
  if (argv.includes('--check')) {
    const stale = staleOutputs(outputs);
    if (stale.length > 0) {
      process.stderr.write(
        `gen-tokens: üretilmiş dosyalar kaynakla uyuşmuyor: ${stale.map(rel).join(', ')}\n` +
          'Düzeltme: pnpm --filter @eda/ui gen:tokens\n',
      );
      return 1;
    }
    process.stdout.write('gen-tokens: üretilmiş dosyalar güncel\n');
    return 0;
  }
  for (const f of OUTPUT_FILES) writeFileSync(join(TOKENS_DIR, f), outputs[f]);
  process.stdout.write(`gen-tokens: yazıldı: ${OUTPUT_FILES.map(rel).join(', ')}\n`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
