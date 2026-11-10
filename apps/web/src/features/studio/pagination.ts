// Sayfa görünümü (A4): editör içeriği sürekli akar; bu eklenti her bloğun konumunu ölçer ve sayfa
// sonuna sığmayan bloğun önüne, sonraki sayfanın üst boşluğuna kadar uzanan bir aralık (widget
// dekorasyonu) koyar. Aralıklar belgeye yazılmaz: kayıt, geri alma ve dışa aktarma etkilenmez.
// Ölçüler mm cinsindendir; CSS `zoom` ve yakınlaştırma sonuçları değiştirmez (ölçü, aynı öğeden
// alınan 100 mm'lik bir sonda ile orantılanır). Sayfa/boşluk değerleri `paper.css` ile aynı kaynaktan
// (CSS değişkenleri) okunur. Kâğıt `data-paged` ve `--eda-pages` ile boyanır.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

const KEY = new PluginKey<DecorationSet>('edaPagination');
const BREAK_CLASS = 'eda-page-break';
const EPS_MM = 0.3;

type Spacer = { pos: number; mm: number };

type Geometry = { pageMm: number; contentMm: number; strideMm: number; pxPerMm: number };

/** CSS değişkenlerini mm'ye çevirmek için gizli sonda öğeleri; ölçü birimi aynı yolla alınır. */
function geometryOf(paper: HTMLElement): Geometry | null {
  const probes = [
    '100mm',
    'var(--eda-paper-min-height)',
    'var(--eda-paper-margin-top)',
    'var(--eda-paper-margin-bottom)',
    'var(--eda-page-gap)',
  ];
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:0;';
  for (const h of probes) {
    const d = document.createElement('div');
    d.style.height = h;
    host.append(d);
  }
  paper.append(host);
  const [ref, page, top, bottom, gap] = Array.from(host.children).map(
    (c) => c.getBoundingClientRect().height,
  );
  host.remove();
  if (!ref || ref <= 0 || !page) return null;
  const pxPerMm = ref / 100;
  const pageMm = page / pxPerMm;
  const contentMm = pageMm - (top ?? 0) / pxPerMm - (bottom ?? 0) / pxPerMm;
  const gapMm = (gap ?? 0) / pxPerMm;
  if (contentMm <= 20) return null;
  return { pageMm, contentMm, strideMm: pageMm + gapMm, pxPerMm };
}

function planSpacers(view: EditorView, geo: Geometry): { spacers: Spacer[]; pages: number } {
  const root = view.dom;
  const spacers: Spacer[] = [];
  // Ölçüm aralıklar gizliyken yapılır: doğal konumlar, önceki aralıklardan bağımsızdır.
  const hidden = Array.from(root.querySelectorAll<HTMLElement>(`.${BREAK_CLASS}`));
  for (const el of hidden) el.style.display = 'none';
  const origin = root.getBoundingClientRect().top;
  const items: { pos: number; top: number; bottom: number; heading: boolean }[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.isTextblock || node.type.name === 'table') {
      const dom = view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        const r = dom.getBoundingClientRect();
        items.push({
          pos,
          top: (r.top - origin) / geo.pxPerMm,
          bottom: (r.bottom - origin) / geo.pxPerMm,
          heading: node.type.name === 'heading',
        });
      }
      return false;
    }
    return true;
  });
  for (const el of hidden) el.style.display = '';

  let shift = 0;
  let lastBottom = 0;
  items.forEach((it, i) => {
    let top = it.top + shift;
    const height = it.bottom - it.top;
    let page = Math.floor((top + EPS_MM) / geo.strideMm);
    let limit = page * geo.strideMm + geo.contentMm;
    const next = items[i + 1];
    // Başlık, sonraki bloğun ilk satırıyla birlikte kalır.
    const reach =
      it.heading && next ? next.top + shift + Math.min(next.bottom - next.top, 12) : top + height;
    const overflows = Math.max(top + height, reach) > limit + EPS_MM;
    const inMargin = top >= limit - EPS_MM;
    if ((overflows || inMargin) && height <= geo.contentMm) {
      const add = (page + 1) * geo.strideMm - top;
      if (add > EPS_MM) {
        spacers.push({ pos: it.pos, mm: add });
        shift += add;
        top += add;
        page += 1;
        limit = page * geo.strideMm + geo.contentMm;
      }
    }
    lastBottom = it.bottom + shift;
  });
  return { spacers, pages: Math.max(1, Math.floor((lastBottom + EPS_MM) / geo.strideMm) + 1) };
}

/** Sayfa yüzeyi öğeleri (kâğıdın doğrudan çocukları; ProseMirror'ın dışında). */
function syncSheets(paper: HTMLElement, pages: number): void {
  const sheets = paper.querySelectorAll(':scope > .eda-page-sheet');
  for (let i = sheets.length; i < pages; i++) {
    const el = document.createElement('div');
    el.className = 'eda-page-sheet';
    el.setAttribute('aria-hidden', 'true');
    el.style.setProperty('--eda-page', String(i));
    paper.prepend(el);
  }
  for (let i = sheets.length - 1; i >= pages; i--) sheets[i]?.remove();
}

function sameSpacers(set: DecorationSet, next: Spacer[]): boolean {
  const cur = set.find();
  if (cur.length !== next.length) return false;
  return cur.every((d, i) => {
    const n = next[i];
    const mm = (d.spec as { mm?: number }).mm;
    return n !== undefined && n.pos === d.from && mm !== undefined && Math.abs(mm - n.mm) < 0.2;
  });
}

function spacerWidget(s: Spacer): Decoration {
  return Decoration.widget(
    s.pos,
    () => {
      const el = document.createElement('div');
      el.className = BREAK_CLASS;
      el.setAttribute('aria-hidden', 'true');
      el.contentEditable = 'false';
      el.style.height = `${s.mm.toFixed(2)}mm`;
      return el;
    },
    { side: -1, mm: s.mm, ignoreSelection: true, key: `pb-${s.pos}-${s.mm.toFixed(1)}` },
  );
}

export type PaginationOptions = {
  /** Sayfa sayısı değişince çağrılır (durum satırı). */
  onPages: ((pages: number) => void) | null;
};

export const Pagination = Extension.create<PaginationOptions>({
  name: 'edaPagination',
  addOptions() {
    return { onPages: null };
  },
  addProseMirrorPlugins() {
    const { onPages } = this.options;
    let lastPages = 0;
    return [
      new Plugin<DecorationSet>({
        key: KEY,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(KEY) as DecorationSet | undefined;
            return meta ?? set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => KEY.getState(state) ?? DecorationSet.empty,
        },
        view(view) {
          let frame = 0;
          let destroyed = false;
          const run = () => {
            frame = 0;
            if (destroyed) return;
            const paper = view.dom.closest<HTMLElement>('.eda-paper');
            if (!paper) return;
            paper.setAttribute('data-paged', '');
            const geo = geometryOf(paper);
            if (!geo) return;
            const { spacers, pages } = planSpacers(view, geo);
            paper.style.setProperty('--eda-pages', String(pages));
            syncSheets(paper, pages);
            if (pages !== lastPages) {
              lastPages = pages;
              onPages?.(pages);
            }
            const current = KEY.getState(view.state) ?? DecorationSet.empty;
            if (sameSpacers(current, spacers)) return;
            const set = DecorationSet.create(view.state.doc, spacers.map(spacerWidget));
            view.dispatch(view.state.tr.setMeta(KEY, set).setMeta('addToHistory', false));
          };
          const schedule = () => {
            if (frame === 0 && !destroyed) frame = requestAnimationFrame(run);
          };
          schedule();
          void document.fonts?.ready.then(schedule);
          window.addEventListener('resize', schedule);
          return {
            update: schedule,
            destroy() {
              destroyed = true;
              if (frame !== 0) cancelAnimationFrame(frame);
              for (const el of view.dom
                .closest('.eda-paper')
                ?.querySelectorAll(':scope > .eda-page-sheet') ?? []) {
                el.remove();
              }
              window.removeEventListener('resize', schedule);
            },
          };
        },
      }),
    ];
  },
});
