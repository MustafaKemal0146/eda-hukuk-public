// `email.send` işleyicisi (045 §6.5–§6.6; 043 §7.2). Adımlar:
//  1. Satır `app.email_delivery_route` ile yönlendirilir, alıcı bağlamında (`withUserScope`) kilitlenerek
//     okunur; nihai durumdaysa çıkılır; süresi geçmişse `expired` + `sealed_params = NULL`.
//  2. Alıcı kolon kısıtlı okunur; doğrulanmamış alıcıya yalnız izinli şablonlar, yasaklıya yalnız
//     `account_suspended` gider (aksi `suppressed`). Davet e-postasında satırın kullanıcısı davet
//     edendir; alıcı adresi davet edenin bağlamında davet tablosunun e-posta kolonundan'den çözülür, davet artık
//     bekliyor değilse `suppressed('no_recipient')` (P04b; kapanışı).
//  3. `action`/`service` sınıfında adres başı saatlik sınır (`eda:rl:email:<userId>`); aşımda iş 5 dk
//     ertelenir, deneme sayılmaz.
//  4. `sending` + `attempts += 1` kısa işlemde; ağ çağrısı DB işlemi DIŞINDA yapılır.
//  5. Mühür açılır, şablon render edilir; 6. taşıma (`notifications.emailTimeoutMs`);
//  7. başarı `sent` (+ mühür NULL); kalıcı hata `failed`; geçici hata `queued` + üstel yeniden deneme,
//     son denemede `failed`.
// Günlük ve metrikte alıcı adresi, ad, belirteç ve içerik YOKTUR; yalnız teslimat kimliği, şablon,
// sınıf ve kod.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import {
  BANNED_ALLOWED_TEMPLATES,
  type EmailErrorCode,
  type EmailTemplateCode,
  PERMANENT_EMAIL_ERRORS,
  RATE_LIMITED_EMAIL_CLASSES,
  UNVERIFIED_ALLOWED_TEMPLATES,
} from '@eda/contracts/notifications';
import { CryptoError, unsealJobParams } from '@eda/crypto';
import type { NoTenantTx, UserTx } from '@eda/db';
import { getEmailRecipient, getInvitationRecipient } from '@eda/db';
import { lockDelivery, routeDelivery, updateDelivery } from '@eda/db/email';
import { isCatalogCode, TemplateParamsError } from '@eda/email/catalog';
import { type RenderedEmail, renderEmail, TemplateUnknownError } from '@eda/email/render';
import { type EmailTransport, EmailTransportError } from '@eda/email/transport';
import type { EdaLogger } from '@eda/observability/logger';
import type { Metrics } from '../../metrics.ts';

/** Hız sınırı aşımında erteleme (045 §6.5 adım 3: "5 dk"); belge değeridir. */
export const RATE_LIMIT_DEFER_MS = 5 * 60_000;

export interface EmailDb {
  withNoTenant<T>(reason: 'notification_route', fn: (tx: NoTenantTx) => Promise<T>): Promise<T>;
  withUserScope<T>(ctx: { userId: string }, fn: (tx: UserTx) => Promise<T>): Promise<T>;
}

/** Adres başı sayaç (Valkey `eda:rl:email:<userId>`; pencere 1 saat). */
export interface EmailRateCounter {
  /** Sayaç değeri (artırılmış); pencere ilk artışta başlar. */
  hit(userId: string): Promise<number>;
}

export interface EmailSendDeps {
  readonly db: EmailDb;
  readonly kek: Uint8Array;
  readonly transport: EmailTransport;
  readonly rate: EmailRateCounter;
  readonly logger: EdaLogger;
  readonly metrics: Metrics;
  readonly appUrl: string;
  /** `Message-ID` ve `Reply-To` alan adı (`APP_DOMAIN`). */
  readonly appDomain: string;
  readonly companyName: string | null;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

export interface EmailSendJobView {
  readonly deliveryId: string;
  /** Bu çalıştırma son deneme mi (geçici hatada `failed` yazılır). */
  readonly lastAttempt: boolean;
}

export type EmailSendOutcome =
  | { readonly status: 'sent' }
  | { readonly status: 'skipped'; readonly reason: 'gone' | 'final' | 'no_route' }
  | { readonly status: 'expired' }
  | { readonly status: 'suppressed'; readonly reason: EmailErrorCode }
  | { readonly status: 'failed'; readonly code: EmailErrorCode }
  | { readonly status: 'deferred'; readonly untilMs: number };

/** Geçici hata: çağıran BullMQ yeniden denemesi için fırlatır. */
export class EmailRetryableError extends Error {
  override name = 'EmailRetryableError';
  readonly code: EmailErrorCode;
  constructor(code: EmailErrorCode) {
    super(`e-posta geçici hata: ${code}`);
    this.code = code;
  }
}

const FINAL = new Set(['sent', 'cancelled', 'expired', 'suppressed', 'failed']);

function isPermanent(code: EmailErrorCode): boolean {
  return PERMANENT_EMAIL_ERRORS.includes(code);
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EmailTransportError('timeout')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function processEmailSend(
  job: EmailSendJobView,
  deps: EmailSendDeps,
): Promise<EmailSendOutcome> {
  const now = deps.now ?? (() => new Date());
  const id = job.deliveryId;
  const route = await deps.db.withNoTenant('notification_route', (tx) => routeDelivery(tx, id));
  if (route === null) return { status: 'skipped', reason: 'gone' };
  // Kullanıcı bağı olmayan satır yönlendirilemez (davet satırlarında `user_id` davet edendir).
  if (route.userId === null) return { status: 'skipped', reason: 'no_route' };
  const userId = route.userId;

  const log = (event: 'email.sent' | 'email.failed' | 'email.suppressed', extra: object) =>
    deps.logger.info({ event, deliveryId: id, ...extra });

  type Phase =
    | { kind: 'done'; outcome: EmailSendOutcome }
    | {
        kind: 'send';
        template: EmailTemplateCode & string;
        cls: 'security' | 'deadline' | 'action' | 'service';
        params: Readonly<Record<string, unknown>>;
        sealed: Buffer | null;
        recipient: { email: string; name: string | null };
      };

  const phase = await deps.db.withUserScope({ userId }, async (tx): Promise<Phase> => {
    const d = await lockDelivery(tx, id);
    if (d === null) return { kind: 'done', outcome: { status: 'skipped', reason: 'gone' } };
    if (FINAL.has(d.status))
      return { kind: 'done', outcome: { status: 'skipped', reason: 'final' } };
    const labels = { template: d.templateCode, class: d.class };
    if (now().getTime() > d.expiresAt.getTime()) {
      await updateDelivery(tx, id, { status: 'expired', errorCode: null });
      deps.metrics.inc('eda_email_suppressed_total', { reason: 'expired' });
      log('email.suppressed', { ...labels, reason: 'expired' });
      return { kind: 'done', outcome: { status: 'expired' } };
    }
    if (!isCatalogCode(d.templateCode)) {
      await updateDelivery(tx, id, { status: 'failed', errorCode: 'template_unknown' });
      deps.metrics.inc('eda_email_failed_total', { ...labels, error_code: 'template_unknown' });
      log('email.failed', { ...labels, errorCode: 'template_unknown' });
      return { kind: 'done', outcome: { status: 'failed', code: 'template_unknown' } };
    }
    const template = d.templateCode as EmailTemplateCode;
    const r = await getEmailRecipient(tx, userId);
    let to: { email: string; name: string | null } | null =
      r === null ? null : { email: r.email, name: r.name };
    if (template === 'invitation' && d.invitationId !== null) {
      const inv = await getInvitationRecipient(tx, d.invitationId);
      to = inv !== null && inv.status === 'pending' ? { email: inv.email, name: null } : null;
    }
    let suppress: EmailErrorCode | null = null;
    if (r === null || to === null) suppress = 'no_recipient';
    else if (r.banned && !BANNED_ALLOWED_TEMPLATES.includes(template)) suppress = 'banned';
    else if (!r.emailVerified && !UNVERIFIED_ALLOWED_TEMPLATES.includes(template)) {
      suppress = 'unverified';
    }
    if (suppress !== null || to === null) {
      const reason = suppress ?? 'no_recipient';
      await updateDelivery(tx, id, { status: 'suppressed', errorCode: reason });
      deps.metrics.inc('eda_email_suppressed_total', { reason });
      log('email.suppressed', { ...labels, reason });
      return { kind: 'done', outcome: { status: 'suppressed', reason } };
    }
    return {
      kind: 'send',
      template: d.templateCode,
      cls: d.class,
      params: d.params,
      sealed: d.sealedParams,
      recipient: to,
    };
  });
  if (phase.kind === 'done') return phase.outcome;

  const labels = { template: phase.template, class: phase.cls };
  if (RATE_LIMITED_EMAIL_CLASSES.includes(phase.cls)) {
    const n = await deps.rate.hit(userId);
    if (n > CONFIG_DEFAULTS['notifications.emailPerAddressPerHour']) {
      return { status: 'deferred', untilMs: now().getTime() + RATE_LIMIT_DEFER_MS };
    }
  }

  await deps.db.withUserScope({ userId }, (tx) => updateDelivery(tx, id, { status: 'sending' }));

  const finish = async (code: EmailErrorCode, permanent: boolean): Promise<EmailSendOutcome> => {
    if (permanent || job.lastAttempt) {
      await deps.db.withUserScope({ userId }, (tx) =>
        updateDelivery(tx, id, { status: 'failed', errorCode: code }),
      );
      deps.metrics.inc('eda_email_failed_total', { ...labels, error_code: code });
      log('email.failed', { ...labels, errorCode: code });
      return { status: 'failed', code };
    }
    await deps.db.withUserScope({ userId }, (tx) =>
      updateDelivery(tx, id, { status: 'queued', errorCode: code }),
    );
    throw new EmailRetryableError(code);
  };

  let rendered: RenderedEmail;
  try {
    const secrets =
      phase.sealed === null
        ? {}
        : unsealJobParams(
            deps.kek,
            { deliveryId: id, template: phase.template, userId },
            phase.sealed,
          );
    rendered = await renderEmail(phase.template, phase.params, {
      appUrl: deps.appUrl,
      recipientName: phase.recipient.name,
      secrets,
      companyName: deps.companyName,
    });
  } catch (err) {
    if (err instanceof TemplateUnknownError) return finish('template_unknown', true);
    if (err instanceof CryptoError || err instanceof TemplateParamsError || err instanceof Error) {
      return finish('payload_invalid', true);
    }
    throw err;
  }

  try {
    const res = await withTimeout(
      deps.transport.send({
        to: phase.recipient.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: {
          'Reply-To': `destek@${deps.appDomain}`,
          'Message-ID': `<${id}@${deps.appDomain}>`,
          'X-Entity-Ref-ID': id,
          'Auto-Submitted': 'auto-generated',
        },
      }),
      deps.timeoutMs ?? CONFIG_DEFAULTS['notifications.emailTimeoutMs'],
    );
    await deps.db.withUserScope({ userId }, (tx) =>
      updateDelivery(tx, id, { status: 'sent', providerMessageId: res.providerMessageId }),
    );
    deps.metrics.inc('eda_email_sent_total', labels);
    log('email.sent', labels);
    return { status: 'sent' };
  } catch (err) {
    const code: EmailErrorCode =
      err instanceof EmailTransportError ? err.code : 'provider_unavailable';
    return finish(code, isPermanent(code));
  }
}
