// Bildirim tercih matrisi modeli (P28 D1 web dilimi; 053-08 §8.2): `GET|PUT /notifications/preferences`
// yanıtından görünüm kararlarını türetir. Ağ erişimi ve React YOK: testler saf işlevleri çağırır.
import type { PreferenceCellDtoValue } from '@eda/contracts/api/notification-preferences';
import { NOTIFICATION_CHANNELS } from '@eda/contracts/enums';
import { PREFERENCE_KINDS } from '@eda/contracts/notifications';

export type NotificationCell = PreferenceCellDtoValue;
export type PreferenceKindValue = NotificationCell['kind'];
export type NotificationChannelValue = NotificationCell['channel'];

export { NOTIFICATION_CHANNELS, PREFERENCE_KINDS };

/** Yalnız büro sahibi ve yöneticisi görür (053-08 §8.2). */
const OWNER_ADMIN_ONLY: readonly PreferenceKindValue[] = ['credit_low'];

/** Rol bu satırı görür mü? Etkin büro yoksa (rol `null`) yalnız herkese açık satırlar görünür. */
export function kindVisible(kind: PreferenceKindValue, role: string | null): boolean {
  if (!OWNER_ADMIN_ONLY.includes(kind)) return true;
  return role === 'owner' || role === 'admin';
}

export function visibleKinds(role: string | null): PreferenceKindValue[] {
  return PREFERENCE_KINDS.filter((kind) => kindVisible(kind, role));
}

/** Matriste olmayan hücre (bu türde kullanılmayan kanal) `undefined` döner. */
export function cellOf(
  cells: readonly NotificationCell[],
  kind: PreferenceKindValue,
  channel: NotificationChannelValue,
): NotificationCell | undefined {
  return cells.find((c) => c.kind === kind && c.channel === channel);
}

/** İyimser güncelleme: yalnız değiştirilebilir hücre çevrilir, zorunlu hücreye dokunulmaz. */
export function withCell(
  cells: readonly NotificationCell[],
  kind: PreferenceKindValue,
  channel: NotificationChannelValue,
  enabled: boolean,
): NotificationCell[] {
  return cells.map((c) =>
    c.kind === kind && c.channel === channel && !c.mandatory ? { ...c, enabled } : c,
  );
}

/** Hücre kullanıcı tarafından değiştirilebilir mi? E-posta doğrulanmadıysa e-posta hücresi kilitlidir. */
export function cellEditable(cell: NotificationCell, emailVerified: boolean): boolean {
  if (cell.mandatory) return false;
  if (cell.channel === 'email' && !emailVerified) return false;
  return true;
}

export type NotificationsLoadState = 'loading' | 'ready' | 'error';

/** Kaydetme hatasının kullanıcıya gösterilecek türü. */
export type SaveProblem = 'mandatory' | 'failed';

export function saveProblemOf(status: number, reason: string | null): SaveProblem {
  return status === 422 && reason === 'channel_mandatory' ? 'mandatory' : 'failed';
}
