// Brevo adaptörü (`api.brevo.com`): `POST {EMAIL_API_URL}/v3/smtp/email`, `api-key` başlığı;
// gövde `{sender,to,subject,htmlContent,textContent,replyTo,headers}`; yanıt `{ "messageId": "..." }`.
import type { EmailMessage } from '../types.ts';
import type { ProviderAdapter } from './common.ts';

/** `Ad <adres>` veya yalın adres -> Brevo gönderen nesnesi. */
export function parseMailbox(value: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(value);
  if (m?.[2] === undefined) return { email: value.trim() };
  const name = (m[1] ?? '').replace(/^"|"$/g, '');
  return name === '' ? { email: m[2].trim() } : { name, email: m[2].trim() };
}

export const brevoAdapter: ProviderAdapter = {
  build(msg: EmailMessage, opts) {
    const { 'Reply-To': replyTo, ...rest } = msg.headers;
    return {
      path: '/v3/smtp/email',
      headers: { 'api-key': opts.apiKey },
      body: {
        sender: parseMailbox(opts.from),
        to: [{ email: msg.to }],
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
        ...(replyTo === undefined ? {} : { replyTo: parseMailbox(replyTo) }),
        headers: rest,
      },
    };
  },
  messageId(body) {
    const id = (body as { messageId?: unknown } | undefined)?.messageId;
    return typeof id === 'string' && id !== '' ? id : undefined;
  },
  senderUnverified(_status, text) {
    return text.includes('sender') && (text.includes('valid') || text.includes('verif'));
  },
};
