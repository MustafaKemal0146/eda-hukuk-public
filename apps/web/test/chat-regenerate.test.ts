// @tk TK-33
// #15 (P09; 022 §2.1, KK-053-02-21/22): yeniden üretim isteği kullanıcı mesajı GÖNDERMEZ, hedefi
// bildirir; "Yeniden üret" yalnız yeniden üretilebilir son yanıtta çizilir ve tur sürerken çizilmez.
// Veriler sentetiktir.
import { ChatTurnRequest, dataPartSchemas, MessageMetadata } from '@eda/contracts/stream';
import { Announcer } from '@eda/ui';
import { validateUIMessages } from 'ai';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { AssistantMessage } from '../src/features/chat/chat-message.tsx';
import { buildRegenerateRequest } from '../src/features/chat/chat-request.ts';
import type { EdaUIMessage } from '../src/features/chat/chat-types.ts';

const ASSISTANT_ID = '01990000-0000-7000-8000-000000000041';
// Etiketler katalogdan okunur: metin ile düğme bağı kopmaz.
const REGENERATE_LABEL = `aria-label="${messages.chat.message.regenerate}"`;
const COPY_LABEL = `aria-label="${messages.chat.message.copy}"`;

async function assistantMessage(): Promise<EdaUIMessage> {
  const [msg] = await validateUIMessages<EdaUIMessage>({
    messages: [
      {
        id: ASSISTANT_ID,
        role: 'assistant',
        metadata: { alias: 'edai-flash', providerId: 'mock', region: 'NONE', status: 'complete' },
        parts: [{ type: 'text', text: 'Sentetik yanıt metni.', state: 'done' }],
      },
    ],
    metadataSchema: MessageMetadata,
    dataSchemas: dataPartSchemas,
  });
  if (!msg) throw new Error('fixture');
  return msg;
}

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'tr',
      messages,
      timeZone: 'Europe/Istanbul',
      children: createElement(Announcer, { coalesceMs: 0 }, node),
    }),
  );
}

describe('KK-053-02-21: yeniden üretim isteği', () => {
  it('kullanıcı mesajı taşımaz, hedefi ve takma adı bildirir', () => {
    const body = buildRegenerateRequest('edai-pro', ASSISTANT_ID, ['mevzuat']);
    expect(ChatTurnRequest.safeParse(body).success).toBe(true);
    expect(body.trigger).toBe('regenerate-message');
    expect(body.message).toBeNull();
    expect(body.regenerateMessageId).toBe(ASSISTANT_ID);
    expect(body.alias).toBe('edai-pro');
    expect(body.scope.sources).toEqual(['mevzuat']);
  });

  it('hedef verilmezse sunucunun son yanıtı hedeflenir', () => {
    const body = buildRegenerateRequest('edai-flash', null);
    expect(ChatTurnRequest.safeParse(body).success).toBe(true);
    expect(body.regenerateMessageId).toBeNull();
  });
});

describe('KK-053-02-22: yeniden üretim düğmesi', () => {
  it('son yanıtta çizilir; tur sürerken ve yeniden üretilemeyen yanıtta çizilmez', async () => {
    const message = await assistantMessage();
    const base = {
      message,
      stopped: false,
      pipeline: null,
      sources: [],
      citations: {
        sources: new Map(),
        statuses: new Map(),
        labels: { chip: (k: string) => k, unresolved: '?' },
      },
    };
    const idle = render(
      createElement(AssistantMessage, {
        ...base,
        streaming: false,
        onRegenerate: () => undefined,
      }),
    );
    expect(idle).toContain(REGENERATE_LABEL);

    // Tur sürerken eylem çubuğu çizilmez: çift tetikleme olmaz.
    const busy = render(
      createElement(AssistantMessage, {
        ...base,
        streaming: true,
        onRegenerate: () => undefined,
      }),
    );
    expect(busy).not.toContain(REGENERATE_LABEL);

    // Yeniden üretilemeyen (son olmayan) yanıtta düğme yoktur; kopyalama yine çizilir.
    const other = render(
      createElement(AssistantMessage, { ...base, streaming: false, onCopy: () => undefined }),
    );
    expect(other).not.toContain(REGENERATE_LABEL);
    expect(other).toContain(COPY_LABEL);
  });
});
