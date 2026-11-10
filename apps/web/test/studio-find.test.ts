// @tk TK-33
// Stüdyo bul/değiştir: Türkçe katlamalı eşleşme (tr_fold; toLowerCase yok), blok sınırı, doldurulacak
// alan sayacı ve sıradaki alana atlama, tek işlemde tümünü değiştir; panelin erişilebilir adları.
import { parseDocJson } from '@eda/editor/schema';
import { EditorState } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { FindPanel } from '../src/features/studio/find-panel.tsx';
import {
  findMatches,
  findPlaceholders,
  flattenText,
  nextRangeAfter,
  prevRangeBefore,
  replaceAll,
} from '../src/features/studio/find-replace.ts';

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const section = (id: string, ...content: unknown[]) => ({
  type: 'section',
  attrs: { blockId: id, rev: 0, role: 'generic' },
  content,
});

function docOf(...paragraphs: string[]) {
  const parsed = parseDocJson({
    type: 'doc',
    content: paragraphs.map((p, i) => section(`b-TEST0${i}`, para(p))),
  });
  if (!parsed.doc) throw new Error(parsed.issues.map((i) => i.code).join(','));
  return parsed.doc;
}

/** Görünümsüz sahte editör: `state` ve `view.dispatch` yeterlidir. */
function fakeEditor(doc: ReturnType<typeof docOf>) {
  let state = EditorState.create({ doc });
  const editor = {
    get state() {
      return state;
    },
    isEditable: true,
    view: {
      dispatch(tr: Parameters<EditorState['apply']>[0]) {
        state = state.apply(tr);
      },
    },
  };
  return { editor: editor as unknown as Editor, text: () => state.doc.textContent };
}

describe('KK-STUDYO-E: bul', () => {
  it('Türkçe büyük/küçük harf ve aksan duyarsız eşleşir; konumlar belge metnine denk gelir', () => {
    const doc = docOf('SONUÇ VE İSTEM: davanın kabulü', 'Istem yineleniyor.');
    const m = findMatches(doc, 'istem');
    expect(m).toHaveLength(2);
    const first = m[0];
    const second = m[1];
    if (!first || !second) throw new Error('eşleşme yok');
    expect(doc.textBetween(first.from, first.to)).toBe('İSTEM');
    expect(doc.textBetween(second.from, second.to)).toBe('Istem');
    expect(findMatches(doc, 'kabulu')).toHaveLength(1);
  });

  it('blok sınırını aşan eşleşme alınmaz; boş sorgu eşleşmez', () => {
    const doc = docOf('birinci satır', 'ikinci satır');
    expect(findMatches(doc, 'satır ikinci')).toHaveLength(0);
    expect(findMatches(doc, '   ')).toHaveLength(0);
    expect(flattenText(doc).text).toBe('birinci satır\nikinci satır');
  });

  it('ileri/geri gezinme sarar', () => {
    const ranges = [
      { from: 2, to: 4 },
      { from: 10, to: 12 },
    ];
    expect(nextRangeAfter(ranges, 2)).toEqual({ from: 10, to: 12 });
    expect(nextRangeAfter(ranges, 10)).toEqual({ from: 2, to: 4 });
    expect(prevRangeBefore(ranges, 10)).toEqual({ from: 2, to: 4 });
    expect(prevRangeBefore(ranges, 2)).toEqual({ from: 10, to: 12 });
    expect(nextRangeAfter([], 0)).toBeNull();
  });
});

describe('KK-STUDYO-E: değiştir ve doldurulacak alanlar', () => {
  it('tümünü değiştir tek işlemde, konumlar kaymadan', () => {
    const doc = docOf('ad ad ad', 'adres');
    const { editor, text } = fakeEditor(doc);
    const n = replaceAll(editor, findMatches(doc, 'ad'), 'soyad');
    expect(n).toBe(4);
    expect(text()).toBe('soyad soyad soyadsoyadres');
  });

  it('[[...]] işaretleri sayılır ve imleçten sonraki ilk alana atlanır', () => {
    const doc = docOf('Davacı [[Doldurulacak: ad]] ve [[Doldurulacak: adres]]', 'Düz metin');
    const ph = findPlaceholders(doc);
    expect(ph).toHaveLength(2);
    const a = ph[0];
    if (!a) throw new Error('alan yok');
    expect(doc.textBetween(a.from, a.to)).toBe('[[Doldurulacak: ad]]');
    expect(nextRangeAfter(ph, a.from)).toEqual(ph[1]);
    expect(nextRangeAfter(ph, 9999)).toEqual(ph[0]);
  });
});

describe('KK-STUDYO-E: FindPanel', () => {
  const model = {
    query: 'istem',
    replacement: '',
    matches: [
      { from: 1, to: 3 },
      { from: 5, to: 7 },
    ],
    current: 1,
    setQuery: () => {},
    setReplacement: () => {},
    next: () => {},
    prev: () => {},
    replace: () => {},
    replaceAllMatches: () => {},
  };
  const render = (editable: boolean) =>
    renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'tr',
        messages,
        timeZone: 'Europe/Istanbul',
        children: createElement(FindPanel, { model, editable, onClose: () => {} }),
      }),
    );

  it('eşleşme sayısı, erişilebilir adlar ve düğmeler çizilir', () => {
    const html = render(true);
    expect(html).toContain('2 / 2');
    expect(html).toContain(`aria-label="${messages.studio.find.query}"`);
    expect(html).toContain(`aria-label="${messages.studio.find.replacement}"`);
    expect(html).toContain(`aria-label="${messages.studio.find.next}"`);
    expect(html).toContain(`aria-label="${messages.studio.find.prev}"`);
    expect(html).toContain(messages.studio.find.replaceAll);
  });

  it('salt-okur belgede değiştirme denetimleri kapalıdır', () => {
    const disabledCount = (html: string) => html.split('disabled=""').length - 1;
    // Düzenlenebilir: yalnız hiçbiri kapalı değil (eşleşme var); salt-okur: yerine kutusu + iki düğme.
    expect(disabledCount(render(true))).toBe(0);
    expect(disabledCount(render(false))).toBe(3);
  });
});
