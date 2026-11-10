// @tk TK-33
// Kaynak paneli ve `[K#]` çipi: her kaynağın yanında portal adı ve erişim tarihi (052 §6.3). Tarih
// `fetchedAt` (ISO an) Europe/Istanbul gününe çevrilir; yoksa kaynağın `retrievedAt` günü yazılır;
// ikisi de yoksa tarih uydurulmaz. Portal adı yalnız katalogdan gelir; iç kod anahtarı görünmez.
// Veriler sentetiktir.
import type { SourceItem } from '@eda/contracts/stream';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { MessageContent } from '../src/features/chat/message-content.tsx';
import { accessDateOf } from '../src/features/chat/source-meta.ts';
import { SourcesList, type SourcesPanelData } from '../src/features/chat/sources-panel.tsx';
import { useChipLabel, useChipMeta } from '../src/features/chat/use-chip-label.ts';

const K1: SourceItem = {
  ref: 'K1',
  kind: 'decision',
  sourceId: 'bedesten:990001',
  shortKunye: 'Örnek HD 2000/1 E.',
  title: 'Örnek karar',
  origin: 'live',
  portal: 'bedesten',
  retrievedAt: '2026-10-16',
  // UTC 22:30 = İstanbul 01:30 ertesi gün: tarih 17.10.2026 olmalı (UTC günü 16 değil).
  fetchedAt: '2026-10-16T22:30:00.000Z',
  relevance: 'high',
};
const K2: SourceItem = {
  ref: 'K2',
  kind: 'legislation',
  sourceId: 'mevzuat:6098:m352',
  shortKunye: 'TBK m. 352',
  title: 'Örnek madde',
  origin: 'live',
  portal: 'mevzuat',
  retrievedAt: '2026-10-10',
  relevance: 'medium',
};

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'tr',
      messages,
      timeZone: 'Europe/Istanbul',
      children: node,
    }),
  );
}

function panelData(sources: SourceItem[]): SourcesPanelData {
  return {
    sources,
    statuses: new Map([['K1', 'verified']]),
    activeRef: null,
    activeClaim: '',
    claims: new Map(),
    preview: null,
    onPreview: () => undefined,
    focusTick: 0,
  };
}

describe('Kaynak paneli: portal adı ve erişim tarihi', () => {
  it('fetchedAt Europe/Istanbul gününe çevrilir; portal görünen adıyla yazılır', () => {
    const html = render(createElement(SourcesList, { data: panelData([K1]) }));
    expect(html).toContain('UYAP · erişim 17.10.2026 · Alaka: yüksek');
    expect(html).not.toMatch(/Bedesten/i);
    // Erişilebilir çip adı da aynı bilgiyi taşır.
    expect(html).toContain(
      'Kaynak: Örnek HD 2000/1 E (UYAP, erişim 17.10.2026). Durum: Doğrulandı.',
    );
  });

  it('fetchedAt yoksa kaynağın bildirdiği retrievedAt günü yazılır', () => {
    const html = render(createElement(SourcesList, { data: panelData([K2]) }));
    expect(html).toContain('Mevzuat Bilgi Sistemi · erişim 10.10.2026 · Alaka: orta');
  });

  it('tarih yoksa uydurulmaz: yalnız portal ve alaka', () => {
    const noDate = { ...K2, retrievedAt: '' } as SourceItem;
    const html = render(createElement(SourcesList, { data: panelData([noDate]) }));
    expect(html).toContain('Mevzuat Bilgi Sistemi · Alaka: orta');
    expect(html).not.toContain('erişim');
  });

  it('accessDateOf: geçersiz fetchedAt retrievedAt gününe düşer', () => {
    expect(accessDateOf({ retrievedAt: '2026-10-10', fetchedAt: 'bozuk' })).toBe('10.10.2026');
    expect(
      accessDateOf({ retrievedAt: '2026-10-16', fetchedAt: '2026-10-16T22:30:00+00:00' }),
    ).toBe('17.10.2026');
    expect(accessDateOf({ retrievedAt: '' })).toBeNull();
  });
});

function ChipHarness({ text, sources }: { text: string; sources: SourceItem[] }) {
  const chip = useChipLabel();
  const meta = useChipMeta();
  return createElement(MessageContent, {
    text,
    streaming: false,
    citations: {
      sources: new Map(sources.map((s) => [s.ref, s])),
      statuses: new Map([['K1', 'verified' as const]]),
      labels: { chip, meta, unresolved: 'Kaynak etiketi çözülemedi' },
    },
  });
}

describe('[K#] çipi: portal adı ve erişim tarihi', () => {
  it('çipte künye yanında portal ve erişim tarihi görünür; erişilebilir ad aynı bilgiyi taşır', () => {
    const html = render(
      createElement(ChipHarness, { text: 'Yanıt [K1] ve [K2].', sources: [K1, K2] }),
    );
    expect(html).toContain('· UYAP, erişim 17.10.2026');
    expect(html).toContain('· Mevzuat Bilgi Sistemi, erişim 10.10.2026');
    expect(html).toContain(
      'Kaynak: Örnek HD 2000/1 E (UYAP, erişim 17.10.2026). Durum: Doğrulandı.',
    );
    expect(html).toContain('Kaynak: TBK m. 352 (Mevzuat Bilgi Sistemi, erişim 10.10.2026)');
    expect(html).not.toMatch(/bedesten/i);
  });
});
