// Duyuru formu modeli (saf): form değerlerini `CreateAnnouncementInput` / `UpdateAnnouncementInput`
// sözleşmesine çevirir ve aynı Zod şemasıyla doğrular (sunucu yine doğrular). Tarih alanları yerel
// `datetime-local` biçimindedir; API'ye mutlak (ISO, ofsetli) gider. Bildirim özeti için tarih aralığı yardımcıları.
import {
  type AdminAnnouncementDtoValue,
  CreateAnnouncementInput,
  type CreateAnnouncementInputValue,
  UpdateAnnouncementInput,
  type UpdateAnnouncementInputValue,
} from '@eda/contracts/api/admin-announcements';

export interface AnnouncementForm {
  severity: AdminAnnouncementDtoValue['severity'];
  audience: AdminAnnouncementDtoValue['audience'];
  title: string;
  body: string;
  /** `datetime-local` değeri (`YYYY-MM-DDTHH:mm`) veya boş (şimdi). */
  activeFrom: string;
  /** `datetime-local` değeri veya boş (süresiz). */
  activeUntil: string;
}

export type FormField = 'severity' | 'audience' | 'title' | 'body' | 'activeFrom' | 'activeUntil';
export type FormResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly field: FormField };

export const EMPTY_FORM: AnnouncementForm = {
  severity: 'info',
  audience: 'all',
  title: '',
  body: '',
  activeFrom: '',
  activeUntil: '',
};

/** Yerel `datetime-local` değerini ISO (ofsetli) metne çevirir; boşsa `null`, geçersizse `undefined`. */
export function localToIso(v: string): string | null | undefined {
  if (v.trim() === '') return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString();
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** ISO anını yerel `datetime-local` değerine çevirir (düzenleme formu). */
export function isoToLocal(iso: string | null): string {
  if (iso === null) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formFrom(a: AdminAnnouncementDtoValue): AnnouncementForm {
  return {
    severity: a.severity,
    audience: a.audience,
    title: a.title,
    body: a.body,
    activeFrom: isoToLocal(a.activeFrom),
    activeUntil: isoToLocal(a.activeUntil),
  };
}

const fieldOf = (path: readonly PropertyKey[]): FormField => {
  const k = String(path[0] ?? 'title');
  return (['severity', 'audience', 'title', 'body', 'activeFrom', 'activeUntil'] as const).includes(
    k as FormField,
  )
    ? (k as FormField)
    : 'title';
};

export function toCreateInput(f: AnnouncementForm): FormResult<CreateAnnouncementInputValue> {
  const from = localToIso(f.activeFrom);
  const until = localToIso(f.activeUntil);
  if (from === undefined) return { ok: false, field: 'activeFrom' };
  if (until === undefined) return { ok: false, field: 'activeUntil' };
  const r = CreateAnnouncementInput.safeParse({
    severity: f.severity,
    audience: f.audience,
    title: f.title,
    body: f.body,
    ...(from === null ? {} : { activeFrom: from }),
    ...(until === null ? {} : { activeUntil: until }),
  });
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, field: fieldOf(r.error.issues[0]?.path ?? []) };
}

/** Yalnız değişen alanları gönderir; bitiş boşaltılırsa `null` (süresiz) gider. */
export function toUpdateInput(
  f: AnnouncementForm,
  current: AdminAnnouncementDtoValue,
): FormResult<UpdateAnnouncementInputValue> {
  const from = localToIso(f.activeFrom);
  const until = localToIso(f.activeUntil);
  if (from === undefined) return { ok: false, field: 'activeFrom' };
  if (until === undefined) return { ok: false, field: 'activeUntil' };
  const payload: Record<string, unknown> = {};
  if (f.severity !== current.severity) payload.severity = f.severity;
  if (f.audience !== current.audience) payload.audience = f.audience;
  if (f.title !== current.title) payload.title = f.title;
  if (f.body !== current.body) payload.body = f.body;
  if (from !== null && from !== new Date(current.activeFrom).toISOString())
    payload.activeFrom = from;
  const currentUntil =
    current.activeUntil === null ? null : new Date(current.activeUntil).toISOString();
  if (until !== currentUntil) payload.activeUntil = until;
  const r = UpdateAnnouncementInput.safeParse(payload);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, field: fieldOf(r.error.issues[0]?.path ?? []) };
}

/** `YYYY-MM-DD` (yerel gün). */
export function dayString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Bugün dahil son `days` gün (özet sorgusu). */
export function lastDays(days: number, now: Date): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { from: dayString(from), to: dayString(now) };
}

/** Okunma oranı yüzdesi (tam sayı); gönderilen yoksa `null`. */
export function readRate(sent: number, read: number): number | null {
  return sent <= 0 ? null : Math.round((Math.min(read, sent) / sent) * 100);
}
