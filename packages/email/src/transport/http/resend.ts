// Resend adaptörü (AB bölgesi gönderim; API ana bilgisayarı `api.resend.com`).
// `POST {EMAIL_API_URL}/emails`, `Authorization: Bearer <anahtar>`; gövde
// `{from,to,subject,html,text,reply_to,headers}`; yanıt `{ "id": "..." }`.
// `Idempotency-Key` = teslimat kimliği: kuyruk yeniden denemesi çift gönderim üretmez.
import type { EmailMessage } from '../types.ts';
import type { ProviderAdapter } from './common.ts';

export const resendAdapter: ProviderAdapter = {
  build(msg: EmailMessage, opts) {
    const { 'Reply-To': replyTo, ...rest } = msg.headers;
    const idem = msg.headers['X-Entity-Ref-ID'];
    return {
      path: '/emails',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        ...(idem === undefined ? {} : { 'Idempotency-Key': idem }),
      },
      body: {
        from: opts.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(replyTo === undefined ? {} : { reply_to: replyTo }),
        headers: rest,
      },
    };
  },
  messageId(body) {
    const id = (body as { id?: unknown } | undefined)?.id;
    return typeof id === 'string' && id !== '' ? id : undefined;
  },
  senderUnverified(_status, text) {
    return text.includes('domain') && text.includes('verif');
  },
};
