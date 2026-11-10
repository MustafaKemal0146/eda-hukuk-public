// `@eda/db/email` (045 §6.2, §6.5, §13): e-posta outbox erişimi. Yazma yolu yalnız
// `app.email_enqueue()` (SECURITY DEFINER, 0026); `eda_app` tabloya doğrudan yazamaz. Worker satırı
// önce `app.email_delivery_route()` ile yönlendirir (`withNoTenant('notification_route')`), sonra alıcı
// bağlamında (`withUserScope`) okur ve günceller (`email_deliveries` RLS: alıcı bağı). Sorgular
// parametrelidir; içerik (konu, gövde, alıcı adresi) bu tabloda tutulmaz.
import type { NoTenantTx, TenantTx, UserTx } from './tenant.ts';

type AnyTx = TenantTx | UserTx | NoTenantTx;

export interface EnqueueEmailRow {
  /** Teslimat kimliği (mühür AAD'si için önceden üretilir); yoksa DB uuidv7() üretir. */
  readonly id?: string;
  readonly kind: string;
  readonly template: string;
  readonly templateVersion: string;
  readonly class: 'security' | 'deadline' | 'action' | 'service';
  readonly userId: string | null;
  readonly orgId: string | null;
  readonly invitationId: string | null;
  readonly dedupeKey: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly sealed: Buffer | null;
  readonly expiresAt: Date;
}

/** `app.email_enqueue`; `dedupe_key` çakışmasında `null` (045 §6.2 madde 1). */
export async function enqueueEmailRow(tx: AnyTx, row: EnqueueEmailRow): Promise<string | null> {
  const r = await tx.query<{ id: string | null }>(
    `SELECT app.email_enqueue($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12) AS id`,
    [
      row.kind,
      row.template,
      row.templateVersion,
      row.class,
      row.userId,
      row.orgId,
      row.invitationId,
      row.dedupeKey,
      JSON.stringify(row.params),
      row.sealed,
      row.expiresAt,
      row.id ?? null,
    ],
  );
  return r.rows[0]?.id ?? null;
}

export interface DeliveryRoute {
  readonly userId: string | null;
  readonly orgId: string | null;
}

/** Teslimatın alıcı kimlikleri (yalnız `eda_worker`; satır yoksa `null`). */
export async function routeDelivery(tx: NoTenantTx, id: string): Promise<DeliveryRoute | null> {
  const r = await tx.query<{ user_id: string | null; org_id: string | null }>(
    'SELECT user_id, org_id FROM app.email_delivery_route($1)',
    [id],
  );
  const row = r.rows[0];
  return row === undefined ? null : { userId: row.user_id, orgId: row.org_id };
}

export const DELIVERY_STATUSES_FINAL = [
  'sent',
  'cancelled',
  'expired',
  'suppressed',
  'failed',
] as const;

export interface DeliveryRow {
  readonly id: string;
  readonly orgId: string | null;
  readonly userId: string | null;
  readonly invitationId: string | null;
  readonly kind: string;
  readonly templateCode: string;
  readonly templateVersion: string;
  readonly class: 'security' | 'deadline' | 'action' | 'service';
  readonly params: Readonly<Record<string, unknown>>;
  readonly sealedParams: Buffer | null;
  readonly expiresAt: Date;
  readonly status: string;
  readonly attempts: number;
}

/** Satırı kilitleyerek okur (`FOR UPDATE`; alıcı bağlamında). Görünmüyorsa `null`. */
export async function lockDelivery(tx: TenantTx | UserTx, id: string): Promise<DeliveryRow | null> {
  const r = await tx.query<{
    id: string;
    org_id: string | null;
    user_id: string | null;
    invitation_id: string | null;
    kind: string;
    template_code: string;
    template_version: string;
    class: DeliveryRow['class'];
    params: Record<string, unknown>;
    sealed_params: Buffer | null;
    expires_at: Date;
    status: string;
    attempts: number;
  }>(
    `SELECT id, org_id, user_id, invitation_id, kind, template_code, template_version, class,
            params, sealed_params, expires_at, status, attempts
     FROM app.email_deliveries WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const d = r.rows[0];
  return d === undefined
    ? null
    : {
        id: d.id,
        orgId: d.org_id,
        userId: d.user_id,
        invitationId: d.invitation_id,
        kind: d.kind,
        templateCode: d.template_code,
        templateVersion: d.template_version,
        class: d.class,
        params: d.params,
        sealedParams: d.sealed_params,
        expiresAt: d.expires_at,
        status: d.status,
        attempts: d.attempts,
      };
}

export type DeliveryUpdate =
  | { readonly status: 'sending' }
  | { readonly status: 'sent'; readonly providerMessageId: string }
  | { readonly status: 'queued'; readonly errorCode: string }
  | {
      readonly status: 'failed' | 'suppressed' | 'expired';
      readonly errorCode: string | null;
    };

/**
 * Durum geçişi. `sending` denemeyi artırır; nihai durumlarda (`sent`, `failed`, `suppressed`,
 * `expired`) mühürlü parametre NULL'lanır (045 §6.2 madde 3).
 */
export async function updateDelivery(
  tx: TenantTx | UserTx,
  id: string,
  u: DeliveryUpdate,
): Promise<void> {
  switch (u.status) {
    case 'sending':
      await tx.query(
        `UPDATE app.email_deliveries SET status = 'sending', attempts = attempts + 1 WHERE id = $1`,
        [id],
      );
      return;
    case 'sent':
      await tx.query(
        `UPDATE app.email_deliveries SET status = 'sent', provider_message_id = $2, sent_at = now(),
                sealed_params = NULL, error_code = NULL WHERE id = $1`,
        [id, u.providerMessageId],
      );
      return;
    case 'queued':
      await tx.query(
        `UPDATE app.email_deliveries SET status = 'queued', error_code = $2 WHERE id = $1`,
        [id, u.errorCode],
      );
      return;
    default:
      await tx.query(
        `UPDATE app.email_deliveries SET status = $2, error_code = $3, sealed_params = NULL
         WHERE id = $1`,
        [id, u.status, u.errorCode],
      );
  }
}
