// Şablon kataloğu (045 §7.1, §7.3; 002 §11.11): kod -> sınıf, sürüm, parametre şeması (`.strict()`),
// mühürlü sır anahtarları ve konu üretici. Saf modüldür (React yok); api kuyruğa almada yalnız bunu
// kullanır, gövde render'ı worker'dadır. Parametrelerde serbest metin yoktur (kimlik, kod, sayı, tarih);
// bağlantı belirteci yalnız mühürlü sırlardadır (`sealed_params`). P04a dokuz şablonu içerir; kalan
// 045 §7.3 şablonları P28'de eklenir (kodu katalogda olmayan teslimat `template_unknown`).
import { APPLICATION_REJECT_REASONS, MEMBER_ROLES } from '@eda/contracts/enums';
import type {
  EmailTemplateCode,
  NotificationClass,
  NotificationKind,
} from '@eda/contracts/notifications';
import { z } from 'zod';

/** Konu satırı üst sınırı (045 §7.3; aşarsa şablon testi hata verir, kısaltılmaz). */
export const SUBJECT_MAX_LENGTH = 78;

const IsoDateTime = z.iso.datetime({ offset: true });
const PositiveInt = z.number().int().positive();

export const SECRET_KEYS = ['token'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

export interface TemplateMeta<P extends z.ZodType = z.ZodType> {
  readonly code: EmailTemplateCode;
  /** `YYYY-MM-DD.n`; metin/yapı değişince artar (045 §7.5). */
  readonly version: string;
  readonly class: NotificationClass;
  /** Varsayılan bildirim türü (`email_deliveries.kind`). */
  readonly kind: NotificationKind;
  readonly params: P;
  /** `sealed_params` içinde zorunlu sırlar. */
  readonly secrets: readonly SecretKey[];
  readonly subject: (params: z.infer<P>) => string;
}

function meta<P extends z.ZodType>(m: TemplateMeta<P>): TemplateMeta<P> {
  return m;
}

const VERSION = '2026-10-12.2';

export const FACTOR_KINDS = ['totp', 'passkey'] as const;
export const FACTOR_ACTIONS = ['added', 'removed'] as const;
export const FACTOR_BACKUP_ACTIONS = ['used', 'regenerated'] as const;

export const TEMPLATES = {
  verify_email: meta({
    code: 'verify_email',
    version: VERSION,
    class: 'action',
    kind: 'email_verification',
    params: z.strictObject({ expiresInMin: PositiveInt }),
    secrets: ['token'],
    subject: () => 'E-posta adresinizi doğrulayın',
  }),
  password_reset: meta({
    code: 'password_reset',
    version: VERSION,
    class: 'action',
    kind: 'password_reset',
    params: z.strictObject({ expiresInMin: PositiveInt }),
    secrets: ['token'],
    subject: () => 'Parola sıfırlama talebiniz',
  }),
  invitation: meta({
    code: 'invitation',
    version: VERSION,
    class: 'action',
    kind: 'invitation',
    params: z.strictObject({ role: z.enum(MEMBER_ROLES), expiresInHours: PositiveInt }),
    // Davet kimliği bearer belirteçtir (042 Tuzak 9); yalnız mühürlü sırda taşınır.
    secrets: ['token'],
    subject: () => 'E.D.A. Hukuk: büro daveti',
  }),
  password_changed: meta({
    code: 'password_changed',
    version: VERSION,
    class: 'security',
    kind: 'password_changed',
    params: z.strictObject({ changedAt: IsoDateTime }),
    secrets: [],
    subject: () => 'Güvenlik uyarısı: parolanız değiştirildi',
  }),
  factor_changed: meta({
    code: 'factor_changed',
    version: VERSION,
    class: 'security',
    kind: 'factor_changed',
    params: z.strictObject({
      factor: z.enum(FACTOR_KINDS),
      action: z.enum(FACTOR_ACTIONS),
      changedAt: IsoDateTime,
    }),
    secrets: [],
    subject: (p) =>
      p.factor === 'totp'
        ? `Güvenlik uyarısı: ikinci adım doğrulama ${p.action === 'added' ? 'etkinleştirildi' : 'kaldırıldı'}`
        : `Güvenlik uyarısı: passkey ${p.action === 'added' ? 'eklendi' : 'kaldırıldı'}`,
  }),
  backup_codes_changed: meta({
    code: 'backup_codes_changed',
    version: VERSION,
    class: 'security',
    kind: 'backup_codes_changed',
    params: z.strictObject({
      action: z.enum(FACTOR_BACKUP_ACTIONS),
      changedAt: IsoDateTime,
    }),
    secrets: [],
    subject: (p) =>
      `Güvenlik uyarısı: yedek kod ${p.action === 'used' ? 'kullanıldı' : 'yenilendi'}`,
  }),
  lawyer_application_received: meta({
    code: 'lawyer_application_received',
    version: VERSION,
    class: 'service',
    kind: 'lawyer_application_received',
    params: z.strictObject({ slaBusinessHours: PositiveInt }),
    secrets: [],
    subject: () => 'Meslek başvurunuz alındı',
  }),
  verification_approved: meta({
    code: 'verification_approved',
    version: VERSION,
    class: 'service',
    kind: 'verification_approved',
    params: z.strictObject({ trialDays: PositiveInt, trialCredits: PositiveInt }),
    secrets: [],
    subject: () => 'Meslek başvurunuz onaylandı',
  }),
  verification_rejected: meta({
    code: 'verification_rejected',
    version: VERSION,
    class: 'service',
    kind: 'verification_rejected',
    params: z.strictObject({
      reasonCode: z.enum(APPLICATION_REJECT_REASONS),
      reapplyCooldownHours: PositiveInt,
    }),
    secrets: [],
    subject: () => 'Meslek başvurunuz hakkında',
  }),
  registration_attempt: meta({
    code: 'registration_attempt',
    version: VERSION,
    class: 'security',
    kind: 'registration_attempt',
    params: z.strictObject({ attemptAt: IsoDateTime }),
    secrets: [],
    subject: () => 'Güvenlik uyarısı: e-posta adresinizle kayıt denemesi',
  }),
} as const satisfies Partial<Record<EmailTemplateCode, TemplateMeta>>;

export type CatalogCode = keyof typeof TEMPLATES;
export type TemplateParams<C extends CatalogCode> = z.infer<(typeof TEMPLATES)[C]['params']>;

export function isCatalogCode(code: string): code is CatalogCode {
  return Object.hasOwn(TEMPLATES, code);
}

export function templateMeta(code: CatalogCode): TemplateMeta {
  return TEMPLATES[code] as TemplateMeta;
}

export class TemplateParamsError extends Error {
  override name = 'TemplateParamsError';
}

/** Parametreleri şablon şemasıyla doğrular; hata mesajı değer içermez. */
export function parseTemplateParams<C extends CatalogCode>(
  code: C,
  params: unknown,
): TemplateParams<C> {
  const r = TEMPLATES[code].params.safeParse(params);
  if (!r.success) throw new TemplateParamsError(`şablon parametreleri geçersiz: ${code}`);
  return r.data as TemplateParams<C>;
}
