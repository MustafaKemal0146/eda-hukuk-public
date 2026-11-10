// Ürün maketinin davranışı: sohbet demosu (yazma, hazırlık adımları, yanıt akışı, künye doğrulama,
// imleç tıklaması), belge stüdyosu (satırlar dökülür, [K#] künyeye döner) ve takvim (etkinlikler
// düşer). Maket gerçek uygulama bileşenlerinin davranışını izler; veri örnektir. İşaretleme
// sunucuda çizilir (`device-mock.tsx`); burada yalnız sınıf, öznitelik ve metin güncellenir.

import { clamp } from './timeline.ts';
import type { AnswerBlock, AnswerPart, EngineText } from './types.ts';
import { all, must, sleep, typeText } from './util.ts';

/** Takvim etkinliklerinin düşme eşikleri (kaydırma ilerlemesi 0..1; sıra katalogdaki etkinlik sırasıdır). */
const CAL_AT = [0.05, 0.16, 0.3, 0.42, 0.5] as const;
const CAL_DEADLINE = 2;

export type Mock = {
  /** Sahneyi değiştirir (0 sohbet, 1 stüdyo, 2 takvim). */
  setScene: (i: number) => void;
  /** Canlı demoyu baştan oynatır. */
  run: () => Promise<void>;
  /** Demo son durumuyla (hareketsiz) gösterilir. */
  setFinal: () => void;
  /** Demoyu durdurur ve başlangıç durumuna alır. */
  reset: () => void;
  setStudio: (t: number) => void;
  setDeadline: (t: number) => void;
  /** Kenar menüsü öğeleri (sahneye gider). */
  navItems: HTMLElement[];
  /** Mobil kaynak sayfasını kapatır. */
  closeSheet: () => void;
  /** Maket boyutu uyumluluk modunda mı (dar ekran). */
  setCompact: (compact: boolean) => void;
  isCompact: () => boolean;
  stickBottom: () => void;
  destroy: () => void;
};

export function createMock(root: HTMLElement, text: EngineText, opts: { reduced: boolean }): Mock {
  const device = must<HTMLElement>(root, '.device');
  const eda = must<HTMLElement>(device, '.eda');
  const sceneChat = must<HTMLElement>(device, '.scene-chat');
  const homeComposer = must<HTMLElement>(device, '.c-composer-home');
  const homeTyped = must<HTMLElement>(homeComposer, '.c-typed');
  const bottomComposer = must<HTMLElement>(device, '.c-composer-bottom');
  const thread = must<HTMLElement>(device, '.c-thread');
  const pipe = must<HTMLElement>(device, '.c-pipe');
  const pipeLbl = must<HTMLElement>(device, '.c-pipe-head .lbl');
  const pipeMt = must<HTMLElement>(device, '.c-pipe-head .mt');
  const rows = all<HTMLElement>(device, '.c-row');
  const notes = must<HTMLElement>(device, '.c-notes');
  const prose = must<HTMLElement>(device, '.c-prose');
  const acts = must<HTMLElement>(device, '.c-acts');
  const srcBody = must<HTMLElement>(device, '.c-src-body');
  const srcCount = must<HTMLElement>(device, '.c-src-count');
  const srcCards = all<HTMLElement>(device, '.c-sources .c-src');
  const cursor = must<HTMLElement>(device, '.fake-cursor');
  const replayBtn = must<HTMLElement>(root, '.mk-replay');
  const chipTemplate = must<HTMLElement>(device, '[data-chip-template] .e-chip');
  const navItems = all<HTMLElement>(device, '.e-navi[data-go]');
  const recentNew = must<HTMLElement>(device, '.e-recent.new');
  const chromePath = must<HTMLElement>(device, '.chrome-path');
  const progressDots = all<HTMLElement>(root, '.mk-story-progress span');
  const scrim = must<HTMLElement>(device, '.c-scrim');
  const srcClose = must<HTMLElement>(device, '.c-src-head .e-ib');

  let runId = 0;
  const alive = (id: number): boolean => id === runId;

  // ---------------------------------------------------------------- yardımcılar
  const sceneIndex = (): number => Number(device.getAttribute('data-scene') ?? '0');

  function syncNav(): void {
    const sc = sceneIndex();
    const conv = sceneChat.classList.contains('is-conv');
    for (const li of navItems) {
      li.classList.toggle('on', Number(li.getAttribute('data-go')) === sc && !(sc === 0 && conv));
    }
    recentNew.classList.toggle('on', sc === 0 && conv);
    chromePath.textContent =
      sc === 1
        ? '/belgeler/b52f1d07'
        : sc === 2
          ? '/takvim'
          : conv
            ? '/sohbet/7c1e9a42'
            : '/sohbet';
  }

  function setChat(state: 'home' | 'conv'): void {
    const conv = state === 'conv';
    sceneChat.classList.toggle('is-conv', conv);
    eda.classList.toggle('has-conv', conv);
    syncNav();
  }

  function setHead(
    state: string,
    label: string | { strong: string; em: string },
    meta: string,
  ): void {
    pipe.setAttribute('data-state', state);
    pipeLbl.textContent = '';
    if (typeof label === 'string') {
      pipeLbl.textContent = label;
    } else {
      const strong = document.createElement('strong');
      strong.textContent = label.strong;
      const em = document.createElement('em');
      em.textContent = label.em;
      pipeLbl.append(strong, em);
    }
    pipeMt.textContent = meta;
  }

  function setRow(i: number, st: string, tm?: string, extra?: boolean): void {
    const r = rows[i];
    if (!r) return;
    r.hidden = false;
    r.setAttribute('data-st', st);
    const tmEl = r.querySelector<HTMLElement>('.tm');
    if (tmEl) tmEl.textContent = tm ?? '';
    const cap = r.querySelector<HTMLElement>('.cap');
    if (cap) cap.hidden = !extra;
  }

  const chips = (): HTMLElement[] => all<HTMLElement>(prose, '.e-chip');
  const setChips = (status: string): void => {
    for (const c of chips()) c.setAttribute('data-status', status);
  };

  function showSources(animate: boolean): void {
    srcBody.classList.add('has');
    srcCount.textContent = text.sources.found;
    srcCards.forEach((c, i) => {
      c.classList.remove('in');
      if (animate) {
        c.style.animationDelay = `${i * 90}ms`;
        void c.offsetWidth;
        c.classList.add('in');
      }
    });
  }

  function selectSource(k: string): void {
    for (const c of srcCards) c.classList.toggle('on', c.getAttribute('data-ref') === k);
    for (const c of chips()) c.classList.toggle('active', c.getAttribute('data-k') === k);
    const card = srcCards.find((c) => c.getAttribute('data-ref') === k);
    if (device.classList.contains('is-compact')) sceneChat.classList.add('sheet');
    if (card) srcBody.scrollTop = Math.max(0, card.offsetTop - 12);
    const bq = card?.querySelector<HTMLElement>('blockquote');
    const mark = bq?.querySelector<HTMLElement>('mark');
    if (bq && mark) bq.scrollTop = Math.max(0, mark.offsetTop - bq.offsetTop - 8);
  }

  const stickBottom = (): void => {
    thread.scrollTop = thread.scrollHeight;
  };

  function chipEl(k: string): HTMLElement {
    const c = text.chips[k];
    const wrap = document.createElement('span');
    wrap.className = 'e-chipwrap';
    const chip = chipTemplate.cloneNode(true) as HTMLElement;
    chip.setAttribute('data-k', k);
    chip.setAttribute('data-status', 'none');
    const label = chip.querySelector<HTMLElement>('.cl');
    const meta = chip.querySelector<HTMLElement>('.meta');
    if (label) label.textContent = c?.k ?? k;
    if (meta) meta.textContent = `· ${c?.meta ?? ''}`;
    wrap.append(chip);
    return wrap;
  }

  /** Yanıt gövdesi: başlık, paragraf, liste; [K#] etiketleri künye çipine dönüşür. */
  function renderAnswer(animate: boolean, id: number): Promise<void> {
    prose.textContent = '';
    let chain: Promise<void> = Promise.resolve();
    const then = (fn: () => void | Promise<void>): void => {
      chain = chain.then(() => (alive(id) ? fn() : undefined));
    };
    const addText = (parent: HTMLElement, value: string): void => {
      if (!animate) {
        parent.append(document.createTextNode(value));
        return;
      }
      for (const wd of value.split(/(\s+)/)) {
        if (!wd) continue;
        then(() => {
          const s = document.createElement('span');
          s.className = 'w';
          s.textContent = wd;
          parent.append(s);
          stickBottom();
          return /\S/.test(wd) ? sleep(26) : undefined;
        });
      }
    };
    const addParts = (parent: HTMLElement, parts: AnswerPart[]): void => {
      for (const pt of parts) {
        if ('t' in pt) addText(parent, pt.t);
        else if ('b' in pt) {
          const st = document.createElement('strong');
          if (animate) then(() => void parent.append(st));
          else parent.append(st);
          addText(st, pt.b);
        } else {
          const go = (): void => {
            parent.append(chipEl(pt.chip));
            stickBottom();
          };
          if (animate)
            then(() => {
              go();
              return sleep(120);
            });
          else go();
        }
      }
    };
    for (const blk of text.answer as AnswerBlock[]) {
      const el = document.createElement('h3' in blk ? 'h3' : 'p' in blk ? 'p' : 'ul');
      const mount = (): void => void prose.append(el);
      if (animate) then(mount);
      else mount();
      if ('h3' in blk) addText(el, blk.h3);
      else if ('p' in blk) addParts(el, blk.p);
      else if ('ul' in blk) {
        for (const item of blk.ul) {
          const li = document.createElement('li');
          if (animate) then(() => void el.append(li));
          else el.append(li);
          addParts(li, item);
        }
      }
    }
    return chain;
  }

  function moveCursorTo(target: HTMLElement): void {
    const base = sceneChat.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const k = base.width / sceneChat.offsetWidth || 1;
    cursor.style.left = `${(r.left - base.left) / k + Math.min(28, r.width / k / 2)}px`;
    cursor.style.top = `${(r.top - base.top) / k + r.height / k / 2}px`;
  }

  function resetDemo(): void {
    setChat('home');
    sceneChat.classList.remove('sheet');
    homeTyped.textContent = '';
    homeComposer.classList.remove('focus', 'ready');
    bottomComposer.classList.remove('busy');
    for (const r of rows) {
      r.hidden = true;
      r.setAttribute('data-st', 'run');
      const tm = r.querySelector<HTMLElement>('.tm');
      if (tm) tm.textContent = '';
      const cap = r.querySelector<HTMLElement>('.cap');
      if (cap) cap.hidden = true;
    }
    pipe.classList.add('open');
    setHead('run', text.pipe.title, text.pipe.meta0);
    notes.hidden = true;
    notes.classList.remove('as-notes');
    prose.textContent = '';
    acts.hidden = true;
    srcBody.classList.remove('has');
    srcCount.textContent = text.sources.none;
    for (const c of srcCards) c.classList.remove('on', 'in');
    cursor.classList.remove('show', 'click');
    replayBtn.classList.remove('show');
    thread.scrollTop = 0;
  }

  function setFinal(): void {
    runId += 1;
    resetDemo();
    setChat('conv');
    text.pipe.times.forEach((tm, i) => {
      setRow(i, 'done', tm, i === 0);
    });
    pipe.classList.remove('open');
    setHead('done', text.pipe.done, text.pipe.meta[5] ?? '');
    notes.hidden = false;
    notes.classList.add('as-notes');
    void renderAnswer(false, runId);
    setChips('verified');
    acts.hidden = false;
    showSources(false);
    if (!device.classList.contains('is-compact')) selectSource('K1');
    for (const c of srcCards) c.classList.toggle('on', c.getAttribute('data-ref') === 'K1');
    requestAnimationFrame(() => {
      thread.scrollTop = thread.scrollHeight;
    });
  }

  async function run(): Promise<void> {
    runId += 1;
    const id = runId;
    resetDemo();
    const P = text.pipe;
    const step = async (ms: number): Promise<boolean> => {
      await sleep(ms);
      return alive(id);
    };
    if (!(await step(500))) return;
    homeComposer.classList.add('focus');
    if (!(await step(450))) return;
    await typeText(homeTyped, text.question, 30, () => alive(id));
    if (!alive(id)) return;
    homeComposer.classList.add('ready');
    if (!(await step(500))) return;
    homeComposer.classList.remove('focus', 'ready');
    setChat('conv');
    bottomComposer.classList.add('busy');
    if (!(await step(450))) return;
    notes.hidden = false;
    setRow(0, 'run');
    setRow(1, 'run');
    setHead('run', { strong: P.parallel, em: P.parallelRest }, P.meta[0] ?? '');
    if (!(await step(900))) return;
    setRow(1, 'done', P.times[1]);
    setHead('run', P.rows[0] ?? '', P.meta[1] ?? '');
    if (!(await step(800))) return;
    setRow(0, 'done', P.times[0], true);
    showSources(true);
    if (!(await step(350))) return;
    setRow(2, 'run');
    setHead('run', P.rows[2] ?? '', P.meta[2] ?? '');
    stickBottom();
    if (!(await step(1100))) return;
    setRow(2, 'done');
    setRow(3, 'run');
    setHead('run', P.rows[3] ?? '', P.meta[3] ?? '');
    notes.classList.add('as-notes');
    stickBottom();
    if (!(await step(300))) return;
    await renderAnswer(true, id);
    if (!alive(id)) return;
    setRow(3, 'done', P.times[3]);
    setRow(4, 'run');
    setHead('run', P.rows[4] ?? '', P.meta[4] ?? '');
    setChips('pending');
    stickBottom();
    if (!(await step(1000))) return;
    prose.querySelector('.e-chip[data-k="K4"]')?.setAttribute('data-status', 'verified');
    if (!(await step(260))) return;
    prose.querySelector('.e-chip[data-k="K1"]')?.setAttribute('data-status', 'verified');
    if (!(await step(300))) return;
    setRow(4, 'done');
    setHead('done', P.done, P.meta[5] ?? '');
    pipe.classList.remove('open');
    acts.hidden = false;
    bottomComposer.classList.remove('busy');
    stickBottom();
    if (!(await step(800))) return;
    const chip = prose.querySelector<HTMLElement>('.e-chip[data-k="K1"]');
    if (chip) {
      const send = must<HTMLElement>(device, '.c-composer-bottom .c-send');
      moveCursorTo(send);
      cursor.classList.add('show');
      await sleep(80);
      moveCursorTo(chip);
      if (!(await step(1000))) return;
      cursor.classList.add('click');
      chip.classList.add('press');
      await sleep(160);
      cursor.classList.remove('click');
      chip.classList.remove('press');
      selectSource('K1');
      await sleep(900);
      cursor.classList.remove('show');
    }
    replayBtn.classList.add('show');
  }

  // ---------------------------------------------------------------- olaylar
  const onProseClick = (e: Event): void => {
    const chip = (e.target as Element | null)?.closest<HTMLElement>('.e-chip');
    const k = chip?.getAttribute('data-k');
    if (k) selectSource(k);
  };
  const closeSheet = (): void => sceneChat.classList.remove('sheet');
  const onReplay = (): void => {
    if (opts.reduced) setFinal();
    else void run();
  };
  prose.addEventListener('click', onProseClick);
  scrim.addEventListener('click', closeSheet);
  srcClose.addEventListener('click', closeSheet);
  replayBtn.addEventListener('click', onReplay);

  // ---------------------------------------------------------------- belge stüdyosu
  const paperLines = all<HTMLElement>(device, '.s-paper .ln');
  const lineWords = paperLines.map(
    (l) => ((l.textContent ?? '').replace(/\[K\d\]/g, '').match(/\S+/g) ?? []).length,
  );
  const lineFills = paperLines.map(
    (l) => ((l.textContent ?? '').match(/\[\[Doldurulacak/g) ?? []).length,
  );
  const refs = all<HTMLElement>(device, '.s-paper .ref');
  const sSave = must<HTMLElement>(device, '.s-save');
  const sWords = must<HTMLElement>(device, '.s-words');
  const sFill = must<HTMLElement>(device, '.s-fill');
  const studioDone: Record<number, boolean> = {};
  const flashTimers: ReturnType<typeof setTimeout>[] = [];

  function setStudio(t: number): void {
    const shown = Math.round(clamp(t / 0.6, 0, 1) * paperLines.length);
    let words = 0;
    let fills = 0;
    paperLines.forEach((l, i) => {
      l.classList.toggle('hid', i >= shown);
      if (i < shown) {
        words += lineWords[i] ?? 0;
        fills += lineFills[i] ?? 0;
      }
    });
    refs.forEach((r, i) => {
      const on = t > 0.66 + i * 0.06;
      if (on && !r.classList.contains('done')) {
        r.classList.add('done');
        if (!studioDone[i] && !opts.reduced) {
          studioDone[i] = true;
          r.classList.add('flash');
          flashTimers.push(setTimeout(() => r.classList.remove('flash'), 900));
        }
      } else if (!on) {
        r.classList.remove('done');
        studioDone[i] = false;
      }
    });
    sWords.textContent = text.studio.words.replace('{count}', String(words));
    sFill.textContent = text.studio.fills.replace('{count}', String(fills));
    sSave.textContent = t > 0.02 && t < 0.86 ? text.studio.unsaved : text.studio.saved;
  }

  // ---------------------------------------------------------------- takvim
  const calEvents = all<HTMLElement>(device, '.k-ev');
  const tdToday = must<HTMLElement>(device, '.k-table td.today');
  const tdDeadline = must<HTMLElement>(device, '.k-table td[data-d="16"]');
  const sumCap = must<HTMLElement>(device, '.k-sum-cap');
  const sumDay = must<HTMLElement>(device, '.k-sum-day');
  const sumEmpty = must<HTMLElement>(device, '.k-sum-empty');
  const sumRows = must<HTMLElement>(device, '.k-sum-rows');
  const critEmpty = must<HTMLElement>(device, '.crit-empty');
  const crit = must<HTMLElement>(device, '.crit');

  function setDeadline(t: number): void {
    for (const el of calEvents) {
      const at = CAL_AT[Number(el.getAttribute('data-e'))] ?? 0;
      el.classList.toggle('hid', t < at);
    }
    const sel16 = t > 0.6;
    tdToday.classList.toggle('sel', !sel16);
    tdDeadline.classList.toggle('sel', sel16);
    sumCap.textContent = sel16 ? text.cal.sumCapSel : text.cal.sumCap;
    sumDay.textContent = sel16 ? text.cal.sumDaySel : text.cal.sumDay;
    sumEmpty.hidden = sel16;
    sumRows.hidden = !sel16;
    const hasCrit = t >= (CAL_AT[CAL_DEADLINE] ?? 0);
    crit.hidden = !hasCrit;
    critEmpty.hidden = hasCrit;
  }

  // ---------------------------------------------------------------- sahne
  let current = -1;
  function setScene(i: number): void {
    if (i === current) return;
    current = i;
    device.setAttribute('data-scene', String(i));
    syncNav();
    for (const s of progressDots) s.classList.toggle('on', Number(s.getAttribute('data-p')) === i);
  }

  return {
    setScene,
    run,
    setFinal,
    reset: () => {
      runId += 1;
      resetDemo();
    },
    setStudio,
    setDeadline,
    navItems,
    closeSheet,
    setCompact: (compact) => device.classList.toggle('is-compact', compact),
    isCompact: () => device.classList.contains('is-compact'),
    stickBottom,
    destroy: () => {
      runId += 1;
      prose.removeEventListener('click', onProseClick);
      scrim.removeEventListener('click', closeSheet);
      srcClose.removeEventListener('click', closeSheet);
      replayBtn.removeEventListener('click', onReplay);
      for (const t of flashTimers) clearTimeout(t);
    },
  };
}
