// Bildirim ve e-posta sözleşmeleri (045 §3, §6.2–§6.3; 002 §11.10–§11.11, §26 madde 86). Tür
// (`NotificationKind`), sınıf, kanal ve şablon kümeleri `enums.ts`'tedir (002 §11 tek kaynak); burada
// sınıf kuralları ve `email.send` iş yükü tanımlanır. `NOTIFICATION_DEFAULTS` (varsayılan kanal matrisi)
// P28 kapsamıdır. `app.notifications.type` kümesi (`NOTIFICATION_TYPES`) bu dosyada değiştirilmez.
import { CONFIG_DEFAULTS } from './config/defaults.ts';
import {
  EMAIL_ERROR_CODES,
  EMAIL_TEMPLATE_CODES,
  type EmailErrorCode,
  type EmailTemplateCode,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CLASSES,
  NOTIFICATION_KINDS,
  type NotificationChannel,
  type NotificationClass,
  type NotificationKind,
} from './enums.ts';

export {
  EMAIL_ERROR_CODES,
  EMAIL_TEMPLATE_CODES,
  type EmailErrorCode,
  type EmailTemplateCode,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CLASSES,
  NOTIFICATION_KINDS,
  type NotificationChannel,
  type NotificationClass,
  type NotificationKind,
};

/** BullMQ önceliği (045 §3.1; küçük sayı önce). */
export const NOTIFICATION_CLASS_PRIORITY: Readonly<Record<NotificationClass, number>> = {
  security: 1,
  deadline: 2,
  action: 3,
  service: 5,
};

/** Adres başı e-posta hız sınırı (`eda:rl:email:<userId>`) yalnız bu sınıflarda (045 §3.1, §6.5). */
export const RATE_LIMITED_EMAIL_CLASSES: readonly NotificationClass[] = ['action', 'service'];

/** Doğrulanmamış alıcıya gidebilen tek şablonlar (045 ilke 9, §6.5). */
export const UNVERIFIED_ALLOWED_TEMPLATES: readonly EmailTemplateCode[] = [
  'verify_email',
  'email_change_confirm',
  'invitation',
];

/** `banned = true` alıcıya gidebilen tek şablon (045 §6.5, KK-045-10). */
export const BANNED_ALLOWED_TEMPLATES: readonly EmailTemplateCode[] = ['account_suspended'];

/**
 * Kimlik belirteci taşıyan şablonlar: iş seçenekleri `removeOnComplete: true`,
 * `removeOnFail: { age: 86400 }` (043 §3.3, §7.4; KK-042-21).
 */
export const TOKEN_BEARING_TEMPLATES: readonly EmailTemplateCode[] = [
  'verify_email',
  'password_reset',
  'invitation',
  'email_change_confirm',
  'account_recovery_ready',
];

/** Kalıcı hata kodları: yeniden denenmez (045 §6.3, §6.6; 002 §17). */
export const PERMANENT_EMAIL_ERRORS: readonly EmailErrorCode[] = [
  'recipient_rejected',
  'recipient_suppressed',
  'message_too_large',
  'template_unknown',
  'payload_invalid',
];

/** `suppressed` nedenleri (045 §6.5, §6.8). */
export const EMAIL_SUPPRESSION_REASONS = [
  'unverified',
  'banned',
  'no_recipient',
] as const satisfies readonly EmailErrorCode[];
export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];

/** `email.send` iş yükü (045 §6.3; 002 §26 madde 86); tanım `jobs/email.ts`. */
export { EmailSendJob } from './jobs/email.ts';

/**
 * Kimlik belirteci taşıyan işin başarısız kümede kalma süresi (043 §3.3, §7.4 `removeOnFail.age`);
 * belge değeridir (belirteç ömrü <= 72 saat), yapılandırma anahtarı yoktur.
 */
export const TOKEN_JOB_FAIL_RETENTION_SEC = 86_400;

export interface EmailJobOptions {
  readonly jobId: string;
  readonly priority: number;
  readonly attempts: number;
  readonly backoff: {
    readonly type: 'exponential';
    readonly delay: number;
    readonly jitter: number;
  };
  readonly removeOnComplete: true | { readonly age: number; readonly count: number };
  readonly removeOnFail: { readonly age: number };
}

/**
 * `email.send` iş seçenekleri (045 §6.3; 043 §7.1, §7.4): `jobId = deliveryId`, öncelik ve deneme
 * sınıfa göre, kimlik şablonlarında tamamlanınca hemen silinir.
 */
export function emailJobOptions(
  deliveryId: string,
  cls: NotificationClass,
  template: EmailTemplateCode,
): EmailJobOptions {
  const critical = cls === 'security' || cls === 'deadline';
  const tokenBearing = TOKEN_BEARING_TEMPLATES.includes(template);
  return {
    jobId: deliveryId,
    priority: NOTIFICATION_CLASS_PRIORITY[cls],
    attempts: critical
      ? CONFIG_DEFAULTS['notifications.criticalAttempts']
      : CONFIG_DEFAULTS['jobs.attempts'],
    backoff: {
      type: 'exponential',
      delay: CONFIG_DEFAULTS['jobs.backoffBaseMs'],
      jitter: CONFIG_DEFAULTS['jobs.backoffJitter'],
    },
    removeOnComplete: tokenBearing
      ? true
      : {
          age: CONFIG_DEFAULTS['jobs.removeOnCompleteAgeSec'],
          count: CONFIG_DEFAULTS['jobs.removeOnCompleteCount'],
        },
    removeOnFail: {
      age: tokenBearing ? TOKEN_JOB_FAIL_RETENTION_SEC : CONFIG_DEFAULTS['jobs.removeOnFailAgeSec'],
    },
  };
}

// --- Tercihler (045 §5; P28 D1) -----------------------------------------------------------------

/** Kullanıcının kanal tercihini değiştirebildiği türler (045 §5.2; V1.1 türleri hariç). */
export const PREFERENCE_KINDS = [
  'reminder',
  'deadline_due',
  'file_ready',
  'file_failed',
  'export_ready',
  'kunye_check_ready',
  'credit_low',
] as const satisfies readonly NotificationKind[];
export type PreferenceKind = (typeof PREFERENCE_KINDS)[number];

/**
 * Türün kanal başına davranışı (045 §5.2 + §5.3): `default` varsayılan açık/kapalı, `locked` kapatılamaz
 * (zorunlu), `editable` kullanıcı tercihiyle değişebilir. Satır yoksa varsayılan geçerlidir; veritabanında
 * tutulmaz (045 §5.1).
 */
export type ChannelRule = {
  readonly default: boolean;
  readonly locked: boolean;
};

export const NOTIFICATION_DEFAULTS: Readonly<
  Record<PreferenceKind, Readonly<Record<NotificationChannel, ChannelRule>>>
> = {
  reminder: {
    in_app: { default: true, locked: true },
    email: { default: false, locked: false },
    push: { default: true, locked: false },
  },
  deadline_due: {
    in_app: { default: true, locked: true },
    email: { default: true, locked: false },
    push: { default: true, locked: false },
  },
  file_ready: {
    in_app: { default: true, locked: false },
    email: { default: false, locked: false },
    push: { default: false, locked: true },
  },
  file_failed: {
    in_app: { default: true, locked: true },
    email: { default: false, locked: false },
    push: { default: false, locked: true },
  },
  export_ready: {
    in_app: { default: true, locked: false },
    email: { default: false, locked: false },
    push: { default: false, locked: true },
  },
  kunye_check_ready: {
    in_app: { default: true, locked: false },
    email: { default: false, locked: false },
    push: { default: false, locked: true },
  },
  credit_low: {
    in_app: { default: true, locked: true },
    email: { default: true, locked: false },
    push: { default: false, locked: true },
  },
};

export type ChannelOverride = {
  readonly kind: PreferenceKind;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
};

export type PreferenceCell = ChannelOverride & { readonly mandatory: boolean };

const isPreferenceKind = (k: string): k is PreferenceKind =>
  (PREFERENCE_KINDS as readonly string[]).includes(k);

/**
 * Bir kanal kullanıcı tarafından değiştirilebilir mi? Kilitli kanal (zorunlu açık ya da bu türde
 * desteklenmeyen kapalı) değiştirilemez. Kilitli ve varsayılanı kapalı olan hücre "desteklenmiyor"dur.
 */
export function isChannelEditable(kind: PreferenceKind, channel: NotificationChannel): boolean {
  return !NOTIFICATION_DEFAULTS[kind][channel].locked;
}

/** Tür × kanal matrisi: varsayılan + kullanıcı geçersiz kılmaları + zorunlu kanallar (045 §5.1); desteklenmeyen kanal yok. */
export function preferenceMatrix(overrides: readonly ChannelOverride[]): PreferenceCell[] {
  const set = new Map<string, boolean>();
  for (const o of overrides) set.set(`${o.kind}:${o.channel}`, o.enabled);
  const cells: PreferenceCell[] = [];
  for (const kind of PREFERENCE_KINDS) {
    for (const channel of NOTIFICATION_CHANNELS) {
      const rule = NOTIFICATION_DEFAULTS[kind][channel];
      // Bu türde hiç kullanılmayan kanal (kilitli ve kapalı) matriste görünmez.
      if (rule.locked && !rule.default) continue;
      const own = set.get(`${kind}:${channel}`);
      cells.push({
        kind,
        channel,
        // Kilitli hücre her zaman varsayılanıdır (zorunlu açık / desteklenmeyen kapalı).
        enabled: rule.locked ? rule.default : (own ?? rule.default),
        mandatory: rule.locked,
      });
    }
  }
  return cells;
}

/**
 * Gönderim anı kanal çözümü (045 §5.1): tercih matrisi, ardından abonelik ve doğrulama kapıları.
 * Tercih matrisinde olmayan türlerde (güvenlik/eylem sınıfı vb.) kanal listesini üretici verir; bu
 * işlev yalnız değiştirilebilir türleri çözer.
 */
export function resolveChannels(input: {
  readonly kind: PreferenceKind;
  readonly overrides: readonly ChannelOverride[];
  readonly hasPushSubscription: boolean;
  readonly emailVerified: boolean;
}): NotificationChannel[] {
  const out: NotificationChannel[] = [];
  for (const cell of preferenceMatrix(input.overrides)) {
    if (cell.kind !== input.kind || !cell.enabled) continue;
    if (cell.channel === 'push' && !input.hasPushSubscription) continue;
    if (cell.channel === 'email' && !input.emailVerified) continue;
    out.push(cell.channel);
  }
  return out;
}

/** Kullanıcı girdisini doğrular: bilinmeyen tür, kilitli/desteklenmeyen kanal → neden kodu. */
export type OverrideProblem = 'kind_unknown' | 'channel_mandatory';

export function overrideProblem(o: {
  readonly kind: string;
  readonly channel: NotificationChannel;
}): OverrideProblem | null {
  if (!isPreferenceKind(o.kind)) return 'kind_unknown';
  return isChannelEditable(o.kind, o.channel) ? null : 'channel_mandatory';
}
