// Saf renk hesapları (P05.4; bağımlılık yok): WCAG 2.x kontrast oranı, sRGB -> CIELAB (D65),
// CIEDE2000 renk farkı ve Machado 2009 renk görme eksikliği (CVD) benzetimi. Kontrast ve grafik
// paleti testlerinin girdisidir; çalışma zamanı bileşenleri kullanmaz.

export type Rgb = readonly [number, number, number];
export type Lab = readonly [number, number, number];
export type CvdKind = 'protan' | 'deutan' | 'tritan';
export const CVD_KINDS: readonly CvdKind[] = ['protan', 'deutan', 'tritan'];

const HEX = /^#([0-9a-fA-F]{6})$/;

/** `#RRGGBB` -> doğrusal sRGB [0, 1]. */
export function hexToLinearRgb(hex: string): Rgb {
  const m = HEX.exec(hex);
  if (!m?.[1]) throw new Error(`geçersiz hex: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  const channel = (shift: number): number => {
    const c = ((n >> shift) & 0xff) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(16), channel(8), channel(0)];
}

/** WCAG 2.x göreli parlaklık (051 §5 yöntemi). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToLinearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x kontrast oranı: (L1 + 0.05) / (L2 + 0.05), L1 >= L2. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Doğrusal sRGB -> CIELAB (D65 beyaz noktası). */
export function linearRgbToLab([r, g, b]: Rgb): Lab {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const d = 6 / 29;
  const f = (t: number): number => (t > d ** 3 ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToLab(hex: string): Lab {
  return linearRgbToLab(hexToLinearRgb(hex));
}

const deg = (rad: number): number => (rad * 180) / Math.PI;
const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/** CIEDE2000 (Sharma, Wu, Dalal 2005), kL = kC = kH = 1. */
export function deltaE2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar7 = ((c1 + c2) / 2) ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (a: number, b: number): number =>
    a === 0 && b === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360;
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);

  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp / 2));

  const lBarP = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hBarP = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hBarP = (h1p + h2p + 360) / 2;
    else hBarP = (h1p + h2p - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos(rad(hBarP - 30)) +
    0.24 * Math.cos(rad(2 * hBarP)) +
    0.32 * Math.cos(rad(3 * hBarP + 6)) -
    0.2 * Math.cos(rad(4 * hBarP - 63));
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const cBarP7 = cBarP ** 7;
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(rad(2 * dTheta)) * rc;
  return Math.sqrt(
    (dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh),
  );
}

type Matrix = readonly [Rgb, Rgb, Rgb];

/** Machado, Oliveira, Fernandes (2009) tam şiddet (1.0) matrisleri; doğrusal sRGB'de uygulanır. */
export const MACHADO_2009: Readonly<Record<CvdKind, Matrix>> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** Rengi CVD türüne göre benzetir; sonuç [0, 1] aralığına kırpılmış doğrusal sRGB. */
export function simulateCvd(hex: string, kind: CvdKind): Rgb {
  const rgb = hexToLinearRgb(hex);
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  const row = (m: Rgb): number => clamp(m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2]);
  const [r0, r1, r2] = MACHADO_2009[kind];
  return [row(r0), row(r1), row(r2)];
}

/** İki rengin normal görmede (kind yoksa) veya CVD benzetiminde CIEDE2000 farkı. */
export function perceivedDeltaE(a: string, b: string, kind?: CvdKind): number {
  const lab = (hex: string): Lab => (kind ? linearRgbToLab(simulateCvd(hex, kind)) : hexToLab(hex));
  return deltaE2000(lab(a), lab(b));
}
