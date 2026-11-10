// Anahtar ataması görünüm modeli: saf işlevler (test edilebilir; tarayıcı bağımlılığı yok).
// Anahtar değeri bu modelde yalnız biçim denetiminden geçer; hiçbir yerde saklanmaz veya kaydedilmez.

import {
  type AdminAiKeyOrgItemDtoValue,
  type AdminAiKeySlotDtoValue,
  type AdminAiKeyUserItemDtoValue,
  type AdminAiPlatformCapInputValue,
  type AdminAiPlatformKeyDtoValue,
  type AdminAiPlatformLimitsInputValue,
  PLATFORM_CAP_BOUNDS,
  PLATFORM_LIMIT_BOUNDS,
  PlatformKeyLabel,
} from '@eda/contracts/api/admin-ai-keys';
import { AI_API_KEY_PATTERN } from '@eda/contracts/api/ai-keys';

export type KeyKind = 'org' | 'user';
export type KeyItem =
  | ({ kind: 'org' } & AdminAiKeyOrgItemDtoValue)
  | ({ kind: 'user' } & AdminAiKeyUserItemDtoValue);

export const withKind = {
  org: (i: AdminAiKeyOrgItemDtoValue): KeyItem => ({ kind: 'org', ...i }),
  user: (i: AdminAiKeyUserItemDtoValue): KeyItem => ({ kind: 'user', ...i }),
};

export type SlotTone = 'success' | 'neutral';

export const slotTone = (slot: AdminAiKeySlotDtoValue): SlotTone =>
  slot.configured ? 'success' : 'neutral';

/** Hedefin API yolu: `PUT/DELETE /ai/keys/orgs/{id}` veya `/ai/keys/users/{id}`. */
export function keyPath(item: Pick<KeyItem, 'kind'> & { orgId?: string; userId?: string }): string {
  return item.kind === 'org'
    ? `/ai/keys/orgs/${item.orgId ?? ''}`
    : `/ai/keys/users/${item.userId ?? ''}`;
}

export const targetId = (item: KeyItem): string => (item.kind === 'org' ? item.orgId : item.userId);

export const targetLabel = (item: KeyItem): string =>
  item.kind === 'org' ? item.orgLabel : item.userEmail;

/** Girişin kırpılmış hâli geçerli Anthropic anahtar biçimindeyse true (asıl doğrulama sunucudadır). */
export const isKeyInputValid = (raw: string): boolean => AI_API_KEY_PATTERN.test(raw.trim());

export type PlatformState = 'off' | 'paused' | 'missing' | 'on';

/**
 * Kart durumu: sert kapı (env) kapalı; yumuşak anahtar kapalı (duraklatıldı); açık ama anahtar yok
 * (kullanılamaz); açık ve hazır.
 */
export function platformState(card: AdminAiPlatformKeyDtoValue): PlatformState {
  if (!card.fallbackEnabled) return 'off';
  if (!card.fallbackSwitch) return 'paused';
  return card.keyConfigured ? 'on' : 'missing';
}

export const platformTone = (s: PlatformState): 'neutral' | 'warning' | 'success' =>
  s === 'on' ? 'success' : s === 'missing' ? 'warning' : 'neutral';

/** Görünen ad geçerli mi (3-60 karakter düz metin; denetim karakteri, `<` ve `>` yok). */
export const isLabelValid = (raw: string): boolean => PlatformKeyLabel.safeParse(raw).success;

export const LIMIT_DRAFT_FIELDS = [
  'userTurnsPerDay',
  'userTokensPerDay',
  'orgDailyCapUsd',
] as const;
export type LimitDraftField = (typeof LIMIT_DRAFT_FIELDS)[number];
export type PlatformLimitsDraft = Record<LimitDraftField, string>;

const MICRO = 1_000_000;

/** Kartın panel değerlerinden form taslağı (boş = varsayılan; büro tavanı USD olarak). */
export function draftFromCard(card: AdminAiPlatformKeyDtoValue): PlatformLimitsDraft {
  const c = card.limits.custom;
  return {
    userTurnsPerDay: c.userTurnsPerDay === null ? '' : String(c.userTurnsPerDay),
    userTokensPerDay: c.userTokensPerDay === null ? '' : String(c.userTokensPerDay),
    orgDailyCapUsd: c.orgDailyCapMicroUsd === null ? '' : String(c.orgDailyCapMicroUsd / MICRO),
  };
}

function wholeNumber(raw: string, b: { min: number; max: number }): number | null | 'bad' {
  const v = raw.trim();
  if (v === '') return null;
  if (!/^\d{1,12}$/.test(v)) return 'bad';
  const n = Number(v);
  return n >= b.min && n <= b.max ? n : 'bad';
}

export type ParsedLimits =
  | { ok: true; value: AdminAiPlatformLimitsInputValue }
  | { ok: false; field: LimitDraftField };

/** Form taslağını API girdisine çevirir; boş alan `null` (varsayılana dön), geçersiz alan adı döner. */
export function parsePlatformLimits(d: PlatformLimitsDraft): ParsedLimits {
  const turns = wholeNumber(d.userTurnsPerDay, PLATFORM_LIMIT_BOUNDS.userTurnsPerDay);
  if (turns === 'bad') return { ok: false, field: 'userTurnsPerDay' };
  const tokens = wholeNumber(d.userTokensPerDay, PLATFORM_LIMIT_BOUNDS.userTokensPerDay);
  if (tokens === 'bad') return { ok: false, field: 'userTokensPerDay' };
  const usdRaw = d.orgDailyCapUsd.trim().replace(',', '.');
  let cap: number | null = null;
  if (usdRaw !== '') {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(usdRaw)) return { ok: false, field: 'orgDailyCapUsd' };
    cap = Math.round(Number(usdRaw) * MICRO);
    const b = PLATFORM_LIMIT_BOUNDS.orgDailyCapMicroUsd;
    if (cap < b.min || cap > b.max) return { ok: false, field: 'orgDailyCapUsd' };
  }
  return {
    ok: true,
    value: { userTurnsPerDay: turns, userTokensPerDay: tokens, orgDailyCapMicroUsd: cap },
  };
}

/** Platform geneli günlük harcama tavanı taslağı (USD; boş = varsayılan). */
export function capDraftFromCard(card: AdminAiPlatformKeyDtoValue): string {
  const c = card.limits.custom.platformDailyCapMicroUsd;
  return c === null ? '' : String(c / MICRO);
}

export type ParsedCap = { ok: true; value: AdminAiPlatformCapInputValue } | { ok: false };

/** USD girdisini (en çok iki ondalık) mikro-USD'ye çevirir; boş `null` (varsayılana dön), aralık dışı reddedilir. */
export function parsePlatformCap(raw: string): ParsedCap {
  const v = raw.trim().replace(',', '.');
  if (v === '') return { ok: true, value: { platformDailyCapMicroUsd: null } };
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(v)) return { ok: false };
  const micro = Math.round(Number(v) * MICRO);
  const b = PLATFORM_CAP_BOUNDS;
  return micro >= b.min && micro <= b.max
    ? { ok: true, value: { platformDailyCapMicroUsd: micro } }
    : { ok: false };
}

/** Mikro-USD -> USD (iki ondalık; yalnız gösterim). */
export const microToUsd = (micro: number): number => Math.round(micro / 10_000) / 100;

export type KeyErrorKey = 'rejected' | 'unreachable' | 'rateLimited' | 'notFound' | 'generic';

/** API hata kodunu kullanıcıya gösterilecek metin anahtarına çevirir (iç ayrıntı yok). */
export function keyErrorKey(code: string | undefined, status: number | undefined): KeyErrorKey {
  if (status === 429 || code === 'RATE_LIMITED') return 'rateLimited';
  if (code === 'VALIDATION_FAILED') return 'rejected';
  if (code === 'INTERNAL_DEPENDENCY_UNAVAILABLE') return 'unreachable';
  if (code === 'VALIDATION_RESOURCE_NOT_FOUND') return 'notFound';
  return 'generic';
}
