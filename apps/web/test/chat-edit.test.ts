// @tk TK-33
// Kullanıcı mesajını düzenleme ve kopyalama (022 §2.1 uzantısı): düzenle -> o mesajdan itibaren kes ->
// aynı metni `replaceFromMessageId` ile yeni tur olarak gönder; kesilen yanıtların `[K#]` eşlemesi
// paneli terk eder. Düğmeler yalnız eylem verildiğinde (tur sürmezken) çizilir. Veriler sentetiktir.
import { ChatTurnRequest, dataPartSchemas, MessageMetadata } from '@eda/contracts/stream';
import { Announcer } from '@eda/ui';
import { validateUIMessages } from 'ai';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { UserMessage } from '../src/features/chat/chat-message.tsx';
import {
  buildChatTurnRequest,
  replaceFromOfBody,
  truncateFromMessage,
} from '../src/features/chat/chat-request.ts';
import { conversationSources, type EdaUIMessage } from '../src/features/chat/chat-types.ts';

const U1 = '01990000-0000-7000-8000-000000000011';
const A1 = '01990000-0000-7000-8000-000000000012';
const U2 = '01990000-0000-7000-8000-000000000013';
const A2 = '01990000-0000-7000-8000-000000000014';
const U3 = '01990000-0000-7000-8000-000000000015';

const source = (ref: string) => ({
  ref,
  kind: 'legislation',
  sourceId: `6098:${ref}`,
  shortKunye: `TBK m. ${ref}`,
  title: `TÜRK BORÇLAR KANUNU ${ref}`,
  origin: 'live',
  portal: 'mevzuat',
  retrievedAt: '2026-10-12',
  relevance: 'high',
});

async function history(): Promise<EdaUIMessage[]> {
  return validateUIMessages<EdaUIMessage>({
    messages: [
      {
        id: U1,
        role: 'user',
        metadata: { mode: 'chat' },
        parts: [{ type: 'text', text: 'ilk soru' }],
      },
      {
        id: A1,
        role: 'assistant',
        metadata: { status: 'complete' },
        parts: [
          { type: 'data-sources', id: 'sources', data: { sources: [source('K1')] } },
          { type: 'text', text: 'ilk yanıt [K1]', state: 'done' },
        ],
      },
      {
        id: U2,
        role: 'user',
        metadata: { mode: 'chat' },
        parts: [{ type: 'text', text: 'ikinci soru' }],
      },
      {
        id: A2,
        role: 'assistant',
        metadata: { status: 'complete' },
        parts: [
          { type: 'data-sources', id: 'sources', data: { sources: [source('K2')] } },
          { type: 'text', text: 'ikinci yanıt [K2]', state: 'done' },
        ],
      },
    ],
    metadataSchema: MessageMetadata,
    dataSchemas: dataPartSchemas,
  });
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

describe('mesaj düzenleme: kes ve yeniden gönder', () => {
  it('hedef kullanıcı mesajı ve sonrası düşer; asistan veya bilinmeyen hedef kesmez', async () => {
    const all = await history();
    const kept = truncateFromMessage(all, U2);
    expect(kept?.map((m) => m.id)).toEqual([U1, A1]);
    expect(truncateFromMessage(all, U1)).toEqual([]);
    expect(truncateFromMessage(all, A1)).toBeNull();
    expect(truncateFromMessage(all, U3)).toBeNull();
  });

  it('istek gövdesi yeni metni ve kesme noktasını taşır; sözleşmeden geçer', async () => {
    const all = await history();
    const kept = truncateFromMessage(all, U2) ?? [];
    const body = buildChatTurnRequest(
      [...kept, { id: U3, role: 'user', parts: [{ type: 'text', text: 'düzeltilmiş soru' }] }],
      'edai-flash',
      null,
      U2,
    );
    expect(ChatTurnRequest.safeParse(body).success).toBe(true);
    expect(body.trigger).toBe('submit-message');
    expect(body.replaceFromMessageId).toBe(U2);
    expect(body.message?.id).toBe(U3);
    expect(body.message?.parts[0].text).toBe('düzeltilmiş soru');
    // Olağan gönderimde kesme noktası yoktur.
    expect(buildChatTurnRequest(all.slice(0, 1), 'edai-flash').replaceFromMessageId).toBeNull();
    expect(replaceFromOfBody({ alias: 'edai-pro', replaceFromMessageId: U2 })).toBe(U2);
    expect(replaceFromOfBody({ alias: 'edai-pro', replaceFromMessageId: null })).toBeNull();
    expect(replaceFromOfBody(undefined)).toBeNull();
  });

  it('kesilen yanıtların [K#] kaynakları eşlemeden ve panelden düşer', async () => {
    const all = await history();
    expect([...conversationSources(all).keys()]).toEqual(['K1', 'K2']);
    const kept = truncateFromMessage(all, U2) ?? [];
    expect([...conversationSources(kept).keys()]).toEqual(['K1']);
  });
});

describe('kullanıcı balonu eylemleri', () => {
  const EDIT_LABEL = `aria-label="${messages.chat.message.edit}"`;
  const COPY_LABEL = `aria-label="${messages.chat.message.copy}"`;

  it('kopyala ve düzenle yalnız eylem verildiğinde çizilir; akışta düzenleme yoktur', async () => {
    const [user] = await history();
    if (!user) throw new Error('fixture');
    const idle = render(
      createElement(UserMessage, {
        message: user,
        onCopy: async () => true,
        onEdit: () => undefined,
      }),
    );
    expect(idle).toContain(COPY_LABEL);
    expect(idle).toContain(EDIT_LABEL);
    expect(idle).toContain('ilk soru');

    // Tur sürerken çağıran taraf onEdit vermez: düzenleme düğmesi yoktur, kopyalama kalır.
    const busy = render(createElement(UserMessage, { message: user, onCopy: async () => true }));
    expect(busy).toContain(COPY_LABEL);
    expect(busy).not.toContain(EDIT_LABEL);

    const bare = render(createElement(UserMessage, { message: user }));
    expect(bare).not.toContain(COPY_LABEL);
    expect(bare).not.toContain(EDIT_LABEL);
  });
});
