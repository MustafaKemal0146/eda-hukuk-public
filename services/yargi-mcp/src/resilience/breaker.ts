// Devre kesici (021 §5.11): durum valkey-cache `eda:brk:<kaynak>`; geçişler `breaker.lua` içinde atomik.
// Sayılan hatalar: ağ, zaman aşımı, 5xx, ayrıştırma. 404/400/429 sayılmaz. WAF → doğrudan açık
// (`breaker.wafOpenMs`). Hata oranı penceresi sabit pencere sayaçlarıyla tutulur.
import { VALKEY_CACHE_KEYS } from '@eda/contracts/mcp';
import type { SourcesConfig } from '../config/sources.ts';
import { loadLua, runLua, type ValkeyClient } from './valkey.ts';

export type BreakerState = 'closed' | 'open' | 'half_open';

export type BreakerSnapshot = {
  state: BreakerState;
  openUntil: number | null;
  reason: string | null;
};

/** 021 §5.11: hata oranı kuralı en az 4 istekte değerlendirilir (002'de anahtar değil, belge sabiti). */
export const BREAKER_MIN_REQUESTS = 4;

export interface BreakerStore {
  /** İstek atılabilir mi? Yarı açıkta yalnız tek deneme isteğine izin verir. */
  allow(
    source: string,
    now: number,
  ): Promise<{ ok: true } | { ok: false; retryAfterMs: number | null }>;
  onSuccess(source: string, now: number): Promise<void>;
  onFailure(source: string, now: number, reason: string): Promise<void>;
  onWaf(source: string, now: number): Promise<void>;
  /** Yarı açık deneme isteği sayılmayan bir sonuçla bittiyse (404, 429, kova reddi) kilidi bırak. */
  release(source: string, now: number): Promise<void>;
  snapshot(source: string, now: number): Promise<BreakerSnapshot>;
}

const SCRIPT = loadLua('breaker');
const STATES: readonly BreakerState[] = ['closed', 'open', 'half_open'];

export class ValkeyBreakerStore implements BreakerStore {
  private readonly client: ValkeyClient;
  private readonly cfg: () => SourcesConfig['breaker'];

  constructor(client: ValkeyClient, cfg: () => SourcesConfig['breaker']) {
    this.client = client;
    this.cfg = cfg;
  }

  private run(op: string, source: string, now: number, reason = ''): Promise<unknown> {
    const c = this.cfg();
    return runLua(
      this.client,
      SCRIPT,
      [VALKEY_CACHE_KEYS.breaker(source)],
      [
        op,
        now,
        c.windowMs,
        c.errorRatePct,
        BREAKER_MIN_REQUESTS,
        c.consecutiveFailures,
        c.openMs,
        c.openMaxMs,
        c.wafOpenMs,
        reason,
      ],
    );
  }

  async allow(
    source: string,
    now: number,
  ): Promise<{ ok: true } | { ok: false; retryAfterMs: number | null }> {
    const raw = await this.run('allow', source, now);
    if (!Array.isArray(raw)) throw new Error('breaker: beklenmeyen yanıt');
    if (Number(raw[0]) === 1) return { ok: true };
    const left = Number(raw[1]);
    return { ok: false, retryAfterMs: Number.isFinite(left) && left >= 0 ? left : null };
  }

  async onSuccess(source: string, now: number): Promise<void> {
    await this.run('success', source, now);
  }

  async onFailure(source: string, now: number, reason: string): Promise<void> {
    await this.run('failure', source, now, reason);
  }

  async onWaf(source: string, now: number): Promise<void> {
    await this.run('waf', source, now);
  }

  async release(source: string, now: number): Promise<void> {
    await this.run('release', source, now);
  }

  async snapshot(source: string, now: number): Promise<BreakerSnapshot> {
    const raw = await this.run('peek', source, now);
    if (!Array.isArray(raw)) throw new Error('breaker: beklenmeyen yanıt');
    const state = STATES.find((s) => s === raw[0]);
    if (state === undefined) throw new Error('breaker: beklenmeyen durum');
    const until = Number(raw[1]);
    const reason = typeof raw[2] === 'string' && raw[2] !== '' ? raw[2] : null;
    return { state, openUntil: state === 'open' && until >= 0 ? until : null, reason };
  }
}
