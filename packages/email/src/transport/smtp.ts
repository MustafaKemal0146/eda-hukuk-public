// SMTP taşıması (045 §8.1, §8.4): yalnız `development`/`test` (Mailpit). nodemailer dosya ve URL
// eklerini okumaz (`disableFileAccess`, `disableUrlAccess`); ek dosya yoktur, gövde
// `multipart/alternative` (düz metin + HTML). Satır sonu içeren başlık/alıcı değeri reddedilir.
import nodemailer from 'nodemailer';
import { type EmailMessage, type EmailTransport, EmailTransportError } from './types.ts';

const CRLF = /[\r\n]/;

export interface SmtpOptions {
  readonly url: string;
  readonly from: string;
  readonly timeoutMs: number;
}

/** SMTP yanıt kodu / ağ hatası -> 045 §6.6 sınıfı. */
export function classifySmtpError(err: unknown): EmailTransportError {
  const e = err as { responseCode?: unknown; code?: unknown };
  const rc = typeof e.responseCode === 'number' ? e.responseCode : undefined;
  if (rc === 552) return new EmailTransportError('message_too_large');
  if (rc === 550 || rc === 551 || rc === 553 || rc === 501) {
    return new EmailTransportError('recipient_rejected');
  }
  if (rc === 535 || rc === 530) return new EmailTransportError('provider_auth');
  if (rc === 421 || rc === 450 || rc === 451 || rc === 452) {
    return new EmailTransportError('provider_rate_limited');
  }
  if (e.code === 'ETIMEDOUT' || (e.code === 'ESOCKET' && rc === undefined)) {
    return new EmailTransportError('timeout');
  }
  return new EmailTransportError('provider_unavailable');
}

export function assertNoCrlf(msg: EmailMessage): void {
  const values = [msg.to, msg.subject, ...Object.keys(msg.headers), ...Object.values(msg.headers)];
  if (values.some((v) => CRLF.test(v))) throw new EmailTransportError('payload_invalid');
}

export function createSmtpTransport(opts: SmtpOptions): EmailTransport {
  const transporter = nodemailer.createTransport({
    url: opts.url,
    connectionTimeout: opts.timeoutMs,
    greetingTimeout: opts.timeoutMs,
    socketTimeout: opts.timeoutMs,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send(msg) {
      assertNoCrlf(msg);
      const { 'Message-ID': messageId, ...rest } = msg.headers;
      try {
        const info = await transporter.sendMail({
          from: opts.from,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          ...(messageId === undefined ? {} : { messageId }),
          headers: rest,
          attachments: [],
        });
        return { providerMessageId: String(info.messageId ?? messageId ?? '') };
      } catch (err) {
        if (err instanceof EmailTransportError) throw err;
        throw classifySmtpError(err);
      }
    },
    close() {
      transporter.close();
    },
  };
}
