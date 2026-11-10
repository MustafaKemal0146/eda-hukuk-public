// @tk TK-33
// KK-P05-4 (KK-050-14 yazı tipi yarısı): check-font-glyphs tüm ailelerde zorunlu kod noktalarını
// bulur; ğ'siz sahte küme betiği kırar; dosyalar ve lisans metinleri depodadır.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type FamilyResult = {
  id: string;
  absent: string[];
  missing: number[];
  tolerated: number[];
  staleGaps: number[];
};

type GlyphModule = {
  FONTS_DIR: string;
  REQUIRED_CODE_POINTS: readonly number[];
  FONT_FAMILIES: Readonly<Record<string, { label: string; files: readonly string[] }>>;
  KNOWN_GAPS: Readonly<Record<string, readonly number[]>>;
  missingCodePoints: (
    files: ReadonlyArray<string | Uint8Array>,
    required?: readonly number[],
  ) => number[];
  missingFromCoverage: (coverage: Iterable<number>, required?: readonly number[]) => number[];
  checkFamilies: () => FamilyResult[];
};

const SCRIPT = fileURLToPath(new URL('../scripts/check-font-glyphs.mjs', import.meta.url));
const glyphs = (await import(SCRIPT)) as GlyphModule;
const { FONTS_DIR, FONT_FAMILIES, KNOWN_GAPS, REQUIRED_CODE_POINTS } = glyphs;

const G_BREVE = 0x011f; // ğ

function runCli(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('KK-P05-4: yazı tipi glif kapsamı (check-font-glyphs)', () => {
  it('zorunlu liste P05.5 ile birebir (14 kod noktası)', () => {
    expect([...REQUIRED_CODE_POINTS].sort((a, b) => a - b)).toEqual([
      0x00a7, 0x011e, 0x011f, 0x0130, 0x0131, 0x015e, 0x015f, 0x2013, 0x2014, 0x2018, 0x2019,
      0x201c, 0x201d, 0x20ba,
    ]);
  });

  it('dört aile tanımlı: Geist, Source Serif 4, Geist Mono, Liberation Serif', () => {
    expect(Object.values(FONT_FAMILIES).map((f) => f.label)).toEqual([
      'Geist',
      'Source Serif 4',
      'Geist Mono',
      'Liberation Serif',
    ]);
  });

  for (const [id, family] of Object.entries(FONT_FAMILIES)) {
    it(`${family.label}: birleşik kapsam zorunlu kod noktalarını içerir (ölçülmüş istisna dışında)`, () => {
      const missing = glyphs.missingCodePoints(family.files.map((f) => join(FONTS_DIR, f)));
      expect(missing).toEqual([...(KNOWN_GAPS[id] ?? [])]);
    });
  }

  it('Türkçe harfler ve tipografik işaretler hiçbir ailede istisna değildir', () => {
    for (const gaps of Object.values(KNOWN_GAPS)) expect(gaps).toEqual([0x20ba]);
  });

  it('checkFamilies: eksik dosya, istisna dışı eksik ve gereksiz istisna yok', () => {
    for (const r of glyphs.checkFamilies()) {
      expect(r.absent, r.id).toEqual([]);
      expect(r.missing, r.id).toEqual([]);
      expect(r.staleGaps, r.id).toEqual([]);
    }
  });

  it("ğ'siz sahte glif kümesi: saf fonksiyon U+011F'yi eksik bildirir", () => {
    const fake = REQUIRED_CODE_POINTS.filter((cp) => cp !== G_BREVE);
    expect(glyphs.missingFromCoverage(new Set(fake))).toEqual([G_BREVE]);
    expect(glyphs.missingFromCoverage(new Set(REQUIRED_CODE_POINTS))).toEqual([]);
  });

  it('CLI gerçek dosyalarda 0 ile biter ve toplam boyutu yazar', () => {
    const r = runCli([]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/toplam woff2: \d+ bayt/);
  });

  it("CLI ğ'siz küme (yalnız latin alt kümesi) ile başarısız olur", () => {
    const r = runCli(['--files', 'source-serif-4-var-latin.woff2']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('U+011F');
  });

  it('CLI argümansız --files ile 2 döner', () => {
    expect(runCli(['--files']).status).toBe(2);
  });
});

describe('KK-P05-4: yazı tipi dosyaları ve lisanslar depoda (self-host, OFL-1.1)', () => {
  it('fonts/ içindeki woff2 kümesi aile listesiyle birebir', () => {
    const onDisk = readdirSync(FONTS_DIR)
      .filter((f) => f.endsWith('.woff2'))
      .sort();
    const declared = Object.values(FONT_FAMILIES)
      .flatMap((f) => [...f.files])
      .sort();
    expect(onDisk).toEqual(declared);
  });

  it('LICENSES.md her aile için OFL metni ve telif satırı taşır', () => {
    const md = readFileSync(join(FONTS_DIR, 'LICENSES.md'), 'utf8');
    for (const family of Object.values(FONT_FAMILIES)) {
      const start = md.indexOf(`## ${family.label}\n`);
      expect(start, family.label).toBeGreaterThan(-1);
      const next = md.indexOf('\n## ', start + 1);
      const section = md.slice(start, next === -1 ? undefined : next);
      expect(section).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(section).toMatch(/Copyright/);
      for (const file of family.files) expect(section).toContain(file);
    }
  });
});
