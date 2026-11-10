// @tk TK-33
// KK-P10-10 (KK-053-02-12/13 alt kümesi): ajan hattı durumu yalnız gelen geçici olaylardan kurulur;
// paralel araç çağrıları `callId` ile ayrı satırdır; tur kapanınca hiçbir satır çalışıyor kalmaz ve
// kapanış etiketi ("Yanıt tamamlandı") satır adı olmaz. Görünüm: üst satır, özet, adım/süre.
import type { PipelineData } from '@eda/contracts/stream';
import { Announcer } from '@eda/ui';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { formatSeconds, PipelineBar } from '../src/features/chat/pipeline-bar.tsx';
import {
  applyPipelineEvent,
  type PipelineState,
  pipelineView,
  settlePipeline,
  startPipeline,
} from '../src/features/chat/pipeline-store.ts';

const T0 = 1_000_000;
// Sentetik künye (gerçek karar değildir; yalnız biçim).
const KUNYE = 'Örnek Daire, E. 2000/1 K. 2000/2 T. 01.01.2000';

/** Olay dizisi: [ms, olay]. */
function run(events: readonly [number, PipelineData][], start = T0): PipelineState {
  let s = startPipeline(start);
  for (const [at, ev] of events) s = applyPipelineEvent(s, ev, at);
  return s;
}

const TURN: readonly [number, PipelineData][] = [
  [T0 + 10, { stage: 'masking', status: 'done', label: 'Kişisel veriler maskelendi' }],
  [
    T0 + 100,
    {
      stage: 'tool',
      status: 'started',
      label: 'Emsal kararlar aranıyor',
      toolName: 'search_decisions',
      callId: 'c1',
    },
  ],
  [
    T0 + 120,
    {
      stage: 'tool',
      status: 'started',
      label: 'Madde metni getiriliyor',
      toolName: 'get_legislation_article',
      callId: 'c2',
    },
  ],
];

const REST: readonly [number, PipelineData][] = [
  [
    T0 + 900,
    {
      stage: 'tool',
      status: 'done',
      label: 'Emsal kararlar aranıyor',
      toolName: 'search_decisions',
      callId: 'c1',
      detail: '3 karar',
    },
  ],
  [
    T0 + 1000,
    {
      stage: 'tool',
      status: 'started',
      label: 'Karar metni inceleniyor',
      toolName: 'get_decision',
      callId: 'c3',
    },
  ],
  [
    T0 + 1500,
    {
      stage: 'tool',
      status: 'done',
      label: 'Karar metni inceleniyor',
      toolName: 'get_decision',
      callId: 'c3',
      detail: KUNYE,
    },
  ],
  [
    T0 + 1600,
    {
      stage: 'tool',
      status: 'done',
      label: 'Madde metni getiriliyor',
      toolName: 'get_legislation_article',
      callId: 'c2',
      detail: 'TBK m. 1',
    },
  ],
  [T0 + 2000, { stage: 'synthesis', status: 'started', label: 'Cevap oluşturuluyor' }],
  [T0 + 4000, { stage: 'verification', status: 'started', label: 'Künyeler doğrulanıyor' }],
  [T0 + 4100, { stage: 'synthesis', status: 'done', label: 'Yanıt tamamlandı' }],
];

describe('KK-P10-10: pipeline-store olay dizisi', () => {
  it('paralel araçlar callId ile ayrı satırdır ve ikisi birden çalışıyor görünür', () => {
    const s = run(TURN);
    const v = pipelineView(s, T0 + 500);
    expect(v.settled).toBe(false);
    expect(v.active.map((r) => r.label)).toEqual([
      'Emsal kararlar aranıyor',
      'Madde metni getiriliyor',
    ]);
    expect(v.steps).toBe(3);
    expect(v.elapsedMs).toBe(500);
  });

  it('tamamlanan tur: satırlar, ayrıntı, araç sayımı; kapanış etiketi satır adı olmaz', () => {
    const s = settlePipeline(run([...TURN, ...REST]), T0 + 4200, 'done');
    const v = pipelineView(s, T0 + 99_999);
    expect(v.settled).toBe(true);
    expect(v.active).toEqual([]);
    expect(v.elapsedMs).toBe(4200);
    expect(s.rows.map((r) => [r.label, r.status])).toEqual([
      ['Kişisel veriler maskelendi', 'done'],
      ['Emsal kararlar aranıyor', 'done'],
      ['Madde metni getiriliyor', 'done'],
      ['Karar metni inceleniyor', 'done'],
      ['Cevap oluşturuluyor', 'done'],
      ['Künyeler doğrulanıyor', 'done'],
    ]);
    expect(s.rows.find((r) => r.key === 'tool:c3')?.detail).toBe(KUNYE);
    expect(v.toolCounts).toEqual([
      { toolName: 'search_decisions', count: 1 },
      { toolName: 'get_legislation_article', count: 1 },
      { toolName: 'get_decision', count: 1 },
    ]);
    // Satır süresi: c3 1000 -> 1500.
    const c3 = s.rows.find((r) => r.key === 'tool:c3');
    expect(c3 && (c3.endedAt ?? 0) - c3.startedAt).toBe(500);
  });

  it('durdurulan turda çalışan satırlar atlandı, hata turunda hata olur', () => {
    const stopped = settlePipeline(run(TURN), T0 + 700, 'stopped');
    expect(stopped.rows.filter((r) => r.stage === 'tool').map((r) => r.status)).toEqual([
      'skipped',
      'skipped',
    ]);
    const failed = settlePipeline(run(TURN), T0 + 700, 'error');
    expect(pipelineView(failed, T0 + 700).failed).toBe(2);
  });

  it('kapanıştan sonra gelen olay yok sayılır', () => {
    const s = settlePipeline(run(TURN), T0 + 700, 'done');
    const after = applyPipelineEvent(
      s,
      { stage: 'synthesis', status: 'started', label: 'Cevap oluşturuluyor' },
      T0 + 800,
    );
    expect(after).toBe(s);
  });

  it('callId yoksa aynı aracın çalışan satırı güncellenir', () => {
    const s = run([
      [
        T0,
        {
          stage: 'tool',
          status: 'started',
          label: 'Mevzuat aranıyor',
          toolName: 'search_legislation',
        },
      ],
      [
        T0 + 50,
        {
          stage: 'tool',
          status: 'done',
          label: 'Mevzuat aranıyor',
          toolName: 'search_legislation',
          detail: '2 sonuç',
        },
      ],
    ]);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]?.status).toBe('done');
    expect(s.rows[0]?.detail).toBe('2 sonuç');
  });
});

function render(state: PipelineState): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'tr',
      messages,
      timeZone: 'Europe/Istanbul',
      children: createElement(Announcer, { coalesceMs: 0 }, createElement(PipelineBar, { state })),
    }),
  );
}

describe('KK-P10-10: PipelineBar görünümü', () => {
  it('akışta paralel işlem başlığı, açık liste ve dönen + statik simge (azaltılmış hareket)', () => {
    const html = render(run(TURN));
    expect(html).toContain('2 işlem paralel yürütülüyor');
    expect(html).toContain('Emsal kararlar aranıyor, Madde metni getiriliyor');
    expect(html).toContain('3 adım');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('motion-safe:animate-spin');
    expect(html).toContain('motion-reduce:block');
  });

  it('hiç olay yokken "Hazırlanıyor"', () => {
    expect(render(startPipeline(Date.now()))).toContain('Hazırlanıyor');
  });

  it('tamamlanınca tek satır özete katlanır; "Yanıt tamamlandı" ve dönen simge yok', () => {
    const s = settlePipeline(run([...TURN, ...REST]), T0 + 4200, 'done');
    const html = render(s);
    expect(html).toContain('1 emsal araması, 1 mevzuat getirme, 1 karar incelemesi');
    expect(html).toContain('6 adım · 4,2 sn');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Yanıt tamamlandı');
    expect(html).not.toContain('animate-spin');
    // Künye ayrıntısı sakin vurguyla, eşaralıklı yazı tipi olmadan.
    expect(html).toContain(KUNYE);
    expect(html).not.toContain('font-mono');
  });

  it('durdurulan tur özeti atlanan işlemleri söyler, tamamlandı demez', () => {
    const html = render(settlePipeline(run(TURN), T0 + 700, 'stopped'));
    expect(html).toContain('2 işlem durduruldu');
    expect(html).not.toContain('tamamlandı');
  });

  it('süre biçimi: 10 sn altı tek ondalık, üstü tam sayı', () => {
    expect(formatSeconds(2400)).toBe('2,4');
    expect(formatSeconds(37_400)).toBe('37');
  });
});
