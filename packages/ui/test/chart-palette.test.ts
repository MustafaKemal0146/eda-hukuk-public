// @tk TK-33
// KK-P05-14 (KK-051-14): grafik paleti, saf TS CVD benzetimi (Machado 2009) + CIEDE2000.
// Eşikler 051 §4.10 metnindeki kuraldır (ardışık CVD >= 8, normal görme >= 15, koyu yüzeyle
// >= 3:1, ilk üç slot tüm çiftlerde). Palet testi geçirmek için DEĞİŞTİRİLMEZ; tablodaki sayısal
// değerlerden farklar aşağıdaki belgelenmiş beklenen istisnalarda tutulur (P05 "Doğrulanacak").
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../scripts/gen-tokens.ts';
import {
  CVD_KINDS,
  type CvdKind,
  contrastRatio,
  deltaE2000,
  linearRgbToLab,
  perceivedDeltaE,
  simulateCvd,
} from '../src/tokens/color.ts';
import {
  CHART_ALL_PAIRS_SLOT_COUNT,
  CHART_SERIES_TOKENS,
  type ChartSeriesToken,
} from '../src/tokens/index.ts';

type Slot = { token: string; hue: string; light: string; dark: string };
type Palette = {
  surface: Record<Mode, { token: string; value: string }>;
  slots: Slot[];
  thresholds: {
    adjacentCvdMin: number;
    normalMin: number;
    darkSurfaceContrastMin: number;
    allPairsSlotCount: number;
  };
  documented: Record<Mode, { below3to1: string[] }>;
};
type Mode = 'light' | 'dark';
const MODES: readonly Mode[] = ['light', 'dark'];

const palette = JSON.parse(
  readFileSync(new URL('../src/tokens/chart-palette.json', import.meta.url), 'utf8'),
) as Palette;
const source = loadSource();
const t = palette.thresholds;

const hexes = (mode: Mode): string[] => palette.slots.map((s) => s[mode]);
const round2 = (n: number): number => Math.round(n * 100) / 100;

function pairsOf(n: number, adjacentOnly: boolean): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (!adjacentOnly || j === i + 1) out.push([i, j]);
  }
  return out;
}

function worst(mode: Mode, kinds: readonly (CvdKind | undefined)[], idx: [number, number][]) {
  const h = hexes(mode);
  let min = { value: Number.POSITIVE_INFINITY, pair: '', kind: '' };
  for (const kind of kinds) {
    for (const [i, j] of idx) {
      const v = perceivedDeltaE(h[i] ?? '', h[j] ?? '', kind);
      if (v < min.value) {
        min = {
          value: v,
          pair: `${palette.slots[i]?.token}/${palette.slots[j]?.token}`,
          kind: kind ?? 'normal',
        };
      }
    }
  }
  return { ...min, value: round2(min.value) };
}

describe('KK-P05-14: hesap yönteminin doğruluğu', () => {
  it('CIEDE2000 Sharma 2005 sınama çiftleri', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE2000([50, 3.1571, -77.2803], [50, 0, -82.7485])).toBeCloseTo(2.8615, 4);
    expect(deltaE2000([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4);
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
  });

  it('CVD benzetimi beyaz ve siyahı korur, kırmızı/yeşil ayrımını protan/deutan için daraltır', () => {
    for (const kind of CVD_KINDS) {
      for (const c of simulateCvd('#FFFFFF', kind)) expect(c).toBeCloseTo(1, 2);
      expect(simulateCvd('#000000', kind)).toEqual([0, 0, 0]);
    }
    const normal = perceivedDeltaE('#FF0000', '#00FF00');
    expect(perceivedDeltaE('#FF0000', '#00FF00', 'deutan')).toBeLessThan(normal / 2);
    expect(perceivedDeltaE('#FF0000', '#00FF00', 'protan')).toBeLessThan(normal / 2);
    expect(linearRgbToLab([1, 1, 1])[0]).toBeCloseTo(100, 3);
  });
});

describe('KK-P05-14 (KK-051-14): sekiz slot ve sabit sıra', () => {
  it('sekiz slot, chart-1..8 sırası, kaynakla ve TS sabitleriyle aynı', () => {
    expect(palette.slots.map((s) => s.token)).toEqual([...CHART_SERIES_TOKENS]);
    expect(palette.slots.map((s) => [s.token, s.light, s.dark])).toEqual(
      Object.entries(source.chart.slots).map(([k, v]) => [k, v.light, v.dark]),
    );
    expect(t.allPairsSlotCount).toBe(CHART_ALL_PAIRS_SLOT_COUNT);
    expect(palette.surface.light.value).toBe(source.colors.surface?.light);
    expect(palette.surface.dark.value).toBe(source.colors.surface?.dark);
  });

  it('durum renkleri seri rengi olarak kullanılamaz (tip ve değer)', () => {
    const series: ChartSeriesToken = 'chart-1';
    // @ts-expect-error durum tokenı seri rengi tipi değildir
    const status: ChartSeriesToken = 'success';
    expect([series, status].filter((x) => CHART_SERIES_TOKENS.includes(x))).toEqual(['chart-1']);
    const STATUS = /^(success|warning|danger|info|neutral|violet|teal)(-|$)/;
    for (const mode of MODES) {
      const statusHex = new Set(
        Object.entries(source.colors)
          .filter(([k]) => STATUS.test(k))
          .map(([, v]) => v[mode].toUpperCase()),
      );
      for (const s of palette.slots)
        expect(statusHex.has(s[mode].toUpperCase()), s.token).toBe(false);
    }
  });
});

describe('KK-P05-14 (KK-051-14): eşikler', () => {
  for (const mode of MODES) {
    it(`${mode}: ardışık çiftlerde CVD ΔE2000 >= ${t.adjacentCvdMin} (protan, deutan, tritan)`, () => {
      expect(worst(mode, CVD_KINDS, pairsOf(8, true)).value).toBeGreaterThanOrEqual(
        t.adjacentCvdMin,
      );
    });

    it(`${mode}: ardışık çiftlerde normal görme ΔE2000 >= ${t.normalMin}`, () => {
      expect(worst(mode, [undefined], pairsOf(8, true)).value).toBeGreaterThanOrEqual(t.normalMin);
    });

    it(`${mode}: ilk üç slot tüm çiftlerde CVD >= ${t.adjacentCvdMin} ve normal >= ${t.normalMin}`, () => {
      const idx = pairsOf(t.allPairsSlotCount, false);
      expect(worst(mode, CVD_KINDS, idx).value).toBeGreaterThanOrEqual(t.adjacentCvdMin);
      expect(worst(mode, [undefined], idx).value).toBeGreaterThanOrEqual(t.normalMin);
    });
  }

  it(`koyu modda tüm slotlar yüzeyle >= ${t.darkSurfaceContrastMin}:1`, () => {
    for (const s of palette.slots) {
      expect(contrastRatio(s.dark, palette.surface.dark.value), s.token).toBeGreaterThanOrEqual(
        t.darkSurfaceContrastMin,
      );
    }
  });

  it('açık modda 3:1 altındaki slotlar 051 §4.10 / §5.3 ile aynıdır (etiket veya tablo zorunlu)', () => {
    for (const mode of MODES) {
      const below = palette.slots
        .filter((s) => contrastRatio(s[mode], palette.surface[mode].value) < 3)
        .map((s) => s.token);
      expect(below).toEqual(palette.documented[mode].below3to1);
    }
  });
});

describe('KK-P05-14: belgelenmiş beklenen istisnalar (051 §4.10 sayılarından fark; palet değişmez)', () => {
  // 051 §4.10 tablosu en kötü ardışık CVD ΔE için 9.1 (açık) / 8.4 (koyu), normal görme tabanı için
  // 19.6 / 19.3 verir; bu sayıları üreten validate_palette betiği repoda yoktur. Machado 2009 +
  // CIEDE2000 ile hesaplanan değerler aşağıdadır. Ardışık eşikler geçer; yalnız ARDIŞIK OLMAYAN
  // çiftlerde normal görme ΔE 15 altına inen iki çift vardır (051 KK-051-14 eşiği ardışık
  // çiftler içindir; yan yana her çiftin göründüğü grafiklerde yalnız ilk üç slot kullanılır).
  const MEASURED = {
    light: {
      adjacentCvd: { value: 8.16, pair: 'chart-4/chart-5', kind: 'tritan' },
      adjacentNormal: 42.56,
    },
    dark: {
      adjacentCvd: { value: 10.21, pair: 'chart-4/chart-5', kind: 'tritan' },
      adjacentNormal: 34.87,
    },
  } as const;
  const NON_ADJACENT_NORMAL_BELOW_15 = {
    light: ['chart-2/chart-8 13.26'],
    dark: ['chart-5/chart-8 14.09'],
  } as const;

  for (const mode of MODES) {
    it(`${mode}: ölçülen en kötü değerler kayıtlıdır`, () => {
      expect(worst(mode, CVD_KINDS, pairsOf(8, true))).toEqual(MEASURED[mode].adjacentCvd);
      expect(worst(mode, [undefined], pairsOf(8, true)).value).toBe(MEASURED[mode].adjacentNormal);
    });

    it(`${mode}: ardışık olmayan çiftlerde normal görme ΔE < 15 olanlar yalnız belgelenenlerdir`, () => {
      const h = hexes(mode);
      const below = pairsOf(8, false)
        .filter(([i, j]) => j !== i + 1)
        .map(([i, j]) => ({ i, j, v: perceivedDeltaE(h[i] ?? '', h[j] ?? '') }))
        .filter((x) => x.v < t.normalMin)
        .map((x) => `${palette.slots[x.i]?.token}/${palette.slots[x.j]?.token} ${round2(x.v)}`);
      expect(below).toEqual(NON_ADJACENT_NORMAL_BELOW_15[mode]);
    });
  }
});
