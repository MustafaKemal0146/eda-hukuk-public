// @tk TK-33
// P21 ilk dilimi: sohbet ekleri. Ek kimliği istek gövdesine
// kullanıcı mesajının `file` parçasından gider (bayt yok); sunucu durumu çip evresine çevrilir; metinsiz
// PDF açık uyarıyla reddedilir; işlenen ek varken gönderim kapalı; kullanıcı mesajında ek çipi.
// Veriler sentetiktir.
import { Announcer } from '@eda/ui';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { attachmentIdsOf } from '../src/features/chat/attachment-parts.ts';
import {
  ATTACHMENT_ACCEPT,
  acceptsFile,
  type ChatAttachment,
  phaseOf,
  readyParts,
  sendBlocked,
  uploadErrorKey,
} from '../src/features/chat/attachments.ts';
import { UserMessage } from '../src/features/chat/chat-message.tsx';
import { buildChatTurnRequest } from '../src/features/chat/chat-request.ts';
import type { EdaUIMessage } from '../src/features/chat/chat-types.ts';
import { Composer } from '../src/features/chat/composer.tsx';
import { ApiClientError } from '../src/features/studio/documents-api.ts';

const FILE_ID = '01990000-0000-7000-8000-0000000000a1';

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

const item = (over: Partial<ChatAttachment>): ChatAttachment => ({
  localId: 'ek-1',
  name: 'ornek-kira.pdf',
  mimeType: 'application/pdf',
  fileId: FILE_ID,
  phase: 'ready',
  status: 'ready',
  error: null,
  scanWaiting: false,
  ...over,
});

describe('KK-P21-dosya: sohbet eki istemcisi', () => {
  it('istek gövdesi ek kimliklerini mesajın eda-file parçalarından kurar', () => {
    const parts = readyParts([
      item({}),
      item({ localId: 'ek-2', phase: 'error', error: 'noText' }),
    ]);
    expect(parts).toEqual([
      {
        type: 'file',
        mediaType: 'application/pdf',
        filename: 'ornek-kira.pdf',
        url: `eda-file:${FILE_ID}`,
      },
    ]);
    const req = buildChatTurnRequest(
      [
        {
          id: '01990000-0000-7000-8000-000000000001',
          role: 'user',
          parts: [{ type: 'text', text: 'Kira bedeli?' }, ...parts],
        },
      ],
      'edai-flash',
    );
    expect(req.attachments).toEqual([FILE_ID]);
    expect(req.message?.parts).toEqual([{ type: 'text', text: 'Kira bedeli?' }]);
    // Başka kaynaklı dosya parçası (ör. veri URL'si) ek sayılmaz.
    expect(attachmentIdsOf([{ type: 'file', url: 'data:application/pdf;base64,AA' }])).toEqual([]);
  });

  it('sunucu durumu çip evresine çevrilir; metinsiz PDF ve sayfa sınırı ayrı uyarı', () => {
    expect(phaseOf({ status: 'ready', statusReason: null }).phase).toBe('ready');
    expect(phaseOf({ status: 'ocr_skipped', statusReason: null })).toMatchObject({
      phase: 'error',
      error: 'noText',
    });
    expect(phaseOf({ status: 'ocr_skipped', statusReason: 'page_limit' }).error).toBe('pageLimit');
    expect(phaseOf({ status: 'failed', statusReason: 'encrypted_pdf' }).error).toBe('encrypted');
    expect(phaseOf({ status: 'quarantined', statusReason: 'av_detected' }).error).toBe(
      'quarantined',
    );
    expect(phaseOf({ status: 'scanning', statusReason: 'av_unavailable' })).toMatchObject({
      phase: 'processing',
      scanWaiting: true,
    });
    expect(uploadErrorKey(new ApiClientError(413, 'FILE_TOO_LARGE', null, null, null))).toBe(
      'tooLarge',
    );
    expect(uploadErrorKey(new Error('ağ'))).toBe('upload');
  });

  it('yalnız PDF ve Word kabul edilir; işlenen ek varken gönderim kapalı', () => {
    expect(acceptsFile('Dilekçe.DOCX')).toBe(true);
    expect(acceptsFile('karar.pdf')).toBe(true);
    expect(acceptsFile('tarama.png')).toBe(false);
    expect(acceptsFile('belge.udf')).toBe(false);
    expect(ATTACHMENT_ACCEPT).toContain('.pdf');
    expect(sendBlocked([item({ phase: 'processing', status: 'extracting' })])).toBe(true);
    expect(sendBlocked([item({}), item({ phase: 'error', error: 'noText' })])).toBe(false);
  });

  it('istem kutusu: çip adı, durum rozeti, metinsiz PDF uyarısı; işlenirken Gönder kapalı', () => {
    const html = withProviders(
      createElement(Composer, {
        value: 'Kira bedeli ne?',
        onValueChange: () => undefined,
        onSubmit: () => undefined,
        attachments: {
          items: [
            item({
              localId: 'a',
              name: 'tarama.pdf',
              phase: 'error',
              status: 'ocr_skipped',
              error: 'noText',
            }),
            item({ localId: 'b', name: 'karar.pdf', phase: 'processing', status: 'extracting' }),
          ],
          onAdd: () => undefined,
          onRemove: () => undefined,
        },
      }),
    );
    expect(html).toContain('tarama.pdf');
    expect(html).toContain('Metin içermeyen PDF');
    expect(html).toContain('Metin çıkarılıyor');
    expect(html).toContain('Eki kaldır: karar.pdf');
    expect(html).toMatch(/<button[^>]*aria-label="Gönder"[^>]*disabled/);
    expect(html).toContain('type="file"');
  });

  it('kullanıcı mesajında ek çipi çizilir; eda-file adresi DOM a yazılmaz', () => {
    const message = {
      id: '01990000-0000-7000-8000-000000000011',
      role: 'user',
      parts: [
        { type: 'text', text: 'Kira bedeli ne?' },
        {
          type: 'file',
          mediaType: 'application/pdf',
          filename: 'ornek-kira.pdf',
          url: `eda-file:${FILE_ID}`,
        },
      ],
    } as EdaUIMessage;
    const html = withProviders(createElement(UserMessage, { message }));
    expect(html).toContain('Ek: ornek-kira.pdf');
    expect(html).not.toContain(FILE_ID);
  });
});
