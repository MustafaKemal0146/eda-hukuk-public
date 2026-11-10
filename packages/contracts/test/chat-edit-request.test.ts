// @tk TK-28
// Kullanıcı mesajını düzenleyip yeniden gönderme sözleşmesi (022 §2): `replaceFromMessageId` yalnız
// `submit-message` ile verilir; alan yoksa `null` (geriye uyumlu). Veriler sentetiktir.
import { describe, expect, it } from 'vitest';
import { ChatTurnRequest } from '../src/stream/requests.ts';

const USER_ID = '01a12705-0fd0-7725-b35d-97784a0ac2f8';
const OLD_ID = '01a12705-0fd0-7725-b35d-97784a0ac2f9';

const submit = {
  trigger: 'submit-message',
  message: { id: USER_ID, role: 'user', parts: [{ type: 'text', text: 'düzeltilmiş soru' }] },
  regenerateMessageId: null,
  alias: 'edai-flash',
  mode: 'chat',
  scope: { sources: [], chamber: null, dateFrom: null, dateTo: null },
  attachments: [],
  mentions: [],
  documentId: null,
  documentBaseVersion: null,
  liveSearch: false,
};

describe('ChatTurnRequest.replaceFromMessageId (mesaj düzenleme)', () => {
  it('alan yoksa null; verilirse kullanıcı mesajı kimliği olarak geçer', () => {
    expect(ChatTurnRequest.parse(submit).replaceFromMessageId).toBeNull();
    const parsed = ChatTurnRequest.parse({ ...submit, replaceFromMessageId: OLD_ID });
    expect(parsed.replaceFromMessageId).toBe(OLD_ID);
    expect(parsed.trigger).toBe('submit-message');
  });

  it('yeniden üretimle birlikte verilemez; geçersiz kimlik reddedilir', () => {
    const regenerate = {
      ...submit,
      trigger: 'regenerate-message',
      message: null,
      regenerateMessageId: OLD_ID,
      replaceFromMessageId: USER_ID,
    };
    const r = ChatTurnRequest.safeParse(regenerate);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join('.'))).toContain('replaceFromMessageId');
    }
    expect(ChatTurnRequest.safeParse({ ...submit, replaceFromMessageId: 'gecersiz' }).success).toBe(
      false,
    );
  });
});
