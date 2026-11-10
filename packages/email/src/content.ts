// Şablon içerik modeli: HTML (React bileşenleri) ve düz metin aynı bloklardan üretilir; böylece iki
// sürüm aynı bilgiyi taşır (045 §7.2). Bağlantılar yalnız `links.ts` çıktısıdır.
import type { NotificationClass } from '@eda/contracts/notifications';

export type Block =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'keyValue'; readonly items: readonly (readonly [string, string])[] }
  | { readonly kind: 'notice'; readonly text: string }
  /** `action` sınıfı: tek düğme + aynı bağlantının metin hâli. */
  | { readonly kind: 'button'; readonly label: string; readonly href: string }
  /** `service` sınıfı: en çok bir kimlikli yol bağlantısı. */
  | { readonly kind: 'link'; readonly label: string; readonly href: string };

export interface EmailContent {
  readonly class: NotificationClass;
  readonly heading: string;
  readonly greetingName: string | null;
  readonly blocks: readonly Block[];
  /** Alt bilgi metni; yoksa `FOOTER` (kullanıcı bildirimi). İç işletim uyarıları kendi metnini verir. */
  readonly footer?: string;
}

/** Yapı sırası ve ortak metinler (045 §4.2, §7.2). */
export const NO_LINK_NOTICE =
  "Bu iletide bağlantı yoktur. E.D.A. Hukuk'u kendi yer iminizden veya tarayıcınıza adresi elle yazarak açın.";
export const NO_ACTION = 'İşlem gerekmez.';
export const FOOTER =
  'Bu ileti E.D.A. Hukuk hizmetiyle ilgili bilgilendirmedir. Bildirim tercihlerinizi uygulamada Ayarlar > Bildirimler bölümünden değiştirebilirsiniz. Sorularınız için bu iletiyi yanıtlayabilirsiniz.';
export const SECURITY_FOOTER =
  'E.D.A. Hukuk sizden e-posta ile parola, doğrulama kodu veya kimlik bilgisi istemez.';

export function greeting(name: string | null): string {
  return name === null || name.trim() === '' ? 'Merhaba,' : `Merhaba ${name.trim()},`;
}

/** Render bağlamı: alıcı adı ve mühürlü sırlar worker'da çözülür; parametrelerde yoktur. */
export interface RenderContext {
  /** `APP_URL` (https kökü). */
  readonly appUrl: string;
  /** Alıcının kendi görünen adı (yalnız selamlama; 045 §4.1). */
  readonly recipientName: string | null;
  /** Açılmış `sealed_params` (ör. `token`). */
  readonly secrets: Readonly<Record<string, string>>;
  /** Şirket unvanı (045 Açık Sorular 6); yoksa alt bilgide satır yok. */
  readonly companyName: string | null;
  /** Davet bağlamı (P04b): büro adı ve davet eden adı alıcı çözümünde okunur. */
  readonly invitation?: { readonly orgName: string; readonly inviterName: string };
}

/** Rol arayüz adları (003 §4.3). */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: 'Yönetici Ortak',
  admin: 'Büro Yöneticisi',
  senior_lawyer: 'Kıdemli Avukat',
  lawyer: 'Avukat',
  trainee: 'Stajyer Avukat',
  assistant: 'Hukuk Asistanı',
};

export class MissingSecretError extends Error {
  override name = 'MissingSecretError';
}

export function secret(ctx: RenderContext, key: string): string {
  const v = ctx.secrets[key];
  if (v === undefined || v === '') throw new MissingSecretError(`mühürlü sır eksik: ${key}`);
  return v;
}
