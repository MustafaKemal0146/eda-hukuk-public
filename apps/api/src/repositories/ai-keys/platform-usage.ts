// Platform ortak anahtarı kullanım deposu: `app.platform_key_usage` ve kapı fonksiyonu
// `app.platform_key_usage_today()`. SQL yalnız burada. İçerik yok: yalnız sayaç ve tahmini maliyet.
import type { TenantTx } from '@eda/db';

export interface PlatformUsageToday {
  readonly userTurnsDay: number;
  readonly userTokensDay: number;
  readonly userTurnsMonth: number;
  readonly userTokensMonth: number;
  readonly orgCostDay: number;
  readonly orgSeats: number;
  readonly ovTurnsDay: number | null;
  readonly ovTurnsMonth: number | null;
  readonly ovTokensDay: number | null;
  readonly ovTokensMonth: number | null;
  readonly orgCapFloor: number | null;
  readonly orgCapPerSeat: number | null;
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function readUsageToday(tx: TenantTx): Promise<PlatformUsageToday> {
  const r = await tx.query('SELECT * FROM app.platform_key_usage_today()');
  const x = (r.rows[0] ?? {}) as Record<string, unknown>;
  return {
    userTurnsDay: n(x.user_turns_day),
    userTokensDay: n(x.user_tokens_day),
    userTurnsMonth: n(x.user_turns_month),
    userTokensMonth: n(x.user_tokens_month),
    orgCostDay: n(x.org_cost_day),
    orgSeats: n(x.org_seats),
    ovTurnsDay: nOrNull(x.ov_turns_day),
    ovTurnsMonth: nOrNull(x.ov_turns_month),
    ovTokensDay: nOrNull(x.ov_tokens_day),
    ovTokensMonth: nOrNull(x.ov_tokens_month),
    orgCapFloor: nOrNull(x.org_cap_floor),
    orgCapPerSeat: nOrNull(x.org_cap_per_seat),
  };
}

export interface PlatformReserveArgs {
  readonly turnsDay: number | null;
  readonly tokensDay: number | null;
  readonly turnsMonth: number | null;
  readonly tokensMonth: number | null;
  readonly orgCap: number | null;
  readonly platformCap: number | null;
  readonly reserveCostMicroUsd: number;
  readonly maxConcurrent: number | null;
  readonly activeWindowSec: number;
  readonly modelAlias: 'edai-flash' | 'edai-pro';
  readonly conversationId: string | null;
  readonly requestId: string | null;
}

export type PlatformReserveDenial =
  | 'user_day'
  | 'user_month'
  | 'org_day'
  | 'platform_day'
  | 'concurrent';

export type PlatformReserveResult =
  | { readonly reservationId: string }
  | { readonly denied: PlatformReserveDenial };

/**
 * Atomik rezervasyon (0050): sayım, sınır denetimi ve rezervasyon satırı kilit altında tek çağrıdadır.
 * Reddedilirse satır eklenmez. Doğrulanmamış/üye olmayan kullanıcıda 42501 atar.
 */
export async function reserveTurn(
  tx: TenantTx,
  a: PlatformReserveArgs,
): Promise<PlatformReserveResult> {
  const r = await tx.query(
    'SELECT * FROM app.platform_key_reserve($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [
      a.turnsDay,
      a.tokensDay,
      a.turnsMonth,
      a.tokensMonth,
      a.orgCap,
      a.platformCap,
      a.reserveCostMicroUsd,
      a.maxConcurrent,
      a.activeWindowSec,
      a.modelAlias,
      a.conversationId,
      a.requestId,
    ],
  );
  const x = (r.rows[0] ?? {}) as { reservation_id?: unknown; denied?: unknown };
  if (typeof x.reservation_id === 'string') return { reservationId: x.reservation_id };
  return { denied: (x.denied ?? 'org_day') as PlatformReserveDenial };
}

export interface PlatformSettleArgs {
  readonly reservationId: string;
  readonly status: 'success' | 'error' | 'timeout' | 'stopped' | 'released';
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicroUsd: number;
}

/** Rezervasyonu gerçek kullanımla kapatır (`released` = iade). Satır yoksa/başkasınınsa false. */
export async function settleTurn(tx: TenantTx, a: PlatformSettleArgs): Promise<boolean> {
  const r = await tx.query('SELECT app.platform_key_settle($1,$2,$3,$4,$5) AS ok', [
    a.reservationId,
    a.status,
    a.inputTokens,
    a.outputTokens,
    a.costMicroUsd,
  ]);
  return (r.rows[0] as { ok?: unknown } | undefined)?.ok === true;
}
