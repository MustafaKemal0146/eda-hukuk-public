// Platform ortak anahtarı kapısı. Kaynağı `platform` olan her tur için:
//  - kullanıcı başına günlük (ve varsa aylık) tur ve token üst sınırı,
//  - büro başına günlük tahmini maliyet tavanı ve PLATFORM GENELİ günlük maliyet tavanı
//    (`costGuard.platformDailyCapMicroUsd`; tüm kullanıcıların toplamı; kill-switch `costGuard.killSwitch`),
//  - kullanıcı başına eşzamanlı akış sınırı (`chat.userConcurrentStreams`)
// tur BAŞLAMADAN ve ATOMİK olarak uygulanır: `app.platform_key_reserve` (0050) büro/kullanıcı kilidi altında
// sayar, sınırı denetler ve rezervasyon satırını (tahmini maliyetle) aynı işlemde ekler; böylece eşzamanlı
// turlar sınırı aşamaz ve durum süreç belleğinde değil veritabanındadır. Rezervasyon yapılamazsa tur başlamaz
// (fail-closed; aşımda açık, Türkçe ve düzeltici hata). Tur bitince `app.platform_key_settle` rezervasyonu
// gerçek token/maliyetle kapatır; hiç kullanılmadan hata ile biten tur iade edilir (`released`). Kapanış
// yazılamazsa hata loglanır (içeriksiz) ve rezervasyon kota korunur şekilde açık kalır.
// Sınır zinciri: kullanıcı geçersiz kılması (`user_limit_overrides`) > yönetim paneli platform değeri
// (`platform_settings`) > `limits.user.*` > `platformKey.*` (varsayılan 50 tur / 300000 token).
// Büro tavanı: `org_limit_overrides` > panel düz tavanı (`platform_settings.org_daily_cap_micro_usd`) >
// `costGuard.orgDailyCap*` (koltuk sayısıyla). Platform geneli tavan: panel
// (`platform_settings.platform_daily_cap_micro_usd`) > `costGuard.platformDailyCapMicroUsd`.
// Sınır: token sınırları tur BİTİNCE yazılan gerçek kullanımla uygulanır (tur içi token kesmesi yoktur;
// tur başına çıktı `chat.maxOutputTokensPerTurn` ile sınırlıdır); aşım bir sonraki turu reddeder, eşzamanlı
// akış sınırı aşımı en çok (sınır - 1) tur kadar belirler.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import * as repo from '../../repositories/ai-keys/platform-usage.ts';
import { NO_PLATFORM_LIMITS, type PlatformSettingsProvider } from './platform-settings.ts';
import type { AiKeysDb } from './types.ts';

export interface PlatformTurnActor {
  readonly orgId: string;
  readonly userId: string;
}

export interface PlatformTurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly status: 'success' | 'error' | 'timeout' | 'stopped';
}

export interface PlatformTurnStart {
  readonly modelAlias: 'edai-flash' | 'edai-pro';
  readonly conversationId: string | null;
  readonly requestId: string | null;
}

export interface PlatformTurnHandle {
  /** Rezervasyonu kapatır (gerçek kullanım veya iade); ikinci çağrı etkisizdir. */
  finish(usage: PlatformTurnUsage): Promise<void>;
}

export interface PlatformKeyGate {
  /** Sınırları atomik denetler ve rezervasyonu yazar (aşımda atar). */
  begin(actor: PlatformTurnActor, start: PlatformTurnStart): Promise<PlatformTurnHandle>;
}

export interface PlatformKeyGateDeps {
  readonly db: Pick<AiKeysDb, 'withTenant'>;
  readonly now: () => Date;
  /** Panelden ayarlanan platform geneli sınırlar (önbellekli); yoksa yalnız yapılandırma zinciri. */
  readonly settings?: Pick<PlatformSettingsProvider, 'get'>;
  readonly onRecordFailed?: (err: unknown) => void;
}

const ISTANBUL_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** Europe/Istanbul gün sonuna (UTC+3, yaz saati yok) kalan saniye; en az 60. */
export function secondsToIstanbulMidnight(now: Date): number {
  const local = now.getTime() + ISTANBUL_OFFSET_MS;
  const rest = DAY_MS - (((local % DAY_MS) + DAY_MS) % DAY_MS);
  return Math.max(60, Math.ceil(rest / 1000));
}

/** Europe/Istanbul ay sonuna kalan saniye; en az 60. */
export function secondsToIstanbulMonthEnd(now: Date): number {
  const local = new Date(now.getTime() + ISTANBUL_OFFSET_MS);
  const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1);
  return Math.max(60, Math.ceil((next - local.getTime()) / 1000));
}

/** Tahmini maliyet (mikro-USD): karışık fiyat x token / 1e6; bilerek yüksek bir varsayımdır. */
export function estimateCostMicroUsd(inputTokens: number, outputTokens: number): number {
  const perMtok = CONFIG_DEFAULTS['platformKey.estimatedMicroUsdPerMtok'];
  return Math.ceil(((inputTokens + outputTokens) * perMtok) / 1_000_000);
}

const capped = (cfg: number | null, fallback: number | null): number | null => cfg ?? fallback;

/** Tur başına rezerve edilen tahmini maliyet: tavan çıktı token'ı x tahmini fiyat. */
export function reservedCostMicroUsd(): number {
  return estimateCostMicroUsd(0, CONFIG_DEFAULTS['chat.maxOutputTokensPerTurn']);
}

export function createPlatformKeyGate(deps: PlatformKeyGateDeps): PlatformKeyGate {
  const deny = (
    reason:
      | 'platform_key_user_day'
      | 'platform_key_user_month'
      | 'platform_key_org_day'
      | 'platform_key_platform_day',
    retryAfterSec: number,
  ): never => {
    throw new AppError('QUOTA_DAILY_COST_CAP', { reason, meta: { retryAfterSec } });
  };

  /** Sınır zincirini çözer ve atomik rezervasyonu dener; reddi sınıflı hataya çevirir. */
  async function reserve(
    actor: PlatformTurnActor,
    start: PlatformTurnStart,
  ): Promise<{ reservationId: string }> {
    // Yapılandırma kill-switch'i (`costGuard.killSwitch`): açıkken ücretli ortak anahtar turu başlamaz.
    // Panelden anlık kapatma `platform_settings.fallback_enabled` (yumuşak anahtar) ile yapılır.
    if (CONFIG_DEFAULTS['costGuard.killSwitch']) {
      throw new AppError('INTERNAL_MAINTENANCE', {
        reason: 'maintenance_mode',
        meta: { retryAfterSec: 300 },
      });
    }
    const panel =
      deps.settings === undefined ? NO_PLATFORM_LIMITS : (await deps.settings.get()).limits;
    const result = await deps.db
      .withTenant({ orgId: actor.orgId, userId: actor.userId }, async (tx) => {
        const u = await repo.readUsageToday(tx);
        const floor = u.orgCapFloor ?? CONFIG_DEFAULTS['costGuard.orgDailyCapFloorMicroUsd'];
        const perSeat = u.orgCapPerSeat ?? CONFIG_DEFAULTS['costGuard.orgDailyCapPerSeatMicroUsd'];
        const orgOverridden = u.orgCapFloor !== null || u.orgCapPerSeat !== null;
        const orgCap =
          !orgOverridden && panel.orgDailyCapMicroUsd !== null
            ? panel.orgDailyCapMicroUsd
            : Math.max(floor, perSeat * Math.max(u.orgSeats, 1));
        return repo.reserveTurn(tx, {
          turnsDay: capped(
            u.ovTurnsDay,
            capped(
              panel.userTurnsPerDay,
              capped(
                CONFIG_DEFAULTS['limits.user.chatTurnsPerDay'],
                CONFIG_DEFAULTS['platformKey.userTurnsPerDay'],
              ),
            ),
          ),
          tokensDay: capped(
            u.ovTokensDay,
            capped(
              panel.userTokensPerDay,
              capped(
                CONFIG_DEFAULTS['limits.user.tokensPerDay'],
                CONFIG_DEFAULTS['platformKey.userTokensPerDay'],
              ),
            ),
          ),
          turnsMonth: capped(u.ovTurnsMonth, CONFIG_DEFAULTS['limits.user.chatTurnsPerMonth']),
          tokensMonth: capped(u.ovTokensMonth, CONFIG_DEFAULTS['limits.user.tokensPerMonth']),
          orgCap,
          // Panel değeri (platform_settings; önbellek ≤30 sn, yazan süreçte anında) > yapılandırma varsayılanı.
          platformCap:
            panel.platformDailyCapMicroUsd ?? CONFIG_DEFAULTS['costGuard.platformDailyCapMicroUsd'],
          reserveCostMicroUsd: reservedCostMicroUsd(),
          maxConcurrent: CONFIG_DEFAULTS['chat.userConcurrentStreams'],
          activeWindowSec: CONFIG_DEFAULTS['llm.proxyTimeoutSec'],
          modelAlias: start.modelAlias,
          conversationId: start.conversationId,
          requestId: start.requestId,
        });
      })
      .catch((err: unknown) => {
        // 42501: doğrulanmamış/askıdaki kullanıcı veya büro üyesi değil; ortak anahtar kullanılamaz.
        if ((err as { code?: unknown } | null)?.code === '42501') {
          throw new AppError('AUTH_PENDING_VERIFICATION');
        }
        throw err;
      });
    if ('reservationId' in result) return result;
    const now = deps.now();
    if (result.denied === 'user_day')
      return deny('platform_key_user_day', secondsToIstanbulMidnight(now));
    if (result.denied === 'user_month') {
      return deny('platform_key_user_month', secondsToIstanbulMonthEnd(now));
    }
    if (result.denied === 'concurrent') {
      throw new AppError('RATE_LIMITED', { reason: 'chat_user', meta: { retryAfterSec: 15 } });
    }
    if (result.denied === 'platform_day') {
      return deny('platform_key_platform_day', secondsToIstanbulMidnight(now));
    }
    return deny('platform_key_org_day', secondsToIstanbulMidnight(now));
  }

  return {
    async begin(actor, start) {
      const { reservationId } = await reserve(actor, start);
      let done = false;
      return {
        async finish(usage) {
          if (done) return;
          done = true;
          const input = Math.max(0, Math.trunc(usage.inputTokens));
          const output = Math.max(0, Math.trunc(usage.outputTokens));
          const unused = input + output === 0;
          // Hiç kullanılmadan hata ile biten tur iade edilir; kullanım bilinmeyen diğer turlar rezerve
          // edilen tahmini maliyetle kapanır (kota korunur).
          const args: repo.PlatformSettleArgs = {
            reservationId,
            status: unused && usage.status === 'error' ? 'released' : usage.status,
            inputTokens: input,
            outputTokens: output,
            costMicroUsd: unused ? reservedCostMicroUsd() : estimateCostMicroUsd(input, output),
          };
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              await deps.db.withTenant({ orgId: actor.orgId, userId: actor.userId }, (tx) =>
                repo.settleTurn(tx, args),
              );
              return;
            } catch (err) {
              if (attempt === 1) deps.onRecordFailed?.(err);
            }
          }
        },
      };
    },
  };
}
