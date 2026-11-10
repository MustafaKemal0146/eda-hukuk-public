// @tk TK-33
// Sohbet <-> stüdyo köprüsü, seçili kısım hedefi: hedef bölüm kimliği + metin + sıra ile saklanır;
// "Belgeye uygula" yalnız o aralığı yazar, kalan belge dokunulmaz, önce sürüm alınır; seçili metin
// kaybolduysa hata ve belge değişmez. Belge hedefi eski davranışı korur.
import { parseDocJson } from '@eda/editor/schema';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/tr.json';

type Call = { name: string; args: unknown[] };
const calls: Call[] = [];
let draftRev = 3;
let draft: unknown = null;

vi.mock('../src/features/studio/documents-api.ts', () => ({
  ApiClientError: class extends Error {},
  authRedirectFor: () => null,
  documentsApi: {
    documents: {
      get: async (id: string) => {
        calls.push({ name: 'get', args: [id] });
        return { id, draftRev, draft };
      },
      createVersion: async (id: string, input: unknown) => {
        calls.push({ name: 'createVersion', args: [id, input] });
        return {};
      },
      saveDraft: async (id: string, input: unknown) => {
        calls.push({ name: 'saveDraft', args: [id, input] });
        return { draftRev: draftRev + 1, blockRevs: {} };
      },
    },
  },
}));

const { applyToDocument, parseEditTarget, SelectionNotFoundError } = await import(
  '../src/features/studio/chat-bridge.ts'
);
const { applySelectionEdit, selectionTargetOf } = await import(
  '../src/features/studio/selection-target.ts'
);
const { SelectionBalloon } = await import('../src/features/studio/selection-balloon.tsx');

const text = (t: string) => ({ type: 'text', text: t });
const para = (...c: unknown[]) => ({ type: 'paragraph', content: c });
const section = (id: string, role: string, ...content: unknown[]) => ({
  type: 'section',
  attrs: { blockId: id, rev: 1, role },
  content,
});
const bold = (t: string) => ({ ...text(t), marks: [{ type: 'bold' }] });
const DOC = {
  type: 'doc',
  content: [
    section('b-AAAAAA', 'subjectLine', para(text('Konu: tahliye istemi'))),
    section(
      'b-BBBBBB',
      'numberedExplanations',
      para(text('Kiracı kira bedelini ödememiştir. '), bold('Kira bedeli')),
      para(text('Kira bedeli ikinci kez geçiyor.')),
    ),
    section('b-CCCCCC', 'resultAndRequest', para(text('Sonuç ve istem.'))),
  ],
};

const pm = (json: unknown) => {
  const r = parseDocJson(json);
  if (!r.doc) throw new Error(r.issues.map((i) => i.code).join(','));
  return r.doc;
};
const sectionTexts = (json: unknown) =>
  (json as { content: { content: unknown[] }[] }).content.map(
    (s) => pm({ type: 'doc', content: [s] }).textContent,
  );

beforeEach(() => {
  calls.length = 0;
  draftRev = 3;
  draft = structuredClone(DOC);
});

describe('KK-STUDYO-B: seçim hedefi modeli', () => {
  it('hedef bölüm kimliği, metin ve bölüm içi sıra ile tanımlanır; bölüm dışına taşan seçim yok', () => {
    const doc = pm(DOC);
    // İkinci bölümdeki ikinci "Kira bedeli" geçişi (ikinci paragraf başı).
    const second = doc.textContent.indexOf('Kira bedeli ikinci');
    let from = -1;
    doc.descendants((n, pos) => {
      if (n.isText && n.text?.startsWith('Kira bedeli ikinci')) from = pos;
    });
    expect(from).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(0);
    const target = selectionTargetOf(doc, from, from + 'Kira bedeli'.length);
    expect(target).toEqual({
      blockId: 'b-BBBBBB',
      text: 'Kira bedeli',
      occurrence: 1,
      whole: false,
    });
    expect(selectionTargetOf(doc, 1, doc.content.size - 1)).toBeNull();
    expect(selectionTargetOf(doc, 5, 5)).toBeNull();
  });

  it('tam blok seçimi blok olarak, kısmi seçim satır içi yazılır; kalan belge dokunulmaz', () => {
    const doc = pm(DOC);
    let p2 = -1;
    doc.descendants((n, pos) => {
      if (n.isTextblock && n.textContent.startsWith('Kira bedeli ikinci')) p2 = pos;
    });
    const whole = selectionTargetOf(doc, p2 + 1, p2 + 1 + 'Kira bedeli ikinci kez geçiyor.'.length);
    expect(whole?.whole).toBe(true);
    if (!whole) throw new Error('hedef yok');
    const next = applySelectionEdit(doc, whole, '# Yeni başlık\n\nYeni paragraf.');
    const json = next.toJSON() as { content: { content: { type: string }[] }[] };
    expect(json.content[1]?.content.map((b) => b.type)).toEqual([
      'paragraph',
      'heading',
      'paragraph',
    ]);
    expect(sectionTexts(json)[0]).toBe('Konu: tahliye istemi');
    expect(sectionTexts(json)[2]).toBe('Sonuç ve istem.');

    const partial = { blockId: 'b-BBBBBB', text: 'Kira bedeli', occurrence: 0, whole: false };
    const inl = applySelectionEdit(doc, partial, 'kira **borcu**');
    expect(sectionTexts(inl.toJSON())[1]).toBe(
      'Kiracı kira bedelini ödememiştir. kira borcuKira bedeli ikinci kez geçiyor.',
    );
    expect(sectionTexts(inl.toJSON())[0]).toBe('Konu: tahliye istemi');
  });
});

describe('KK-STUDYO-B: applyToDocument', () => {
  it('seçim hedefi: sürüm alınır, yalnız aralık değişir', async () => {
    await applyToDocument(
      {
        kind: 'selection',
        documentId: 'doc-1',
        blockId: 'b-CCCCCC',
        text: 'Sonuç ve istem.',
        occurrence: 0,
        whole: true,
      },
      'Sonuç ve istem: davanın kabulü.',
    );
    expect(calls.map((c) => c.name)).toEqual(['get', 'createVersion', 'saveDraft']);
    expect(calls[1]?.args[1]).toEqual({ name: 'Seçili kısım düzenlemesi öncesi' });
    const saved = calls[2]?.args[1] as { baseVersion: number; draft: unknown };
    expect(saved.baseVersion).toBe(3);
    expect(sectionTexts(saved.draft)).toEqual([
      'Konu: tahliye istemi',
      'Kiracı kira bedelini ödememiştir. Kira bedeliKira bedeli ikinci kez geçiyor.',
      'Sonuç ve istem: davanın kabulü.',
    ]);
  });

  it('seçili metin artık yoksa SelectionNotFoundError; sürüm ve kayıt yapılmaz', async () => {
    await expect(
      applyToDocument(
        {
          kind: 'selection',
          documentId: 'doc-1',
          blockId: 'b-CCCCCC',
          text: 'Silinmiş metin',
          occurrence: 0,
          whole: false,
        },
        'x',
      ),
    ).rejects.toBeInstanceOf(SelectionNotFoundError);
    expect(calls.map((c) => c.name)).toEqual(['get']);
  });

  it('belge hedefi taslağın tamamını değiştirir; ilk taslakta (rev 0) sürüm alınmaz', async () => {
    draftRev = 0;
    await applyToDocument({ kind: 'document', documentId: 'doc-1' }, 'Tam metin');
    expect(calls.map((c) => c.name)).toEqual(['get', 'saveDraft']);
  });

  it('saklanan hedef çözümü: JSON, eski düz kimlik ve bozuk kayıt', () => {
    expect(parseEditTarget('doc-9')).toEqual({ kind: 'document', documentId: 'doc-9' });
    expect(parseEditTarget('{"kind":"document","documentId":"d"}')).toEqual({
      kind: 'document',
      documentId: 'd',
    });
    expect(parseEditTarget('{"kind":"selection","documentId":"d"}')).toBeNull();
    expect(parseEditTarget('{bozuk')).toBeNull();
    expect(parseEditTarget(null)).toBeNull();
  });
});

describe('KK-STUDYO-B: seçim balonu', () => {
  it('erişilebilir düğme ve metin katalogda', () => {
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'tr',
        messages,
        timeZone: 'Europe/Istanbul',
        children: createElement(SelectionBalloon, {
          position: { x: 10, y: 20 },
          label: messages.studio.export.selectionButton,
          onClick: () => {},
        }),
      }),
    );
    expect(html).toContain('<button');
    expect(html).toContain(messages.studio.export.selectionButton);
    expect(messages.studio.export.selectionPrompt).toContain('yalnız bu parçanın');
    expect(messages.chat.document.selectionGone).toBeTruthy();
  });
});
