// Denetim ekranı modeli: filtre -> sorgu dizesi, olay türü gruplama, meta veri satırları ve hata özeti
// kaynak etiketleri. Saf işlevler (React yok); olay türleri 002 §22 kataloğundan gelir.
import type { AuditErrorSource, AuditEventDtoValue } from '@eda/contracts/api/admin-audit';
import { AUDIT_ERROR_SOURCES } from '@eda/contracts/api/admin-audit';
import { AUDIT_ACTIONS, type AuditAction } from '@eda/contracts/audit-events';
import { AUDIT_ACTOR_TYPES } from '@eda/contracts/enums';

export type { AuditAction, AuditErrorSource };
export { AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ERROR_SOURCES };

export interface AuditFilters {
  readonly action: string;
  readonly actorType: string;
  readonly from: string;
  readonly to: string;
}

export const EMPTY_FILTERS: AuditFilters = { action: '', actorType: '', from: '', to: '' };

/** Olay kodunun ilk parçası; grup etiketi `audit.group.<grup>` katalog anahtarıdır. */
export function groupOf(action: string): string {
  return action.split('.')[0] ?? action;
}

export const AUDIT_GROUPS: readonly string[] = [...new Set(AUDIT_ACTIONS.map(groupOf))];

/** Dolu filtreleri sorgu dizesine çevirir. Tarih aralığı yalnız ikisi birden doluysa gönderilir. */
export function buildEventsQuery(f: AuditFilters, cursor?: string): URLSearchParams {
  const q = new URLSearchParams();
  if (f.action !== '') q.set('action', f.action);
  if (f.actorType !== '') q.set('actorType', f.actorType);
  if (f.from !== '' && f.to !== '') {
    q.set('from', f.from);
    q.set('to', f.to);
  }
  if (cursor !== undefined) q.set('cursor', cursor);
  return q;
}

export const isRangeIncomplete = (f: AuditFilters): boolean => (f.from === '') !== (f.to === '');

export const isRangeInverted = (f: AuditFilters): boolean =>
  f.from !== '' && f.to !== '' && f.from > f.to;

/** Meta veri satırları: anahtar sırası sabittir (okunabilirlik), değer metne çevrilir. */
export function metadataRows(m: AuditEventDtoValue['metadata']): { key: string; value: string }[] {
  return Object.entries(m)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value: String(value) }));
}

export const SOURCE_FIELD: Record<AuditErrorSource, 'aiUsage' | 'authFailure' | 'emailDelivery'> = {
  ai_usage: 'aiUsage',
  auth_failure: 'authFailure',
  email_delivery: 'emailDelivery',
};

/** Yönetim girişi başarısızlık nedenleri (`audit.loginFailures.reason.*` katalog anahtarları). */
export const LOGIN_FAILURE_REASONS = [
  'invalid_credentials',
  'backoff',
  'passkey',
  'totp_invalid',
  'step_up_totp',
  'enroll_invalid',
] as const;

/** Bilinmeyen neden kodu `other` olur (katalogda karşılığı olmayan anahtar çizilmez). */
export function loginReasonKey(key: string): (typeof LOGIN_FAILURE_REASONS)[number] | 'other' {
  return (LOGIN_FAILURE_REASONS as readonly string[]).includes(key)
    ? (key as (typeof LOGIN_FAILURE_REASONS)[number])
    : 'other';
}
