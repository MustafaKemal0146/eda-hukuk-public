// Sahne: ilk ekran + kaydırmayla sabitlenen ürün anlatımı. Hareket açıkken (`cine`) tiyatro kapsayıcısı
// 560vh yüksekliğinde sabitlenir; maket hero konumundan anlatı konumuna kayar/küçülür ve kaydırma
// ilerlemesiyle sohbet → stüdyo → takvim sahneleri değişir. İlerleme `requestAnimationFrame` ile
// yumuşatılır (GSAP ScrollTrigger `scrub` yerine; bağımlılık yok). Hareket azaltılmışsa (`static`)
// maket olduğu gibi akar, demo son durumuyla (veya otomatik) gösterilir.
import type { Mock } from './mock.ts';
import {
  clamp,
  EASE,
  type Seg,
  sample,
  sceneAt,
  scrollProgress,
  smooth,
  stepAt,
} from './timeline.ts';
import { all, must, setAlpha } from './util.ts';

type Place = { x: number; y: number; s: number };

export type Stage = { mode: 'cine' | 'static'; destroy: () => void };

const COMPACT_BELOW = 860;
const COMPACT_SIZE = { W: 390, H: 800 } as const;
const WIDE_SIZE = { W: 1280, H: 840 } as const;
/** Kaydırma ilerlemesinin çizelge ölçeği (0..5) ve kenar menüsü hedefleri. */
const SPAN = 5;
const NAV_TARGETS = [1.4, 2.8, 4.4] as const;
/** Oynatma başı hedefe bu zaman sabitiyle yaklaşır (saniye); GSAP `scrub: 0.7` ile aynı his. */
const SCRUB_TAU = 0.23;

const isCompact = (): boolean => window.innerWidth < COMPACT_BELOW;
const sizes = (): { W: number; H: number } => (isCompact() ? COMPACT_SIZE : WIDE_SIZE);
const gutter = (): number => clamp(window.innerWidth * 0.04, 16, 56);

export function createStage(
  root: HTMLElement,
  mock: Mock,
  opts: { cine: boolean; reduced: boolean },
): Stage {
  const theatre = must<HTMLElement>(root, '.mk-theatre');
  const sticky = must<HTMLElement>(root, '.mk-theatre-sticky');
  const heroCopy = must<HTMLElement>(root, '.mk-hero-copy');
  const wrap = must<HTMLElement>(root, '.mk-device-wrap');
  const device = must<HTMLElement>(root, '.device');
  const nav = must<HTMLElement>(root, '.mk-nav');
  const chapters = all<HTMLElement>(root, '.mk-chapter');
  const steps = all<HTMLElement>(root, '.mk-step');
  const replay = must<HTMLElement>(root, '.mk-replay');
  const hint = must<HTMLElement>(root, '.mk-scroll-hint');
  const progress = must<HTMLElement>(root, '.mk-story-progress');
  const sChat = must<HTMLElement>(root, '.scene-chat');
  const sStudio = must<HTMLElement>(root, '.scene-studio');
  const sDead = must<HTMLElement>(root, '.scene-deadline');

  const place = { hero: { x: 0, y: 0, s: 1 } as Place, story: { x: 0, y: 0, s: 1 } as Place };
  const timers: ReturnType<typeof setTimeout>[] = [];
  const cleanups: (() => void)[] = [];
  let raf = 0;
  let onResize: () => void = () => undefined;

  function compute(): void {
    const compact = isCompact();
    mock.setCompact(compact);
    const d = sizes();
    const vw = sticky.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const g = gutter();
    if (!opts.cine) {
      const avail = Math.min(vw - 2 * g, 1080);
      const s0 = Math.min(avail / d.W, 1);
      device.style.transform = `scale(${s0})`;
      wrap.style.width = `${d.W * s0}px`;
      wrap.style.height = `${d.H * s0}px`;
      return;
    }
    device.style.transform = '';
    wrap.style.width = '';
    wrap.style.height = '';
    const navH = nav.offsetHeight;
    const heroBottom = heroCopy.offsetTop + heroCopy.offsetHeight;
    const hs = Math.min(Math.min(vw - 2 * g, 1060) / d.W, 1);
    place.hero = { s: hs, x: (vw - d.W * hs) / 2, y: heroBottom + (compact ? 28 : 44) };
    if (vw >= 1024) {
      const copyW = Math.min(vw * 0.36, 460);
      const left = g + copyW + 48;
      const aW = vw - left - g;
      const aH = vh - navH - 110;
      const ss = Math.min(aW / d.W, aH / d.H, 1);
      place.story = {
        s: ss,
        x: left + (aW - d.W * ss) / 2,
        y: navH + (vh - navH - d.H * ss) / 2 - 6,
      };
    } else {
      const ss = Math.min((vw - 2 * g) / d.W, (vh * 0.52) / d.H);
      const top = navH + 10;
      place.story = { s: ss, x: (vw - d.W * ss) / 2, y: top };
      sticky.style.setProperty('--mk-copy-top', `${top + d.H * ss + 18}px`);
    }
  }

  /** Ayrık durum: kaydırma ilerlemesine (0..5) göre sahne, anlatı adımı ve maket içi ilerlemeler. */
  function onProgress(p: number): void {
    mock.setScene(sceneAt(p));
    const si = stepAt(p);
    steps.forEach((s, i) => {
      s.classList.toggle('is-on', i === si);
    });
    mock.setStudio(clamp((p - 2.1) / 1.1, 0, 1));
    mock.setDeadline(clamp((p - 3.55) / 1.0, 0, 1));
  }

  // ------------------------------------------------------------------ sinematik mod
  const ease2o = EASE.power2Out;
  const seg = (start: number, dur: number, from: number, to: number, ease = ease2o): Seg => ({
    start,
    dur,
    from,
    to,
    ease,
  });
  const chapterAlpha = (inAt: number, outAt?: number): Seg[] => [
    seg(inAt, 0.35, 0, 1),
    ...(outAt === undefined ? [] : [seg(outAt, 0.3, 1, 0, EASE.power1In)]),
  ];
  const chapterY = (inAt: number, outAt?: number): Seg[] => [
    seg(inAt, 0.35, 50, 0),
    ...(outAt === undefined ? [] : [seg(outAt, 0.3, 0, -50, EASE.power1In)]),
  ];
  const wrapSegs = {
    x: [
      {
        start: 0,
        dur: 1,
        from: () => place.hero.x,
        to: () => place.story.x,
        ease: EASE.power2InOut,
      },
    ],
    y: [
      {
        start: 0,
        dur: 1,
        from: () => place.hero.y,
        to: () => place.story.y,
        ease: EASE.power2InOut,
      },
    ],
    s: [
      {
        start: 0,
        dur: 1,
        from: () => place.hero.s,
        to: () => place.story.s,
        ease: EASE.power2InOut,
      },
    ],
  } satisfies Record<string, Seg[]>;
  const heroAlpha = [seg(0, 0.55, 1, 0, EASE.power1In)];
  const heroY = [seg(0, 0.55, 0, -90, EASE.power1In)];
  const hintAlpha = [seg(0, 0.15, 1, 0)];
  const progressAlpha = [seg(0.8, 0.3, 0, 1)];
  const replayFade = [seg(0.1, 0.2, 1, 0)];
  const chapterTracks = [
    { a: chapterAlpha(0.72, 1.95), y: chapterY(0.72, 1.95) },
    { a: chapterAlpha(2.2, 3.35), y: chapterY(2.2, 3.35) },
    { a: chapterAlpha(3.6), y: chapterY(3.6) },
  ];
  const chatAlpha = [seg(2.0, 0.25, 1, 0)];
  const studioAlpha = [seg(2.1, 0.35, 0, 1), seg(3.4, 0.25, 1, 0)];
  const studioY = [seg(2.1, 0.35, 24, 0)];
  const deadAlpha = [seg(3.5, 0.35, 0, 1)];
  const deadY = [seg(3.5, 0.35, 24, 0)];

  function paint(p: number): void {
    const x = sample(wrapSegs.x, p);
    const y = sample(wrapSegs.y, p);
    const s = sample(wrapSegs.s, p);
    wrap.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    setAlpha(heroCopy, sample(heroAlpha, p));
    heroCopy.style.transform = `translateY(${sample(heroY, p)}px)`;
    setAlpha(hint, sample(hintAlpha, p));
    setAlpha(progress, sample(progressAlpha, p));
    replay.style.setProperty('--mk-replay-fade', String(sample(replayFade, p)));
    chapters.forEach((ch, i) => {
      const tr = chapterTracks[i];
      if (!tr) return;
      setAlpha(ch, sample(tr.a, p));
      ch.style.transform = `translateY(${sample(tr.y, p)}px)`;
    });
    setAlpha(sChat, sample(chatAlpha, p));
    setAlpha(sStudio, sample(studioAlpha, p));
    sStudio.style.transform = `translateY(${sample(studioY, p)}px)`;
    setAlpha(sDead, sample(deadAlpha, p));
    sDead.style.transform = `translateY(${sample(deadY, p)}px)`;
    onProgress(p);
  }

  function buildCine(): void {
    let current = 0;
    let last = performance.now();
    let primed = false;
    const target = (): number => {
      const r = theatre.getBoundingClientRect();
      return scrollProgress(r.top, r.height, window.innerHeight) * SPAN;
    };
    const frame = (now: number): void => {
      raf = 0;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = target();
      current = primed ? smooth(current, t, dt, SCRUB_TAU) : t;
      primed = true;
      paint(current);
      if (Math.abs(current - t) > 0.0005) raf = requestAnimationFrame(frame);
    };
    const request = (): void => {
      if (raf === 0) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    compute();
    paint(target());
    primed = true;
    current = target();
    window.addEventListener('scroll', request, { passive: true });
    cleanups.push(() => {
      window.removeEventListener('scroll', request);
    });
    root.dataset.stage = 'cine';
    // Açılış: nav ve başlık CSS ile girer; maket eğimden düzleşir (CSS), sonra demo oynar.
    timers.push(setTimeout(() => void mock.run(), 1600));
    for (const li of mock.navItems) {
      const onClick = (): void => {
        const idx = Number(li.getAttribute('data-go'));
        const frac = (NAV_TARGETS[idx] ?? 0) / SPAN;
        const top = window.scrollY + theatre.getBoundingClientRect().top;
        window.scrollTo({
          top: top + (theatre.offsetHeight - window.innerHeight) * frac,
          behavior: 'smooth',
        });
      };
      li.addEventListener('click', onClick);
      cleanups.push(() => li.removeEventListener('click', onClick));
    }
    request();
    onResize = () => {
      const was = mock.isCompact();
      compute();
      paint(current);
      if (was !== isCompact()) {
        mock.closeSheet();
        mock.stickBottom();
      }
    };
  }

  // ------------------------------------------------------------------ statik mod
  function buildStatic(): void {
    compute();
    mock.setScene(0);
    mock.setStudio(1);
    mock.setDeadline(1);
    root.dataset.stage = 'static';
    if (opts.reduced) mock.setFinal();
    else timers.push(setTimeout(() => void mock.run(), 600));
    for (const li of mock.navItems) {
      const onClick = (): void => mock.setScene(Number(li.getAttribute('data-go')));
      li.addEventListener('click', onClick);
      cleanups.push(() => li.removeEventListener('click', onClick));
    }
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (en.isIntersecting) mock.setScene(Number(en.target.getAttribute('data-ch')));
          }
        },
        { threshold: 0.6 },
      );
      for (const c of chapters) io.observe(c);
      cleanups.push(() => io.disconnect());
    }
    onResize = () => {
      const was = mock.isCompact();
      compute();
      if (was !== isCompact()) {
        mock.closeSheet();
        mock.stickBottom();
      }
    };
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onWindowResize = (): void => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => onResize(), 150);
  };
  window.addEventListener('resize', onWindowResize);
  cleanups.push(() => {
    window.removeEventListener('resize', onWindowResize);
    clearTimeout(resizeTimer);
  });

  if (opts.cine) buildCine();
  else buildStatic();
  void document.fonts?.ready.then(() => {
    onResize();
  });

  return {
    mode: opts.cine ? 'cine' : 'static',
    destroy: () => {
      if (raf) cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
      for (const fn of cleanups) fn();
    },
  };
}
