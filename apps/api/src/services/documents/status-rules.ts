// Belge durum kuralları (054 §10.4; 041 §5.4; P17b.5). Saf ve tablo bazlıdır: servis ve testler aynı
// tabloyu kullanır. `exported` yalnız dışa aktarım (P19) tarafından, `review_pending` V1.1 onay
// akışıyla yazılır; istemci PATCH'i bu iki değeri reddeder.
import type { DocumentStatus } from '@eda/contracts/enums';

/** Taslak yazımına/sürüm geri yüklemesine açık durumlar (054 §10.4). */
const WRITABLE: ReadonlySet<DocumentStatus> = new Set(['draft', 'approved', 'exported']);

export type LockReason = 'status_locked' | 'archived';

/** Yazılamayan durum için `DOC_LOCKED` nedeni; yazılabilirse `null`. */
export function contentLockReason(status: DocumentStatus): LockReason | null {
  if (WRITABLE.has(status)) return null;
  return status === 'archived' ? 'archived' : 'status_locked';
}

/** İlk içerik değişikliğinde durumu `draft`a döndüren durumlar (onay/dışa aktarım geçersizleşir). */
export function resetsToDraftOnEdit(status: DocumentStatus): boolean {
  return status === 'approved' || status === 'exported';
}

export const CLIENT_STATUS_TARGETS = ['draft', 'approved', 'filed_declared', 'archived'] as const;
export type ClientStatusTarget = (typeof CLIENT_STATUS_TARGETS)[number];

const TRANSITIONS: Readonly<Record<ClientStatusTarget, readonly DocumentStatus[]>> = {
  // Beyan alanları: geri alma da kullanıcı beyanı olduğundan `confirm` ister (054 §10.4).
  filed_declared: ['draft', 'approved', 'exported'],
  archived: ['draft', 'approved', 'exported'],
  approved: ['draft', 'exported'],
  draft: ['filed_declared', 'archived', 'approved'],
};

export type TransitionVerdict =
  | { ok: true; needsConfirm: boolean; needsApprovePermission: boolean }
  | { ok: false; reason: 'invalid_target' | 'not_allowed' };

export function planTransition(from: DocumentStatus, to: DocumentStatus): TransitionVerdict {
  if (!(CLIENT_STATUS_TARGETS as readonly string[]).includes(to)) {
    return { ok: false, reason: 'invalid_target' };
  }
  const target = to as ClientStatusTarget;
  if (!TRANSITIONS[target].includes(from)) return { ok: false, reason: 'not_allowed' };
  return {
    ok: true,
    needsConfirm: target === 'filed_declared' || from === 'filed_declared',
    needsApprovePermission: target === 'approved',
  };
}
