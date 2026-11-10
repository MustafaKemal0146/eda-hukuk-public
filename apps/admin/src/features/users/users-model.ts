// Kullanıcılar modülü model işlevleri (saf; arayüzden bağımsız test edilir): süzgeç -> arama gövdesi,
// limit formu doğrulaması, durum tonları, kullanım oranı. Metinler `messages/tr.json` içindedir.
import {
  AdminUserLimitsInput,
  type AdminUserLimitsInputValue,
  type AdminUserSearchInputValue,
  type UserAccountStatus,
} from '@eda/contracts/api/admin-users';
import type { PlatformRole, VerificationStatus } from '@eda/contracts/enums';

export const LIMIT_FIELDS = [
  'chatTurnsPerDay',
  'chatTurnsPerMonth',
  'tokensPerDay',
  'tokensPerMonth',
] as const;
export type LimitField = (typeof LIMIT_FIELDS)[number];
export type LimitDraft = Readonly<Record<LimitField, string>>;

export interface UserFilters {
  readonly query: string;
  readonly accountStatus: UserAccountStatus | '';
  readonly platformRole: PlatformRole | '';
  readonly verificationStatus: VerificationStatus | '';
}

export const EMPTY_FILTERS: UserFilters = {
  query: '',
  accountStatus: '',
  platformRole: '',
  verificationStatus: '',
};

/** Süzgeçlerden `POST /users/search` gövdesi; boş alanlar gönderilmez. Arama metni URL'ye girmez. */
export function searchBody(f: UserFilters, cursor?: string): AdminUserSearchInputValue {
  const q = f.query.trim();
  return {
    ...(q.length >= 2 ? { query: q } : {}),
    ...(f.accountStatus === '' ? {} : { accountStatus: f.accountStatus }),
    ...(f.platformRole === '' ? {} : { platformRole: f.platformRole }),
    ...(f.verificationStatus === '' ? {} : { verificationStatus: f.verificationStatus }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/** Arama kutusu en az iki karakter ister; bir karakter yazılmışsa uyarı gösterilir. */
export const isQueryTooShort = (query: string): boolean => {
  const n = query.trim().length;
  return n > 0 && n < 2;
};

export function draftFromOverrides(
  ov: Readonly<Record<LimitField, number | null>>,
): Record<LimitField, string> {
  return {
    chatTurnsPerDay: ov.chatTurnsPerDay === null ? '' : String(ov.chatTurnsPerDay),
    chatTurnsPerMonth: ov.chatTurnsPerMonth === null ? '' : String(ov.chatTurnsPerMonth),
    tokensPerDay: ov.tokensPerDay === null ? '' : String(ov.tokensPerDay),
    tokensPerMonth: ov.tokensPerMonth === null ? '' : String(ov.tokensPerMonth),
  };
}

export type LimitParse =
  | { readonly ok: true; readonly value: AdminUserLimitsInputValue }
  | { readonly ok: false; readonly field: LimitField };

/** Boş alan `null` (varsayılan zincir); dolu alan yalnız sıfır veya pozitif tam sayı ve üst sınır içinde. */
export function parseLimitDraft(d: LimitDraft): LimitParse {
  const raw: Record<LimitField, number | null> = {
    chatTurnsPerDay: null,
    chatTurnsPerMonth: null,
    tokensPerDay: null,
    tokensPerMonth: null,
  };
  for (const f of LIMIT_FIELDS) {
    const text = d[f].trim();
    if (text === '') continue;
    if (!/^\d{1,12}$/.test(text)) return { ok: false, field: f };
    raw[f] = Number(text);
  }
  const r = AdminUserLimitsInput.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  const bad = r.error.issues[0]?.path[0];
  const field = LIMIT_FIELDS.find((f) => f === bad) ?? 'chatTurnsPerDay';
  return { ok: false, field };
}

export const isAllNull = (v: AdminUserLimitsInputValue): boolean =>
  LIMIT_FIELDS.every((f) => v[f] === null);

export const accountTone = (s: UserAccountStatus): 'success' | 'danger' =>
  s === 'suspended' ? 'danger' : 'success';

export function verificationTone(s: VerificationStatus): 'success' | 'warning' | 'danger' {
  if (s === 'verified') return 'success';
  if (s === 'pending_verification') return 'warning';
  return 'danger';
}

/** Kullanım / geçerli limit yüzdesi (0..100); limit yoksa veya sıfırsa `null`. */
export function usagePercent(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 100));
}

/** Personel satırlarında eylem yoktur; yalnız `super_admin` oturumu değiştirir. */
export const canActOn = (viewerRole: string, targetRole: PlatformRole): boolean =>
  viewerRole === 'super_admin' && targetRole === 'user';
