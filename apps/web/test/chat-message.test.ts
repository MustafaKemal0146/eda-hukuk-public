// @tk TK-33
// KK-P10-10 (KK-053-02-12): sayfa yenilenince (geçmiş `GET`) tamamlanmış asistan mesajında dönen
// gösterge, "Hazırlanıyor" ve geçen süre ÇİZİLMEZ; ajan hattı özeti yalnız kaynak sayısından türer.
// Kalıcı mesaj şekli AI SDK doğrulamasından (sözleşme şemalarıyla) geçer. Veriler sentetiktir.
import { dataPartSchemas, MessageMetadata } from '@eda/contracts/stream';
import { Announcer } from '@eda/ui';
import { validateUIMessages } from 'ai';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { AssistantMessage, UserMessage } from '../src/features/chat/chat-message.tsx';
import {
  conversationSources,
  type EdaUIMessage,
  environmentNotice,
  maskedCountOf,
  messageSources,
} from '../src/features/chat/chat-types.ts';

const STORED: unknown[] = [
  {
    id: '01990000-0000-7000-8000-000000000011',
    role: 'user',
    parts: [{ type: 'text', text: 'Sentetik soru <b>kalın</b>' }],
    metadata: { mode: 'chat' },
  },
  {
    id: '01990000-0000-7000-8000-000000000012',
    role: 'assistant',
    metadata: {
      alias: 'edai-flash',
      providerId: 'mock',
      region: 'NONE',
      modelLabel: 'edai-flash',
      status: 'complete',
      startedAt: Date.UTC(2026, 9, 10, 9, 30),
    },
    parts: [
      {
        type: 'data-notice',
        id: 'notice:simulation',
        data: { code: 'simulation', level: 'info', message: 'Simülasyon.' },
      },
      { type: 'step-start' },
      {
        type: 'data-sources',
        id: 'sources',
        data: {
          sources: [
            {
              ref: 'K1',
              kind: 'decision',
              sourceId: 'ornek-1',
              shortKunye: 'Örnek HD 2000/1 E.',
              title: 'Örnek karar',
              origin: 'live',
              portal: 'bedesten',
              retrievedAt: '2026-10-10',
              url: 'https://bedesten.adalet.gov.tr/ornek/1',
              relevance: 'high',
            },
            {
              ref: 'K2',
              kind: 'legislation',
              sourceId: 'ornek-2',
              shortKunye: 'Örnek Kanun m. 1',
              title: 'Örnek madde',
              origin: 'live',
              retrievedAt: '2026-10-10',
              relevance: 'medium',
            },
          ],
        },
      },
      { type: 'text', text: 'Yanıt [K1] ve [K2].', state: 'done' },
      {
        type: 'data-citations',
        id: 'citations',
        data: {
          final: true,
          citations: [
            {
              citationId: '01990000-0000-7000-8000-0000000000c1',
              ref: 'K1',
              raw: '[K1]',
              status: 'verified',
              blocking: 'none',
            },
          ],
        },
      },
    ],
  },
];

// #10: sağlayıcı/model etiketi yalnız takma adla (Hızlı/Derin model) gösterilen yanıt.
async function renderAssistant(meta: {
  alias?: 'edai-flash' | 'edai-pro';
  modelLabel?: string;
  keySource?: 'org' | 'own' | 'platform';
}) {
  const [msg] = await validateUIMessages<EdaUIMessage>({
    messages: [
      {
        id: '01990000-0000-7000-8000-000000000021',
        role: 'assistant',
        metadata: {
          ...meta,
          providerId: 'anthropic',
          region: 'US',
          modelLabel: meta.modelLabel ?? 'Claude Haiku 5.5',
          status: 'complete',
          startedAt: Date.UTC(2026, 9, 10, 9, 30),
        },
        parts: [{ type: 'text', text: 'Yanıt.', state: 'done' }],
      },
    ],
    metadataSchema: MessageMetadata,
    dataSchemas: dataPartSchemas,
  });
  if (!msg) throw new Error('fixture');
  const sources = messageSources(msg);
  return withProviders(
    createElement(AssistantMessage, {
      message: msg,
      streaming: false,
      stopped: false,
      pipeline: null,
      sources,
      citations: {
        sources: new Map(),
        statuses: new Map(),
        labels: { chip: (k) => k, unresolved: '?' },
      },
    }),
  );
}

function withProviders(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'tr',
      messages,
      timeZone: 'Europe/Istanbul',
      children: createElement(Announcer, { coalesceMs: 0 }, node),
    }),
  );
}

describe('KK-P10-10: geçmişten yüklenen mesaj', () => {
  it('kalıcı mesajlar sözleşme şemalarıyla doğrulanır', async () => {
    const valid = await validateUIMessages<EdaUIMessage>({
      messages: STORED,
      metadataSchema: MessageMetadata,
      dataSchemas: dataPartSchemas,
    });
    expect(valid).toHaveLength(2);
    expect(environmentNotice(valid)).toBe('simulation');
    expect([...conversationSources(valid).keys()]).toEqual(['K1', 'K2']);
  });

  it('geçici olay yokken özet kaynak sayısından türer; yükleniyor göstergesi yok', async () => {
    const [user, assistant] = await validateUIMessages<EdaUIMessage>({
      messages: STORED,
      metadataSchema: MessageMetadata,
      dataSchemas: dataPartSchemas,
    });
    if (!user || !assistant) throw new Error('fixture');
    const sources = messageSources(assistant);
    const html = withProviders(
      createElement(AssistantMessage, {
        message: assistant,
        streaming: false,
        stopped: false,
        pipeline: null,
        sources,
        citations: {
          sources: new Map(sources.map((s) => [s.ref, s])),
          statuses: new Map([['K1', 'verified' as const]]),
          labels: { chip: (k) => `Kaynak: ${k}`, unresolved: 'Kaynak etiketi çözülemedi' },
        },
        onShowSources: () => undefined,
        onCopy: () => undefined,
      }),
    );
    expect(html).toContain('2 kaynak getirildi');
    expect(html).not.toContain('Hazırlanıyor');
    expect(html).not.toContain('animate-spin');
    expect(html).not.toContain('Yanıt tamamlandı');
    // Rozet: simülasyonda sağlayıcı adı yinelenmez; kalıcı SİMÜLASYON rozeti var.
    expect(html).toContain('İşlem yeri: Simülasyon<');
    expect(html).toContain('SİMÜLASYON');
    expect(html).toContain('aria-label="E.D.A. yanıtı, 12:30"');
    expect(html).toContain('Örnek HD 2000/1 E.');
    expect(html).toContain('aria-label="Kopyala"');

    const userHtml = withProviders(createElement(UserMessage, { message: user }));
    expect(userHtml).toContain('Sentetik soru &lt;b&gt;kalın&lt;/b&gt;');
    expect(userHtml).toContain('aria-label="Mesajınız"');
  });

  it('akış sürerken eylem çubuğu ve kaynak düğmesi çizilmez', async () => {
    const [, assistant] = await validateUIMessages<EdaUIMessage>({
      messages: STORED,
      metadataSchema: MessageMetadata,
      dataSchemas: dataPartSchemas,
    });
    if (!assistant) throw new Error('fixture');
    const html = withProviders(
      createElement(AssistantMessage, {
        message: assistant,
        streaming: true,
        stopped: false,
        pipeline: null,
        sources: messageSources(assistant),
        citations: {
          sources: new Map(),
          statuses: new Map(),
          labels: { chip: (k) => k, unresolved: '?' },
        },
        onShowSources: () => undefined,
        onCopy: () => undefined,
      }),
    );
    expect(html).not.toContain('aria-label="Kopyala"');
    expect(html).not.toContain('2 kaynak getirildi');
  });
});

describe('#10: yanıt sağlayıcı etiketi takma adla gösterilir', () => {
  it('görünen metin takma addır; sağlayıcı ve model yalnız title içindedir', async () => {
    const html = await renderAssistant({ alias: 'edai-flash', modelLabel: 'Claude Haiku 5.5' });
    expect(html).toContain('Hızlı model</span>');
    expect(html).not.toMatch(/>[^<]*İşlem yeri[^<]*</);
    expect(html).toContain('title="Anthropic · Claude Haiku 5.5 · İşlem yeri: ABD (Anthropic)"');

    const deep = await renderAssistant({ alias: 'edai-pro', modelLabel: 'Claude Sonnet 5.5' });
    expect(deep).toContain('Derin model</span>');
    expect(deep).toContain('title="Anthropic · Claude Sonnet 5.5 · İşlem yeri: ABD (Anthropic)"');
  });

  it('takma ad yokken sağlayıcı ve model etiketi eskisi gibi görünür', async () => {
    const html = await renderAssistant({});
    expect(html).toContain('İşlem yeri: ABD (Anthropic)</span>');
    expect(html).toContain('Claude Haiku 5.5');
    expect(html).toContain('title="Anthropic · Claude Haiku 5.5 · İşlem yeri: ABD (Anthropic)"');
  });
});

describe('AS-0409: yanıt rozetinde anahtar kaynağı', () => {
  it('kaynak platform ise "Ortak anahtar" etiketi ve açıklaması görünür', async () => {
    const html = await renderAssistant({ alias: 'edai-flash', keySource: 'platform' });
    expect(html).toContain('Ortak anahtar</span>');
    expect(html).toContain('platformun ortak anahtarıyla üretildi');
  });

  it('büro/kullanıcı anahtarı ve kaynaksız yanıtta etiket görünmez (eski davranış)', async () => {
    for (const keySource of ['org', 'own', undefined] as const) {
      const html = await renderAssistant({
        alias: 'edai-flash',
        ...(keySource ? { keySource } : {}),
      });
      expect(html).not.toContain('Ortak anahtar');
    }
  });
});

// KK-053-02 alt satır 9 (022 S3): maskeleme bildirimi uyarı kartı değil, mesaj altı bilgi satırıdır.
describe('masking_applied: mesaj altı bilgi satırı', () => {
  it('meta.count ile katalog metni çizilir; sunucu metni kart olarak çizilmez', async () => {
    const [msg] = await validateUIMessages<EdaUIMessage>({
      messages: [
        {
          id: '01990000-0000-7000-8000-000000000031',
          role: 'assistant',
          metadata: { alias: 'edai-flash', status: 'complete' },
          parts: [
            {
              type: 'data-notice',
              id: 'notice:masking_applied',
              data: {
                code: 'masking_applied',
                level: 'info',
                message: '3 kişisel veri maskelendi.',
                meta: { count: 3 },
              },
            },
            { type: 'text', text: 'Yanıt.', state: 'done' },
          ],
        },
      ],
      metadataSchema: MessageMetadata,
      dataSchemas: dataPartSchemas,
    });
    if (!msg) throw new Error('fixture');
    expect(maskedCountOf(msg)).toBe(3);
    const html = withProviders(
      createElement(AssistantMessage, {
        message: msg,
        streaming: false,
        stopped: false,
        pipeline: null,
        sources: [],
        citations: {
          sources: new Map(),
          statuses: new Map(),
          labels: { chip: (k) => k, unresolved: '?' },
        },
      }),
    );
    expect(html).toContain('3 kişisel veri maskelenerek gönderildi.');
    expect(html).not.toContain('3 kişisel veri maskelendi.');
  });
});

describe('KK-pilot-1: ortam bildirimi şeridi', () => {
  const withNotice = (code: 'simulation' | 'beta_synthetic' | 'masking_applied'): EdaUIMessage => ({
    id: `01990000-0000-7000-8000-0000000000${code.length}`,
    role: 'assistant',
    parts: [
      {
        type: 'data-notice',
        id: `notice:${code}`,
        data: { code, level: 'info', message: 'Sentetik bildirim.' },
      },
    ],
  });

  it('pilot (beta_synthetic) bildirimi alınmışsa kalıcı şerit için döner', () => {
    expect(environmentNotice([withNotice('beta_synthetic')])).toBe('beta_synthetic');
  });

  it('simülasyon önceliklidir; ilgisiz bildirim veya bildirimsiz sohbet şerit üretmez', () => {
    expect(environmentNotice([withNotice('beta_synthetic'), withNotice('simulation')])).toBe(
      'simulation',
    );
    expect(environmentNotice([withNotice('masking_applied')])).toBeNull();
    expect(environmentNotice([])).toBeNull();
  });
});
