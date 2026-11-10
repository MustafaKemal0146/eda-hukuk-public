// @tk TK-33
// P10 (022 §2.1; 053-02 §4.14): istek gövdesi yalnız son kullanıcı mesajını taşır ve sözleşme
// şemasından geçer. Yardımcılar: UUIDv7, güvenli bağlantı izin listesi, api hata zarfı, ilk mesaj.
import { ChatTurnRequest } from '@eda/contracts/stream';
import { describe, expect, it } from 'vitest';
import { aliasFromBody, buildChatTurnRequest } from '../src/features/chat/chat-request.ts';
import {
  clearPendingFirstMessage,
  peekPendingFirstMessage,
  setPendingFirstMessage,
} from '../src/features/chat/pending-message.ts';
import { errorInfoOf, parseErrorEnvelope } from '../src/lib/api-error.ts';
import { safeHref } from '../src/lib/safe-link.ts';
import { uuidv7 } from '../src/lib/uuid.ts';

describe('P10: buildChatTurnRequest (022 §2.1)', () => {
  it('yalnız son kullanıcı mesajı; şema geçerli', () => {
    const u1 = uuidv7();
    const u2 = uuidv7();
    const body = buildChatTurnRequest(
      [
        { id: u1, role: 'user', parts: [{ type: 'text', text: 'ilk soru' }] },
        { id: uuidv7(), role: 'assistant', parts: [{ type: 'text', text: 'yanıt' }] },
        {
          id: u2,
          role: 'user',
          parts: [
            { type: 'text', text: 'ikinci ' },
            { type: 'text', text: 'soru' },
          ],
        },
      ],
      'edai-pro',
    );
    expect(ChatTurnRequest.safeParse(body).success).toBe(true);
    expect(body.message).toEqual({
      id: u2,
      role: 'user',
      parts: [{ type: 'text', text: 'ikinci soru' }],
    });
    expect(body.alias).toBe('edai-pro');
    expect(body.trigger).toBe('submit-message');
    expect(body.regenerateMessageId).toBeNull();
  });

  it('son mesaj kullanıcı değilse gönderim yapılmaz', () => {
    expect(() =>
      buildChatTurnRequest([{ id: uuidv7(), role: 'assistant', parts: [] }], 'edai-flash'),
    ).toThrow();
  });

  it('takma ad gövdeden okunur, tanınmazsa Hızlı', () => {
    expect(aliasFromBody({ alias: 'edai-pro' })).toBe('edai-pro');
    expect(aliasFromBody({ alias: 'baska' })).toBe('edai-flash');
    expect(aliasFromBody(undefined)).toBe('edai-flash');
  });
});

describe('P10: yardımcılar', () => {
  it('uuidv7 sürüm ve varyant bitleri, zaman sırası', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.slice(0, 13) < b.slice(0, 13)).toBe(true);
  });

  it('güvenli bağlantı: yalnız https ve izinli resmî alan adları', () => {
    expect(safeHref('https://bedesten.adalet.gov.tr/x')).toBe('https://bedesten.adalet.gov.tr/x');
    expect(safeHref('https://kararlarbilgibankasi.anayasa.gov.tr/BB/1')).not.toBeNull();
    expect(safeHref('https://kararlar.uyusmazlik.gov.tr/')).not.toBeNull();
    expect(safeHref('http://www.mevzuat.gov.tr/')).toBeNull();
    expect(safeHref('https://mevzuat.gov.tr.ornek.com/')).toBeNull();
    expect(safeHref('https://anayasa.gov.tr.ornek.com/')).toBeNull();
    expect(safeHref('https://kullanici@www.mevzuat.gov.tr/')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });

  it('api hata zarfı okunur; tanınmayan gövde genel hataya düşer', () => {
    const body = JSON.stringify({
      error: {
        code: 'CHAT_STREAM_IN_PROGRESS',
        message: 'Önceki yanıt üretiliyor.',
        requestId: 'r-12345678',
      },
    });
    expect(parseErrorEnvelope(body, 409)).toEqual({
      code: 'CHAT_STREAM_IN_PROGRESS',
      message: 'Önceki yanıt üretiliyor.',
      requestId: 'r-12345678',
      status: 409,
    });
    expect(errorInfoOf(new Error(body)).code).toBe('CHAT_STREAM_IN_PROGRESS');
    expect(errorInfoOf(new TypeError('Failed to fetch'))).toMatchObject({
      code: 'CLIENT_UNKNOWN',
      message: null,
    });
  });

  it('KK-P10-3: ilk mesaj okunur, gönderen silene dek kalır (Strict Mode çift okuma)', () => {
    const id = uuidv7();
    setPendingFirstMessage(id, { text: 'soru', alias: 'edai-flash' });
    expect(peekPendingFirstMessage(id)).toEqual({ text: 'soru', alias: 'edai-flash' });
    expect(peekPendingFirstMessage(id)).not.toBeNull();
    clearPendingFirstMessage(id);
    expect(peekPendingFirstMessage(id)).toBeNull();
  });
});
