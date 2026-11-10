// Taşıma arayüzü (045 §8.1). Başlık değerleri sunucu sabitidir; kullanıcı girdisi başlığa girmez.
import type { EmailErrorCode } from '@eda/contracts/notifications';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** `Reply-To`, `Message-ID`, `X-Entity-Ref-ID`, `Auto-Submitted` (045 §8.3). */
  readonly headers: Readonly<Record<string, string>>;
}

export interface EmailTransport {
  send(msg: EmailMessage): Promise<{ readonly providerMessageId: string }>;
  close(): void;
}

/** Sınıflandırılmış taşıma hatası (045 §6.6); mesaj alıcı adresi veya içerik taşımaz. */
export class EmailTransportError extends Error {
  override name = 'EmailTransportError';
  readonly code: EmailErrorCode;
  constructor(code: EmailErrorCode, message = `e-posta gönderilemedi: ${code}`) {
    super(message);
    this.code = code;
  }
}

/** Başlatma hatası (yanlış ortam/taşıma). */
export class EmailTransportConfigError extends Error {
  override name = 'EmailTransportConfigError';
}
