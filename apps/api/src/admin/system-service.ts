// Sistem durumu servisi (Sistem modülü): hazırlık yoklamaları (gecikme + son kontrol), valkey-cache
// sayaçları (`INFO`), BullMQ kuyruk sayaçları, veritabanı özeti ve kaynak kanaryası özeti
// (`app.admin_system_*` SECURITY DEFINER fonksiyonları). Yalnız sayaç/boyut/durum döner; anahtar adı, iş yükü, sorgu metni, adres ve
// hata metni dönmez. Bağımlılıklar dışarıdan verilir (yeni istemci kurulmaz). Her bölüm bağımsızdır.
import {
  type AdminSystemDtoValue,
  SYSTEM_SERVICE_KEYS,
  type SystemServiceKey,
} from '@eda/contracts/api/admin-system';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { QUEUE_NAMES, type QueueName } from '@eda/contracts/config/env';
import {
  SOURCE_CANARY_OUTCOMES,
  SOURCE_CANARY_PROBES,
  type SourceCanaryOutcome,
} from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import type { AdminDb } from '@eda/db/admin';
import type { Probe } from '../health/ready.ts';
import { BACKUP_UNAVAILABLE, backupSummaryFrom } from './backup-status.ts';

export interface QueueCounts {
  readonly waiting: number;
  readonly active: number;
  readonly failed: number;
  readonly delayed: number;
}

export interface SystemServiceDeps {
  readonly db: AdminDb;
  readonly probes: readonly Probe[];
  readonly maintenanceMode: () => boolean;
  /** valkey-cache `INFO` çıktısı (ham metin; yalnız sayaçlar ayrıştırılır). */
  readonly cacheInfo: () => Promise<string>;
  readonly queueCounts: (queue: QueueName) => Promise<QueueCounts>;
  /**
   * Yedek betiğinin durum kaydı (ayrıştırılmış JSON); kaynak yapılandırılmamışsa `null`. API konteyneri yedek
   * deposuna erişemediği için kaynak yoksa kart "veri yok" döner; hata fırlatırsa "ulaşılamıyor".
   */
  readonly backupStatus?: () => Promise<unknown>;
  /** Yoklama sonucunun yeniden kullanım süresi (ms); uç sık çağrılsa da bağımlılıklar yorulmaz. */
  readonly probeCacheMs?: number;
  readonly now?: () => Date;
  readonly tick?: () => number;
}

const SERVICE_KEYS: readonly string[] = SYSTEM_SERVICE_KEYS;
const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
};

function sqlState(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

/** `INFO` metnini düz anahtar-değer eşlemesine çevirir (bölüm başlıkları ve boş satırlar atlanır). */
export function parseInfo(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i > 0) out.set(line.slice(0, i), line.slice(i + 1));
  }
  return out;
}

export function cacheStatsFrom(text: string): AdminSystemDtoValue['cache'] {
  const info = parseInfo(text);
  const hits = num(info.get('keyspace_hits'));
  const misses = num(info.get('keyspace_misses'));
  let keys = 0;
  for (const [k, v] of info) {
    if (/^db\d+$/.test(k)) keys += num(/(?:^|,)keys=(\d+)/.exec(v)?.[1]);
  }
  return {
    available: true,
    hits,
    misses,
    hitRate: hits + misses === 0 ? null : hits / (hits + misses),
    usedMemoryBytes: num(info.get('used_memory')),
    maxMemoryBytes: num(info.get('maxmemory')),
    keys,
    evictedKeys: num(info.get('evicted_keys')),
    expiredKeys: num(info.get('expired_keys')),
    uptimeSeconds: num(info.get('uptime_in_seconds')),
  };
}

const EMPTY_CACHE: AdminSystemDtoValue['cache'] = {
  available: false,
  hits: 0,
  misses: 0,
  hitRate: null,
  usedMemoryBytes: 0,
  maxMemoryBytes: 0,
  keys: 0,
  evictedKeys: 0,
  expiredKeys: 0,
  uptimeSeconds: 0,
};

const EMPTY_DB: AdminSystemDtoValue['database'] = {
  available: false,
  connections: { total: 0, max: 0 },
  databaseBytes: 0,
  schemas: [],
  topTables: [],
};

type SourceCanaryDto = AdminSystemDtoValue['sourceCanary'];

const OUTCOMES: readonly string[] = SOURCE_CANARY_OUTCOMES;
const isOutcome = (v: unknown): v is SourceCanaryOutcome =>
  typeof v === 'string' && OUTCOMES.includes(v);
const isoOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * `app.admin_system_source_canary` satırlarını sözleşme listesine (beş yoklama) eşler; verisi olmayan
 * yoklama `unknown` döner. Durum: son sonuç `ok` ise yeşil, değilse kırmızı.
 */
export function sourceCanaryFrom(
  rows: readonly Record<string, unknown>[],
  windowDays: number,
  failThreshold: number,
): SourceCanaryDto {
  const byProbe = new Map(rows.map((r) => [String(r.probe), r]));
  return {
    available: true,
    windowDays,
    failThreshold,
    items: SOURCE_CANARY_PROBES.map((probe) => {
      const r = byProbe.get(probe);
      const lastOutcome = r !== undefined && isOutcome(r.last_outcome) ? r.last_outcome : null;
      const runs = num(r?.window_runs);
      const ok = Math.min(num(r?.window_ok), runs);
      const fails = num(r?.consecutive_failures);
      return {
        probe,
        state: lastOutcome === null ? 'unknown' : lastOutcome === 'ok' ? 'ok' : 'failing',
        lastCheckedAt: lastOutcome === null ? null : isoOrNull(r?.last_checked_at),
        lastOutcome,
        lastDurationMs: lastOutcome === null ? null : num(r?.last_duration_ms),
        consecutiveFailures: fails,
        degraded: fails >= failThreshold,
        windowRuns: runs,
        windowOk: ok,
        successRate: runs === 0 ? null : ok / runs,
      };
    }),
  };
}

export function createSystemService(deps: SystemServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const tick = deps.tick ?? (() => performance.now());
  const probeCacheMs = deps.probeCacheMs ?? 5000;
  let probed: { at: number; services: AdminSystemDtoValue['services'] } | undefined;

  async function services(): Promise<AdminSystemDtoValue['services']> {
    if (probed !== undefined && now().getTime() - probed.at < probeCacheMs) return probed.services;
    const list = deps.probes.filter((p) => SERVICE_KEYS.includes(p.name));
    const items = await Promise.all(
      list.map(async (p) => {
        const t0 = tick();
        let ok = false;
        try {
          ok = await p.run();
        } catch {
          ok = false;
        }
        return {
          key: p.name as SystemServiceKey,
          state: ok ? ('ok' as const) : p.hard ? ('fail' as const) : ('degraded' as const),
          hard: p.hard,
          latencyMs: Math.max(0, Math.round(tick() - t0)),
          checkedAt: now().toISOString(),
        };
      }),
    );
    probed = { at: now().getTime(), services: items };
    return items;
  }

  async function cache(): Promise<AdminSystemDtoValue['cache']> {
    try {
      return cacheStatsFrom(await deps.cacheInfo());
    } catch {
      return EMPTY_CACHE;
    }
  }

  async function queues(): Promise<AdminSystemDtoValue['queues']> {
    const results = await Promise.allSettled(QUEUE_NAMES.map((q) => deps.queueCounts(q)));
    const items: AdminSystemDtoValue['queues']['items'] = [];
    let all = true;
    results.forEach((r, i) => {
      const name = QUEUE_NAMES[i];
      if (name === undefined) return;
      if (r.status === 'fulfilled') {
        items.push({
          name,
          waiting: num(r.value.waiting),
          active: num(r.value.active),
          failed: num(r.value.failed),
          delayed: num(r.value.delayed),
        });
      } else {
        all = false;
      }
    });
    return { available: all, items };
  }

  async function backup(): Promise<AdminSystemDtoValue['backup']> {
    if (deps.backupStatus === undefined) return BACKUP_UNAVAILABLE('no_source');
    try {
      const raw = await deps.backupStatus();
      return raw === null ? BACKUP_UNAVAILABLE('no_source') : backupSummaryFrom(raw, now());
    } catch {
      return BACKUP_UNAVAILABLE('unreachable');
    }
  }

  async function database(actorId: string): Promise<AdminSystemDtoValue['database']> {
    try {
      const [conn, sizes] = await deps.db.withAdmin(async (tx) => [
        (await tx.query('SELECT * FROM app.admin_system_connections($1)', [actorId])).rows,
        (await tx.query('SELECT * FROM app.admin_system_sizes($1)', [actorId])).rows,
      ]);
      const c = conn as Record<string, unknown>[];
      const s = sizes as Record<string, unknown>[];
      const size = (x: Record<string, unknown>) => ({
        totalBytes: num(x.total_bytes),
        indexBytes: num(x.index_bytes),
        estimatedRows: num(x.est_rows),
      });
      return {
        available: true,
        connections: {
          total: num(c[0]?.connections),
          max: num(c[0]?.max_connections),
        },
        databaseBytes: num(s.find((x) => x.scope === 'database')?.total_bytes),
        schemas: s
          .filter((x) => x.scope === 'schema')
          .map((x) => ({ schema: String(x.ident), tables: num(x.tables), ...size(x) })),
        topTables: s
          .filter((x) => x.scope === 'table')
          .map((x) => ({ table: String(x.ident), ...size(x) })),
      };
    } catch (err) {
      if (sqlState(err) === '42501') throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
      return EMPTY_DB;
    }
  }

  async function sourceCanary(actorId: string): Promise<SourceCanaryDto> {
    const windowDays = CONFIG_DEFAULTS['sources.canaryWindowDays'];
    const failThreshold = CONFIG_DEFAULTS['sources.canaryFailThreshold'];
    try {
      const rows = await deps.db.withAdmin(
        async (tx) =>
          (
            await tx.query('SELECT * FROM app.admin_system_source_canary($1, $2)', [
              actorId,
              windowDays,
            ])
          ).rows,
      );
      return sourceCanaryFrom(rows as Record<string, unknown>[], windowDays, failThreshold);
    } catch (err) {
      if (sqlState(err) === '42501') throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
      return { available: false, windowDays, failThreshold, items: [] };
    }
  }

  return {
    async system(actorId: string): Promise<AdminSystemDtoValue> {
      const [svc, ch, q, db, bk, sc] = await Promise.all([
        services(),
        cache(),
        queues(),
        database(actorId),
        backup(),
        sourceCanary(actorId),
      ]);
      return {
        generatedAt: now().toISOString(),
        maintenanceMode: deps.maintenanceMode(),
        services: svc,
        cache: ch,
        queues: q,
        database: db,
        backup: bk,
        sourceCanary: sc,
      };
    },
  };
}

export type SystemService = ReturnType<typeof createSystemService>;
