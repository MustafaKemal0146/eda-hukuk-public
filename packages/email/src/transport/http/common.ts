// HTTP taşıması ortak katmanı (045 §8.1–§8.2, §6.6). Sağlayıcıya özel eşleme `resend.ts`/`brevo.ts`
// dosyalarındadır; burada istek gönderme, zaman aşımı ve hata sınıflandırma vardır.
// Yeniden deneme BURADA YAPILMAZ: geçici hatalar sınıflandırılıp fırlatılır, üstel yeniden deneme
// `email.send` işinin BullMQ mantığındadır (çift sayım olmaz; 043 §7.2).
// Gizlilik: alıcı adresi, konu, gövde ve API anahtarı hata iletisine, `cause` alanına ve günlüğe
// girmez; sağlayıcı yanıtından yalnız ileti kimliği okunur. Yönlendirme (redirect) izlenmez.
import type { EmailErrorCode } from '@eda/contracts/notifications';
import { assertNoCrlf } from '../smtp.ts';
import {
  type EmailMessage,
  type EmailTransport,
  EmailTransportConfigError,
  EmailTransportError,
} from '../types.ts';

/** Sağlayıcı yanıt gövdesi okuma üst sınırı (bayt); hata ayrıştırma ve kimlik için yeterlidir. */
const MAX_RESPONSE_BYTES = 64 * 1024;

export const HTTP_PROVIDERS = ['resend', 'brevo'] as const;
export type HttpProvider = (typeof HTTP_PROVIDERS)[number];

/** `EMAIL_API_URL` ana bilgisayarına göre adaptör seçimi (045 §8.1). */
export function providerFromApiUrl(apiUrl: string): HttpProvider {
  let host: string;
  try {
    host = new URL(apiUrl).hostname.toLowerCase();
  } catch {
    throw new EmailTransportConfigError('EMAIL_API_URL geçerli bir adres değil');
  }
  if (host === 'api.resend.com') return 'resend';
  if (host === 'api.brevo.com') return 'brevo';
  throw new EmailTransportConfigError(
    'EMAIL_API_URL ana bilgisayarı için e-posta adaptörü yok (desteklenen: api.resend.com, api.brevo.com)',
  );
}

export interface HttpTransportOptions {
  /** Taban adres; yolu sağlayıcı adaptörü ekler. */
  readonly baseUrl: string;
  /** Sağlayıcı API anahtarı (yalnız bellekte; `EMAIL_API_KEY_FILE`'dan okunur). */
  readonly apiKey: string;
  readonly from: string;
  readonly timeoutMs: number;
}

/** Sağlayıcıya özel istek: yol, başlıklar ve JSON gövde. */
export interface ProviderRequest {
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface ProviderAdapter {
  build(msg: EmailMessage, opts: HttpTransportOptions): ProviderRequest;
  /** 2xx yanıt gövdesinden ileti kimliği; yoksa `undefined`. */
  messageId(body: unknown): string | undefined;
  /** Gönderen alan adı doğrulanmamış mı (yalnız 400/401/403/422 yanıtında sorulur). */
  senderUnverified(status: number, text: string): boolean;
}

/** HTTP durum kodu -> 045 §6.6 sınıfı. */
export function classifyHttpStatus(status: number): EmailErrorCode {
  if (status === 429) return 'provider_rate_limited';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'provider_unavailable';
  if (status === 401 || status === 403) return 'provider_auth';
  if (status === 413) return 'message_too_large';
  if (status === 400 || status === 422) return 'recipient_rejected';
  return 'payload_invalid';
}

async function readCapped(res: Response): Promise<string> {
  try {
    const buf = await res.arrayBuffer();
    return new TextDecoder().decode(buf.slice(0, MAX_RESPONSE_BYTES));
  } catch {
    return '';
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createHttpTransport(
  adapter: ProviderAdapter,
  opts: HttpTransportOptions,
  fetchImpl: typeof fetch = fetch,
): EmailTransport {
  if (opts.apiKey === '') throw new EmailTransportConfigError('e-posta API anahtarı boş');
  const base = opts.baseUrl.replace(/\/+$/, '');
  return {
    async send(msg) {
      // Başlık enjeksiyonu: satır sonu içeren değer, sağlayıcıya hiç gitmeden reddedilir.
      assertNoCrlf(msg);
      const req = adapter.build(msg, opts);
      let res: Response;
      try {
        res = await fetchImpl(`${base}${req.path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...req.headers,
          },
          body: JSON.stringify(req.body),
          redirect: 'error',
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (err) {
        // Özgün hata (adres/anahtar içerebilir) bilerek taşınmaz; yalnız sınıf.
        const name = (err as { name?: unknown }).name;
        if (name === 'TimeoutError' || name === 'AbortError')
          throw new EmailTransportError('timeout');
        throw new EmailTransportError('provider_unavailable');
      }
      const text = await readCapped(res);
      if (res.ok) {
        const id = adapter.messageId(parseJson(text));
        return { providerMessageId: id ?? msg.headers['Message-ID'] ?? '' };
      }
      if (
        [400, 401, 403, 422].includes(res.status) &&
        adapter.senderUnverified(res.status, text.toLowerCase())
      ) {
        throw new EmailTransportError('sender_unverified');
      }
      throw new EmailTransportError(classifyHttpStatus(res.status));
    },
    close() {},
  };
}
