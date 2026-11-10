// Sahne altı bölümlerinin davranışı: Künye Kilidi zinciri (etiket → künye → doğrulama), dışa aktarım
// kapısı anahtarı, kaynak kartlarında tarama çizgisi, görünürlükle beliren bloklar ve ince etkileşimler
// (kartlarda imleç ışığı, düğmelerde manyetik kayma, ızgara ışıması). Hareket azaltılmışsa zincir ve
// taramalar son durumuyla gösterilir.
import { all, must, sleep, typeText } from './util.ts';

export type Sections = { destroy: () => void };

export function createSections(
  root: HTMLElement,
  opts: { reduced: boolean; fine: boolean },
): Sections {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const cleanups: (() => void)[] = [];
  const later = (fn: () => void, ms: number): void => {
    timers.push(setTimeout(fn, ms));
  };

  // ------------------------------------------------------------------ Künye Kilidi zinciri
  const chain = must<HTMLElement>(root, '.mk-chain');
  const nodes = all<HTMLElement>(chain, '.mk-node');
  const wires = all<HTMLElement>(chain, '.mk-wire');
  const typed = all<HTMLElement>(chain, '[data-t]');
  const stamp = must<HTMLElement>(chain, '.stamp');
  const stampChip = must<HTMLElement>(stamp, '.e-chip');
  let chainRun = 0;

  function chainFinal(): void {
    chainRun += 1;
    for (const n of nodes) n.classList.add('lit');
    for (const w of wires) w.classList.add('run');
    for (const el of typed) el.textContent = el.getAttribute('data-t') ?? '';
    stamp.classList.add('ok');
    stampChip.setAttribute('data-status', 'verified');
  }

  function chainBlank(): void {
    for (const n of nodes) n.classList.remove('lit');
    for (const w of wires) w.classList.remove('run');
    for (const el of typed) el.textContent = '';
    stampChip.setAttribute('data-status', 'pending');
    stamp.classList.remove('ok');
  }

  async function playChain(): Promise<void> {
    chainRun += 1;
    const id = chainRun;
    const ok = (): boolean => id === chainRun;
    chainBlank();
    await sleep(300);
    if (!ok()) return;
    nodes[0]?.classList.add('lit');
    await sleep(700);
    if (!ok()) return;
    wires[0]?.classList.add('run');
    await sleep(800);
    if (!ok()) return;
    nodes[1]?.classList.add('lit');
    for (const el of typed) {
      await typeText(el, el.getAttribute('data-t') ?? '', 22, ok);
      if (!ok()) return;
      await sleep(120);
    }
    wires[1]?.classList.add('run');
    await sleep(800);
    if (!ok()) return;
    nodes[2]?.classList.add('lit');
    await sleep(1100);
    if (!ok()) return;
    stamp.classList.add('ok');
    stampChip.setAttribute('data-status', 'verified');
  }

  const chainReplay = must<HTMLElement>(chain, '.mk-chain-replay');
  const onChainReplay = (): void => {
    if (opts.reduced) chainFinal();
    else void playChain();
  };
  chainReplay.addEventListener('click', onChainReplay);
  cleanups.push(() => chainReplay.removeEventListener('click', onChainReplay));

  // ------------------------------------------------------------------ dışa aktarım kapısı
  const gate = must<HTMLElement>(root, '.mk-gate');
  const toggle = must<HTMLInputElement>(gate, '.mk-gd-toggle');
  const k2Chip = must<HTMLElement>(gate, '.k2 .e-chip');
  const onToggle = (): void => {
    gate.setAttribute('data-state', toggle.checked ? 'ok' : 'pending');
    k2Chip.setAttribute('data-status', toggle.checked ? 'verified' : 'pending');
  };
  toggle.addEventListener('change', onToggle);
  cleanups.push(() => toggle.removeEventListener('change', onToggle));

  // ------------------------------------------------------------------ kaynak taraması
  const sources = all<HTMLElement>(root, '.mk-src-grid .mk-src');
  function scanSources(): void {
    sources.forEach((s, i) => {
      later(
        () => {
          s.classList.add('scanning');
          later(() => {
            s.classList.remove('scanning');
            s.classList.add('scanned');
          }, 1100);
        },
        opts.reduced ? 0 : i * 380,
      );
    });
  }

  // ------------------------------------------------------------------ görünürlük tetikleyicileri
  const staggered = all<HTMLElement>(
    root,
    '.mk-bento .mk-reveal, .mk-aud-grid .mk-reveal, .mk-sec-grid3 .mk-reveal, .mk-kunye-items .mk-reveal',
  );
  for (const el of staggered) {
    const i = Array.prototype.indexOf.call(el.parentNode?.children ?? [], el) as number;
    el.style.transitionDelay = `${i * 90}ms`;
  }

  const srcGrid = must<HTMLElement>(root, '.mk-src-grid');
  const flow = must<HTMLElement>(root, '.mk-flow');
  if ('IntersectionObserver' in window) {
    // Akış bu noktada baştan oynayacağından hemen boş duruma alınır (görünürken son hâli parlamasın).
    if (!opts.reduced) chainBlank();
    const revealIO = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          en.target.classList.add('in');
          revealIO.unobserve(en.target);
        }
      },
      { threshold: 0.14, rootMargin: '0px 0px -40px 0px' },
    );
    for (const el of all<HTMLElement>(root, '.mk-reveal')) revealIO.observe(el);
    const once = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          once.unobserve(en.target);
          if (en.target === chain) onChainReplay();
          else if (en.target === srcGrid) scanSources();
          else if (en.target === flow) flow.classList.add('in');
        }
      },
      { threshold: 0.35 },
    );
    once.observe(chain);
    once.observe(srcGrid);
    if (!opts.reduced) once.observe(flow);
    cleanups.push(() => {
      revealIO.disconnect();
      once.disconnect();
    });
  } else {
    for (const el of all<HTMLElement>(root, '.mk-reveal')) el.classList.add('in');
    chainFinal();
  }

  // ------------------------------------------------------------------ ince etkileşimler
  if (opts.fine && !opts.reduced) {
    for (const el of all<HTMLElement>(root, '.mk-glow')) {
      const onMove = (e: PointerEvent): void => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mk-x', `${e.clientX - r.left}px`);
        el.style.setProperty('--mk-y', `${e.clientY - r.top}px`);
      };
      el.addEventListener('pointermove', onMove);
      cleanups.push(() => el.removeEventListener('pointermove', onMove));
    }
    for (const el of all<HTMLElement>(root, '.mk-magnetic')) {
      const onMove = (e: PointerEvent): void => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) * 0.22;
        const dy = (e.clientY - (r.top + r.height / 2)) * 0.32;
        el.style.setProperty('--mk-mx', `${dx.toFixed(1)}px`);
        el.style.setProperty('--mk-my', `${dy.toFixed(1)}px`);
      };
      const onLeave = (): void => {
        el.style.setProperty('--mk-mx', '0px');
        el.style.setProperty('--mk-my', '0px');
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerleave', onLeave);
      cleanups.push(() => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerleave', onLeave);
      });
    }
    const gridBg = must<HTMLElement>(root, '.mk-grid-bg');
    const sticky = must<HTMLElement>(root, '.mk-theatre-sticky');
    const onGrid = (e: PointerEvent): void => {
      const r = gridBg.getBoundingClientRect();
      gridBg.style.setProperty('--mk-gx', `${e.clientX - r.left}px`);
      gridBg.style.setProperty('--mk-gy', `${e.clientY - r.top}px`);
    };
    sticky.addEventListener('pointermove', onGrid);
    cleanups.push(() => sticky.removeEventListener('pointermove', onGrid));
  }

  return {
    destroy: () => {
      chainRun += 1;
      for (const t of timers) clearTimeout(t);
      for (const fn of cleanups) fn();
    },
  };
}
