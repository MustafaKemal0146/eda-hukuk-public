// Taşıma seçimi (045 §8.1, §8.4; KK-045-15). `smtp` yalnız `development`/`test`; diğer ortamlarda
// başlatma hatasıdır (env şeması da reddeder, bu ikinci savunmadır). `http`: `EMAIL_API_URL`
// ana bilgisayarına göre Resend veya Brevo adaptörü; istek süreç ortamındaki `HTTPS_PROXY`
// (`egress-llm`, NODE_USE_ENV_PROXY=1) üzerinden gider, kodda vekil yoktur.
import { createHttpEmailTransport } from './http/index.ts';
import { createSmtpTransport } from './smtp.ts';
import { type EmailTransport, EmailTransportConfigError } from './types.ts';

export {
  createHttpEmailTransport,
  HTTP_PROVIDERS,
  type HttpProvider,
  providerFromApiUrl,
} from './http/index.ts';
export { assertNoCrlf, classifySmtpError, createSmtpTransport } from './smtp.ts';
export {
  type EmailMessage,
  type EmailTransport,
  EmailTransportConfigError,
  EmailTransportError,
} from './types.ts';

export const SMTP_ALLOWED_ENVS = ['development', 'test'] as const;

export interface TransportConfig {
  readonly edaEnv: string;
  readonly transport: 'smtp' | 'http';
  readonly smtpUrl?: string | undefined;
  /** `EMAIL_API_URL` (yalnız `http`). */
  readonly apiUrl?: string | undefined;
  /** Sağlayıcı API anahtarı değeri (`EMAIL_API_KEY_FILE` içeriği; yalnız `http`). */
  readonly apiKey?: string | undefined;
  readonly from: string;
  readonly timeoutMs: number;
}

export function createEmailTransport(cfg: TransportConfig): EmailTransport {
  if (cfg.transport === 'http') {
    if (cfg.apiUrl === undefined || cfg.apiUrl === '') {
      throw new EmailTransportConfigError('EMAIL_API_URL gerekli');
    }
    if (cfg.apiKey === undefined || cfg.apiKey === '') {
      throw new EmailTransportConfigError('e-posta API anahtarı (EMAIL_API_KEY_FILE) boş');
    }
    return createHttpEmailTransport({
      baseUrl: cfg.apiUrl,
      apiKey: cfg.apiKey,
      from: cfg.from,
      timeoutMs: cfg.timeoutMs,
    });
  }
  if (!(SMTP_ALLOWED_ENVS as readonly string[]).includes(cfg.edaEnv)) {
    throw new EmailTransportConfigError(
      `EMAIL_TRANSPORT=smtp yalnız development ve test ortamında kullanılabilir (EDA_ENV=${cfg.edaEnv})`,
    );
  }
  if (cfg.smtpUrl === undefined || cfg.smtpUrl === '') {
    throw new EmailTransportConfigError('SMTP_URL gerekli');
  }
  return createSmtpTransport({ url: cfg.smtpUrl, from: cfg.from, timeoutMs: cfg.timeoutMs });
}
