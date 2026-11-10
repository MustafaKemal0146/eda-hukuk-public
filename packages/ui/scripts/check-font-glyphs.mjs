#!/usr/bin/env node
// Yazı tipi glif kapsamı denetimi (P05.5; 051 §6.1, 050 §17; KK-P05-4, KK-050-14).
// Her ailenin woff2 dosyalarının BİRLEŞİK cmap kapsamı zorunlu Türkçe ve tipografik kod
// noktalarını içermelidir (latin ve latin-ext alt kümeleri ayrı dosyadır; ikisi birlikte sayılır).
//
// Kullanım:
//   node packages/ui/scripts/check-font-glyphs.mjs                 tüm aileler (packages/ui/fonts/)
//   node packages/ui/scripts/check-font-glyphs.mjs --files a,b     verilen dosyaları tek aile sayar
// Çıkış kodu: 0 kapsam tam; 1 eksik kod noktası veya eksik dosya; 2 hatalı argüman.
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';

/** @param {string} line */
const out = (line) => process.stdout.write(`${line}\n`);
/** @param {string} line */
const err = (line) => process.stderr.write(`${line}\n`);

export const FONTS_DIR = fileURLToPath(new URL('../fonts/', import.meta.url));

/** Zorunlu kod noktaları (P05.5 listesi; 050 §17). */
export const REQUIRED_CODE_POINTS = Object.freeze([
  0x011e, // Ğ
  0x011f, // ğ
  0x0130, // İ
  0x0131, // ı
  0x015e, // Ş
  0x015f, // ş
  0x20ba, // ₺
  0x201c, // “
  0x201d, // ”
  0x2018, // ‘
  0x2019, // ’
  0x00a7, // §
  0x2013, // –
  0x2014, // —
]);

/**
 * Aile -> dosya listesi (packages/ui/fonts/ altında). vendor-fonts.mjs bu listeyi üretir;
 * apps/{web,admin}/src/app/fonts.ts aynı dosyaları next/font/local ile yükler.
 */
export const FONT_FAMILIES = Object.freeze({
  geist: Object.freeze({
    label: 'Geist',
    files: Object.freeze(['geist-var-latin.woff2', 'geist-var-latin-ext.woff2']),
  }),
  'source-serif-4': Object.freeze({
    label: 'Source Serif 4',
    files: Object.freeze(['source-serif-4-var-latin.woff2', 'source-serif-4-var-latin-ext.woff2']),
  }),
  'geist-mono': Object.freeze({
    label: 'Geist Mono',
    files: Object.freeze(['geist-mono-var-latin.woff2', 'geist-mono-var-latin-ext.woff2']),
  }),
  'liberation-serif': Object.freeze({
    label: 'Liberation Serif',
    files: Object.freeze([
      'liberation-serif-regular.woff2',
      'liberation-serif-bold.woff2',
      'liberation-serif-italic.woff2',
      'liberation-serif-bolditalic.woff2',
    ]),
  }),
});

/**
 * Ölçülmüş upstream eksikleri (AS önerisi; P05.5 raporu). Kaynak paketlerdeki yazı tiplerinde
 * bu kod noktaları YOKTUR: Geist ve Geist Mono (@fontsource-variable 5.3.0, tüm alt kümeler)
 * ile Liberation Serif 2.1.5 ₺ (U+20BA) içermez (arayüzde tutar "1.500 TL" biçiminde yazılır); tarayıcı bu glif için yedek yığına
 * (051 §6.1: mono `ui-monospace…`, belge `"Times New Roman", Times, serif`) düşer.
 * İstisna yalnız burada ve yalnız ölçülmüş eksik için tanımlanır; istisnadaki kod noktası
 * dosyada bulunursa denetim "gereksiz istisna" hatası verir (sessiz gevşeme olmaz).
 */
export const KNOWN_GAPS = Object.freeze({
  geist: Object.freeze([0x20ba]),
  'geist-mono': Object.freeze([0x20ba]),
  'liberation-serif': Object.freeze([0x20ba]),
});

/**
 * Bir yazı tipi dosyasının (yol veya bayt dizisi) cmap kod noktaları.
 * @param {string | Uint8Array} font
 * @returns {number[]}
 */
export function codePointsOf(font) {
  const bytes = typeof font === 'string' ? readFileSync(font) : Buffer.from(font);
  const parsed = fontkit.create(bytes);
  if (!('characterSet' in parsed)) {
    throw new Error('Yazı tipi koleksiyonu (TTC/DFONT) desteklenmez; tek yüz dosyası verin.');
  }
  return parsed.characterSet;
}

/**
 * Saf fonksiyon: kapsamda bulunmayan zorunlu kod noktaları (girdi sırasıyla).
 * @param {Iterable<number>} coverage
 * @param {readonly number[]} required
 * @returns {number[]}
 */
export function missingFromCoverage(coverage, required = REQUIRED_CODE_POINTS) {
  const have = coverage instanceof Set ? coverage : new Set(coverage);
  return required.filter((cp) => !have.has(cp));
}

/**
 * Dosyaların BİRLEŞİK kapsamında eksik kalan zorunlu kod noktaları.
 * @param {ReadonlyArray<string | Uint8Array>} fontFiles
 * @param {readonly number[]} required
 * @returns {number[]}
 */
export function missingCodePoints(fontFiles, required = REQUIRED_CODE_POINTS) {
  const coverage = new Set();
  for (const file of fontFiles) {
    for (const cp of codePointsOf(file)) coverage.add(cp);
  }
  return missingFromCoverage(coverage, required);
}

/** @param {number} cp */
export function formatCodePoint(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')} (${String.fromCodePoint(cp)})`;
}

/**
 * Tüm aileleri denetler. `missing`: istisna dışı eksikler (hata); `tolerated`: KNOWN_GAPS ile
 * örtüşen eksikler (uyarı); `staleGaps`: istisnada olup dosyada bulunan kod noktaları (hata).
 * @param {string} fontsDir
 * @param {Readonly<Record<string, { label: string, files: readonly string[] }>>} families
 * @param {Readonly<Record<string, readonly number[]>>} knownGaps
 */
export function checkFamilies(
  fontsDir = FONTS_DIR,
  families = FONT_FAMILIES,
  knownGaps = KNOWN_GAPS,
) {
  return Object.entries(families).map(([id, family]) => {
    const paths = family.files.map((f) => join(fontsDir, f));
    const absent = paths.filter((p) => !statSync(p, { throwIfNoEntry: false })?.isFile());
    const present = paths.filter((p) => !absent.includes(p));
    const bytes = present.reduce((sum, p) => sum + statSync(p).size, 0);
    const allMissing = absent.length > 0 ? [] : missingCodePoints(paths);
    const gaps = knownGaps[id] ?? [];
    const missing = allMissing.filter((cp) => !gaps.includes(cp));
    const tolerated = allMissing.filter((cp) => gaps.includes(cp));
    const staleGaps = absent.length > 0 ? [] : gaps.filter((cp) => !allMissing.includes(cp));
    return {
      id,
      label: family.label,
      files: family.files,
      absent,
      missing,
      tolerated,
      staleGaps,
      bytes,
    };
  });
}

/** @param {number} n */
function kb(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

function main(argv) {
  const idx = argv.indexOf('--files');
  let results;
  if (idx !== -1) {
    const list = argv[idx + 1];
    if (!list) {
      err('--files için virgülle ayrılmış dosya listesi verin.');
      return 2;
    }
    const files = list.split(',').filter(Boolean);
    const paths = files.map((f) => (isAbsolute(f) ? f : resolve(FONTS_DIR, f)));
    results = checkFamilies(
      '/',
      {
        ozel: { label: `Verilen küme (${files.map((f) => basename(f)).join(', ')})`, files: paths },
      },
      {},
    );
  } else {
    results = checkFamilies();
  }

  let failed = false;
  let total = 0;
  for (const r of results) {
    total += r.bytes;
    if (r.absent.length > 0) {
      failed = true;
      err(`HATA ${r.label}: dosya yok: ${r.absent.map((p) => basename(p)).join(', ')}`);
      err('  Çözüm: node packages/ui/scripts/vendor-fonts.mjs');
      continue;
    }
    if (r.missing.length > 0) {
      failed = true;
      err(`HATA ${r.label}: eksik kod noktası: ${r.missing.map(formatCodePoint).join(', ')}`);
    }
    if (r.staleGaps.length > 0) {
      failed = true;
      err(
        `HATA ${r.label}: gereksiz istisna (dosyada var): ${r.staleGaps.map(formatCodePoint).join(', ')}; KNOWN_GAPS'ten çıkarın`,
      );
    }
    if (r.tolerated.length > 0) {
      err(
        `UYARI ${r.label}: upstream eksik (KNOWN_GAPS, yedek yığına düşer): ${r.tolerated.map(formatCodePoint).join(', ')}`,
      );
    }
    if (r.missing.length === 0 && r.staleGaps.length === 0) {
      out(`tamam ${r.label}: ${r.files.length} dosya, ${kb(r.bytes)}`);
    }
  }
  out(`toplam woff2: ${total} bayt (${kb(total)})`);
  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
