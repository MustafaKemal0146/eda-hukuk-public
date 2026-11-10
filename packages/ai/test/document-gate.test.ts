// Belge niyeti kapısı (sunucu kuralı): "belge yazma" denince belge hattı açılmaz; açık istek açar.
import { describe, expect, it } from 'vitest';
import { turnFrame } from '../src/prompts/build.ts';
import { MemoryRefStore, type SourceBackend, type ToolContext } from '../src/tools/context.ts';
import { documentGate, newTurnBudget } from '../src/tools/execute.ts';

const backend = {} as SourceBackend;
const ctx = (over: Partial<ToolContext>): ToolContext => ({
  backend,
  refs: new MemoryRefStore(),
  emit: () => {},
  budget: newTurnBudget(),
  turnRefs: new Set(),
  today: '2026-10-11',
  scope: { sources: [], courtTypes: null },
  ...over,
});

describe('documentGate', () => {
  it('belge yasağında üç belge aracı da reddedilir (dilekçe modu açık olsa bile)', () => {
    for (const tool of ['create_document', 'edit_document', 'submit_outline']) {
      expect(documentGate(tool, ctx({ documentIntent: 'forbid' }))).toContain(
        'belge veya taslak istemedi',
      );
      expect(
        documentGate(tool, ctx({ documentIntent: 'forbid', petitionMode: true })),
      ).not.toBeNull();
    }
  });

  it('niyet belirtilmediyse yeni belge başlatılamaz; tek soru istenir', () => {
    const msg = documentGate('create_document', ctx({ documentIntent: 'neutral' }));
    expect(msg).toContain('Belge mi hazırlayayım, yoksa görüş mü istersiniz?');
  });

  it('açık istekte veya dilekçe modunda belge hattı açılır', () => {
    expect(documentGate('create_document', ctx({ documentIntent: 'draft' }))).toBeNull();
    expect(
      documentGate('create_document', ctx({ documentIntent: 'neutral', petitionMode: true })),
    ).toBeNull();
  });

  it('belge dışı araçlar ve niyeti bilinmeyen bağlam etkilenmez', () => {
    expect(documentGate('search_decisions', ctx({ documentIntent: 'forbid' }))).toBeNull();
    expect(documentGate('create_document', ctx({}))).toBeNull();
    expect(documentGate('edit_document', ctx({ documentIntent: 'neutral' }))).toBeNull();
  });
});

describe('tur bağlamındaki belge isteği satırı', () => {
  const base = { modeLabel: 'Müvekkil işi', scopeLabel: 'Tümü', sources: [], userText: 'x' };
  it('her niyet için ilgili satırı yazar; niyet yoksa satır yoktur', () => {
    expect(turnFrame({ ...base, documentIntent: 'forbid' })).toContain('Belge isteği: YOK.');
    expect(turnFrame({ ...base, documentIntent: 'draft' })).toContain('Belge isteği: AÇIK.');
    expect(turnFrame({ ...base, documentIntent: 'neutral' })).toContain(
      'Belge isteği: belirtilmedi.',
    );
    expect(turnFrame(base)).not.toContain('Belge isteği:');
  });
});
