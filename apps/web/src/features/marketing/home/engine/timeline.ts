// Kaydırmayla ilerleyen sahne çizelgesi (GSAP ScrollTrigger yerine): bağımlılıksız, saf işlevler.
// Bir iz (Track) ardışık parçalardan oluşur; zaman parçadan önce ilk `from`, parçalar arasında önceki
// `to`, sonda son `to` değerini verir (GSAP `fromTo` zinciriyle aynı davranış). Yumuşatmalar GSAP
// `powerN` eğrileridir (power1 ikinci, power2 üçüncü derece).

export type Ease = (t: number) => number;

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export const EASE = {
  linear: (t: number) => t,
  power1In: (t: number) => t * t,
  power2Out: (t: number) => 1 - (1 - t) ** 3,
  power2InOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
} as const satisfies Record<string, Ease>;

export type Value = number | (() => number);

export type Seg = { start: number; dur: number; from: Value; to: Value; ease: Ease };

const val = (v: Value): number => (typeof v === 'function' ? v() : v);

/** İzin `t` anındaki değeri. Parçalar başlangıç sırasına göre verilir. */
export function sample(segs: readonly Seg[], t: number): number {
  const first = segs[0];
  if (!first) return 0;
  let out = val(first.from);
  for (const s of segs) {
    if (t >= s.start + s.dur) {
      out = val(s.to);
    } else if (t >= s.start) {
      const k = s.ease((t - s.start) / s.dur);
      const a = val(s.from);
      return a + (val(s.to) - a) * k;
    } else {
      break;
    }
  }
  return out;
}

/** Kaydırma ilerlemesi (0..1): kapsayıcının üstü görünüm üstüne geldiğinde 0, altı görünüm altına geldiğinde 1. */
export function scrollProgress(
  rectTop: number,
  rectHeight: number,
  viewportHeight: number,
): number {
  const span = rectHeight - viewportHeight;
  return span <= 0 ? 0 : clamp(-rectTop / span, 0, 1);
}

/** Üstel yumuşatma: oynatma başı hedefe `tau` saniye zaman sabitiyle yaklaşır (GSAP `scrub: 0.7` karşılığı). */
export function smooth(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** Sahne adımları (0..5 ölçeği): hangi sahne görünür ve anlatı adımı hangisi. */
export function sceneAt(p: number): 0 | 1 | 2 {
  return p < 2.1 ? 0 : p < 3.5 ? 1 : 2;
}

export function stepAt(p: number): number {
  return clamp(Math.floor((p - 0.8) / 0.32), 0, 3);
}
