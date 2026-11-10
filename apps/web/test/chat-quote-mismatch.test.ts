// @tk TK-33
// Alıntı uyuşmazlığı çipi (025 §6.4; 052 §6.2): `out_of_context` + `quote_mismatch` atıf mevcut
// `out_of_context` görünümünü (uyarı tonu, simge, düz sınır) alır; etiket "Alıntı kaynakta bulunamadı"
// olur ("Bu sohbette getirilmedi" yazılmaz, kaynak bu sohbette getirildi). Nedensiz `out_of_context`
// eski etiketini korur. Künyeler sentetiktir.
import type { KunyeStatus } from '@eda/contracts/enums';
import type { SourceItem } from '@eda/contracts/stream';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { MessageContent } from '../src/features/chat/message-content.tsx';
import { SourcesList, type SourcesPanelData } from '../src/features/chat/sources-panel.tsx';
import { type CitationReason, useChipLabel } from '../src/features/chat/use-chip-label.ts';

const K1: SourceItem = {
  ref: 'K1',
  kind: 'decision',
  sourceId: 'bedesten:990001',
  shortKunye: 'Örnek HD 2000/1 E.',
  title: 'Örnek karar',
  origin: 'live',
  portal: 'bedesten',
  retrievedAt: '2026-10-16',
  relevance: 'high',
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

function Chip({ status, reason }: { status: KunyeStatus; reason?: CitationReason }) {
  const chip = useChipLabel();
  return createElement(MessageContent, {
    text: 'Kararda "örnek alıntı metni burada yer alır" denilmiştir [K1].',
    streaming: false,
    citations: {
      sources: new Map([['K1', K1]]),
      statuses: new Map([['K1', status]]),
      ...(reason ? { reasons: new Map([['K1', reason]]) } : {}),
      labels: { chip, unresolved: 'Kaynak etiketi çözülemedi' },
    },
  });
}

describe('Alıntı uyuşmazlığı: çip görünümü ve etiketi', () => {
  it('quote_mismatch çipi out_of_context görünümünü alır, etiket "Alıntı kaynakta bulunamadı"', () => {
    const html = render(
      createElement(Chip, { status: 'out_of_context', reason: 'quote_mismatch' }),
    );
    expect(html).toContain('data-status="out_of_context"');
    expect(html).toContain('bg-citation-out-of-context-bg');
    expect(html).toContain('Durum: Alıntı kaynakta bulunamadı.');
    expect(html).not.toContain('Bu sohbette getirilmedi');
    expect(html).not.toMatch(/bedesten/i);
  });

  it('nedensiz out_of_context eski etiketini korur; verified çip değişmez', () => {
    expect(render(createElement(Chip, { status: 'out_of_context' }))).toContain(
      'Durum: Bu sohbette getirilmedi.',
    );
    const ok = render(createElement(Chip, { status: 'verified' }));
    expect(ok).toContain('data-status="verified"');
    expect(ok).toContain('Durum: Doğrulandı.');
  });

  it('kaynak panelinde de aynı etiket görünür', () => {
    const data: SourcesPanelData = {
      sources: [K1],
      statuses: new Map([['K1', 'out_of_context']]),
      reasons: new Map([['K1', 'quote_mismatch']]),
      activeRef: null,
      activeClaim: '',
      claims: new Map(),
      preview: null,
      onPreview: () => undefined,
      focusTick: 0,
    };
    const html = render(createElement(SourcesList, { data }));
    expect(html).toContain('data-status="out_of_context"');
    expect(html).toContain('Durum: Alıntı kaynakta bulunamadı.');
  });
});
