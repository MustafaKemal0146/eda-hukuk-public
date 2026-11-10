#!/usr/bin/env node
// Yazı tipi tedarik betiği (P05.5; 051 §6.1, §16; 050 §17). Tek seferlik; çıktı depoya kayıtlıdır.
// Kaynak yalnız packages/ui devDependencies içindeki doğrulanmış npm paketleridir (ağ erişimi
// ve CDN yok). Çalıştırma: infra/scripts/dev/run-tool.sh node packages/ui/scripts/vendor-fonts.mjs
//
// - Geist, Source Serif 4, Geist Mono: @fontsource-variable/* paketlerindeki `wght`
//   eksenli değişken woff2 dosyalarının `latin` ve `latin-ext` alt kümeleri olduğu gibi kopyalanır
//   (Türkçe ğ ı İ ş Ğ Ş yalnız latin-ext'te, ₺ latin-ext'te; kapsam iki dosyanın birleşimidir).
// - Liberation Serif: @formepdf/fonts-standard paketinin değiştirilmemiş Liberation TTF'leri
//   wawoff2 ile woff2'ye çevrilir (kayıpsız biçim dönüşümü; alt kümeleme yok, 051 §6.1).
// - fonts/LICENSES.md paketlerdeki lisans dosyalarından birebir üretilir.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import wawoff2 from 'wawoff2';
import { checkFamilies, FONT_FAMILIES, FONTS_DIR, formatCodePoint } from './check-font-glyphs.mjs';

/** @param {string} line */
const out = (line) => process.stdout.write(`${line}\n`);
/** @param {string} line */
const err = (line) => process.stderr.write(`${line}\n`);

const PKG_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** @param {string} name */
function packageDir(name) {
  return realpathSync(join(PKG_ROOT, 'node_modules', name));
}

/** @param {string} name */
function packageVersion(name) {
  const pkg = JSON.parse(readFileSync(join(packageDir(name), 'package.json'), 'utf8'));
  return String(pkg.version);
}

const FONTSOURCE = [
  { id: 'geist', pkg: '@fontsource-variable/geist' },
  { id: 'source-serif-4', pkg: '@fontsource-variable/source-serif-4' },
  { id: 'geist-mono', pkg: '@fontsource-variable/geist-mono' },
];
const SUBSETS = ['latin', 'latin-ext'];

const LIBERATION_PKG = '@formepdf/fonts-standard';
/** Hedef dosya -> paketteki yüz (family/fontWeight/fontStyle). */
const LIBERATION_FACES = [
  { file: 'liberation-serif-regular.woff2', weight: 400, style: 'normal' },
  { file: 'liberation-serif-bold.woff2', weight: 700, style: 'normal' },
  { file: 'liberation-serif-italic.woff2', weight: 400, style: 'italic' },
  { file: 'liberation-serif-bolditalic.woff2', weight: 700, style: 'italic' },
];

/** @param {string} file @param {Uint8Array} bytes */
function write(file, bytes) {
  writeFileSync(join(FONTS_DIR, file), bytes);
  out(`yazıldı ${file} (${bytes.byteLength} bayt)`);
}

function vendorFontsource() {
  const sections = [];
  for (const { id, pkg } of FONTSOURCE) {
    const dir = packageDir(pkg);
    const files = [];
    for (const subset of SUBSETS) {
      const source = join(dir, 'files', `${id}-${subset}-wght-normal.woff2`);
      const target = `${id}-var-${subset}.woff2`;
      write(target, readFileSync(source));
      files.push(target);
    }
    const expected = FONT_FAMILIES[id]?.files ?? [];
    if (files.join() !== expected.join()) {
      throw new Error(`${id}: üretilen dosyalar FONT_FAMILIES listesiyle uyuşmuyor.`);
    }
    sections.push({
      label: FONT_FAMILIES[id]?.label ?? id,
      source: `${pkg}@${packageVersion(pkg)}`,
      licenseFile: 'LICENSE',
      license: readFileSync(join(dir, 'LICENSE'), 'utf8'),
      files,
      note: 'Değişken (`wght` ekseni), `latin` + `latin-ext` alt kümeleri; dosyalar değiştirilmeden kopyalandı.',
    });
  }
  return sections;
}

async function vendorLiberation() {
  const dir = packageDir(LIBERATION_PKG);
  /** @type {{ standardFonts: () => Array<{ family: string, src: Uint8Array, fontWeight: number, fontStyle: string }> }} */
  const mod = await import(LIBERATION_PKG);
  const serif = mod.standardFonts().filter((f) => f.family === 'Liberation Serif');
  const files = [];
  let fontVersion = '';
  for (const face of LIBERATION_FACES) {
    const match = serif.find((f) => f.fontWeight === face.weight && f.fontStyle === face.style);
    if (!match)
      throw new Error(`Liberation Serif ${face.weight} ${face.style} pakette bulunamadı.`);
    const parsed = fontkit.create(Buffer.from(match.src));
    if ('version' in parsed && typeof parsed.version === 'string') fontVersion = parsed.version;
    write(face.file, await wawoff2.compress(match.src));
    files.push(face.file);
  }
  return {
    label: FONT_FAMILIES['liberation-serif']?.label ?? 'Liberation Serif',
    source: `${LIBERATION_PKG}@${packageVersion(LIBERATION_PKG)}`,
    licenseFile: 'OFL.txt',
    license: readFileSync(join(dir, 'OFL.txt'), 'utf8'),
    files,
    note: `Değiştirilmemiş Liberation Serif TTF (${fontVersion || 'sürüm okunamadı'}); wawoff2 ile kayıpsız woff2 biçimine çevrildi, alt kümeleme yok.`,
  };
}

/** @param {Array<{ label: string, source: string, licenseFile: string, license: string, files: string[], note: string }>} sections */
function licensesMarkdown(sections) {
  const lines = [
    '# Yazı tipi lisansları',
    '',
    'ÜRETİLMİŞ DOSYA — elle düzenleme; `node packages/ui/scripts/vendor-fonts.mjs` yeniden üretir.',
    '',
    'Bu dizindeki woff2 dosyaları SIL Open Font License 1.1 (OFL-1.1) kapsamındadır ve',
    'self-host edilir (CDN yok; 051 §16, 050 §17). Lisans metinleri ve telif satırları kaynak npm',
    'paketlerindeki lisans dosyalarından birebir alınmıştır.',
    '',
  ];
  for (const s of sections) {
    lines.push(`## ${s.label}`, '');
    lines.push(`- Kaynak paket: \`${s.source}\` (lisans dosyası: \`${s.licenseFile}\`)`);
    lines.push(`- Dosyalar: ${s.files.map((f) => `\`${f}\``).join(', ')}`);
    lines.push(`- Not: ${s.note}`, '');
    lines.push('```text', s.license.trimEnd(), '```', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

async function main() {
  mkdirSync(FONTS_DIR, { recursive: true });
  const sections = [...vendorFontsource(), await vendorLiberation()];
  writeFileSync(join(FONTS_DIR, 'LICENSES.md'), licensesMarkdown(sections));
  out('yazıldı LICENSES.md');

  let failed = false;
  for (const r of checkFamilies()) {
    if (r.absent.length > 0 || r.missing.length > 0 || r.staleGaps.length > 0) {
      failed = true;
      err(
        `HATA ${r.label}: eksik ${r.missing.map(formatCodePoint).join(', ')}; gereksiz istisna ${r.staleGaps.map(formatCodePoint).join(', ')}`,
      );
    }
  }
  if (failed) {
    err('Glif denetimi başarısız: node packages/ui/scripts/check-font-glyphs.mjs');
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
