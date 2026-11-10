// @tk TK-04 TK-05 TK-07
// Sistem modülü hizmeti (veritabanı ve ağ gerektirmez): INFO ayrıştırma, yoklama durumları, kuyruk
// ve veritabanı bölümlerinin bağımsızlığı, içerik sızıntısı yok.
import { AdminSystemDto } from '@eda/contracts/api/admin-system';
import { BACKUP_STATUS_KEY } from '@eda/contracts/jobs/maintenance';
import { describe, expect, it } from 'vitest';
import { valkeyBackupStatus } from '../src/admin/backup-status.ts';
import type { AdminDb } from '../src/admin/db.ts';
import {
  cacheStatsFrom,
  createSystemService,
  parseInfo,
  type SystemServiceDeps,
  sourceCanaryFrom,
} from '../src/admin/system-service.ts';

const INFO = [
  '# Server',
  'uptime_in_seconds:3600',
  '# Memory',
  'used_memory:5242880',
  'maxmemory:134217728',
  '# Stats',
  'keyspace_hits:75',
  'keyspace_misses:25',
  'expired_keys:7',
  'evicted_keys:2',
  '# Keyspace',
  'db0:keys=40,expires=38,avg_ttl=1000',
  'db1:keys=2,expires=0,avg_ttl=0',
  '',
].join('\r\n');

const ACTOR = '00000000-0000-4000-8000-000000000001';

function fakeDb(rows: { conn: unknown[]; sizes: unknown[] } | Error): AdminDb {
  return {
    withAdmin: async (fn) => {
      if (rows instanceof Error) throw rows;
      return fn({
        query: async (text: string) =>
          ({ rows: text.includes('connections') ? rows.conn : rows.sizes }) as never,
        db: undefined as never,
      });
    },
    withAdminWrite: async () => {
      throw new Error('yazma yok');
    },
    end: async () => undefined,
  };
}

const okDb = fakeDb({
  conn: [{ connections: 6, max_connections: 100 }],
  sizes: [
    {
      scope: 'database',
      ident: 'eda',
      tables: 0,
      total_bytes: '9000000',
      index_bytes: 0,
      est_rows: 0,
    },
    {
      scope: 'schema',
      ident: 'app',
      tables: 30,
      total_bytes: '5000000',
      index_bytes: '1000000',
      est_rows: '120',
    },
    {
      scope: 'table',
      ident: 'app.messages',
      tables: 1,
      total_bytes: '800000',
      index_bytes: '100',
      est_rows: '50',
    },
  ],
});

function deps(over: Partial<SystemServiceDeps> = {}): SystemServiceDeps {
  let t = 0;
  return {
    db: okDb,
    probes: [
      { name: 'postgres', hard: true, run: async () => true },
      { name: 'valkeyCache', hard: false, run: async () => false },
      { name: 'yargiMcp', hard: false, run: async () => true },
      { name: 'bilinmeyen', hard: false, run: async () => true },
    ],
    maintenanceMode: () => true,
    cacheInfo: async () => INFO,
    queueCounts: async (q) => ({ waiting: q.length, active: 1, failed: 2, delayed: 3 }),
    now: () => new Date('2026-10-16T10:00:00Z'),
    tick: () => {
      t += 12;
      return t;
    },
    ...over,
  };
}

describe('KK-SISTEM-1: valkey-cache INFO sayaçları', () => {
  it('isabet oranı, bellek ve anahtar sayısı (tüm db satırları toplanır)', () => {
    const c = cacheStatsFrom(INFO);
    expect(c).toMatchObject({
      available: true,
      hits: 75,
      misses: 25,
      hitRate: 0.75,
      usedMemoryBytes: 5242880,
      maxMemoryBytes: 134217728,
      keys: 42,
      evictedKeys: 2,
      expiredKeys: 7,
      uptimeSeconds: 3600,
    });
    expect(parseInfo('# x\r\na:b:c\r\n').get('a')).toBe('b:c');
  });
  it('hiç arama yokken oran null; bozuk sayılar 0', () => {
    expect(cacheStatsFrom('keyspace_hits:0\nkeyspace_misses:0').hitRate).toBeNull();
    expect(cacheStatsFrom('used_memory:abc').usedMemoryBytes).toBe(0);
  });
});

describe('KK-SISTEM-2: servis durumu ve bölüm bağımsızlığı', () => {
  it('yoklama renkleri, gecikme, son kontrol; bilinmeyen yoklama elenir; yanıt şemaya uyar', async () => {
    const out = await createSystemService(deps()).system(ACTOR);
    expect(() => AdminSystemDto.parse(out)).not.toThrow();
    expect(out.maintenanceMode).toBe(true);
    expect(out.services.map((s) => [s.key, s.state])).toEqual([
      ['postgres', 'ok'],
      ['valkeyCache', 'degraded'],
      ['yargiMcp', 'ok'],
    ]);
    expect(out.services[0]).toMatchObject({
      hard: true,
      latencyMs: expect.any(Number),
      checkedAt: '2026-10-16T10:00:00.000Z',
    });
    expect(out.database.connections).toEqual({ total: 6, max: 100 });
    expect(out.database.databaseBytes).toBe(9_000_000);
    expect(out.database.topTables[0]?.table).toBe('app.messages');
  });
  it('sert bağımlılık düşerse fail; yoklama hata fırlatırsa da fail/degraded', async () => {
    const out = await createSystemService(
      deps({
        probes: [
          {
            name: 'postgres',
            hard: true,
            run: async () => Promise.reject(new Error('gizli-host:5432')),
          },
          { name: 'objstore', hard: false, run: async () => false },
        ],
      }),
    ).system(ACTOR);
    expect(out.services.map((s) => s.state)).toEqual(['fail', 'degraded']);
    expect(JSON.stringify(out)).not.toContain('gizli-host');
  });
  it('önbellek, kuyruk ve veritabanı biri düşse de diğerleri döner', async () => {
    const out = await createSystemService(
      deps({
        db: fakeDb(new Error('bağlantı kesildi')),
        cacheInfo: async () => Promise.reject(new Error('NOPERM')),
        queueCounts: async (q) =>
          q === 'chat'
            ? Promise.reject(new Error('x'))
            : { waiting: 1, active: 0, failed: 0, delayed: 0 },
      }),
    ).system(ACTOR);
    expect(out.cache.available).toBe(false);
    expect(out.database.available).toBe(false);
    expect(out.queues.available).toBe(false);
    expect(out.queues.items.some((q) => q.name === 'chat')).toBe(false);
    expect(out.queues.items.length).toBeGreaterThan(0);
    expect(out.services.length).toBe(3);
  });
  it('aktör süper yönetici değilse (42501) ADMIN_FORBIDDEN', async () => {
    const err = Object.assign(new Error('yetki'), { code: '42501' });
    await expect(
      createSystemService(deps({ db: fakeDb(err) })).system(ACTOR),
    ).rejects.toMatchObject({
      code: 'ADMIN_FORBIDDEN',
    });
  });
  it('yoklama sonucu önbellek süresince yeniden kullanılır', async () => {
    let calls = 0;
    const svc = createSystemService(
      deps({
        probes: [
          {
            name: 'postgres',
            hard: true,
            run: async () => {
              calls += 1;
              return true;
            },
          },
        ],
      }),
    );
    await svc.system(ACTOR);
    await svc.system(ACTOR);
    expect(calls).toBe(1);
  });
});

describe('KK-YEDEK-1: yedek durumu özeti (yalnız okuma)', () => {
  const status = {
    v: 1,
    generatedAt: '2026-10-16T09:30:00Z',
    overall: 'degraded',
    pgbackrest: {
      stanza: 'eda',
      status: 'ok',
      lastFull: { label: 'GIZLI-ETIKET', stoppedAt: '2026-10-15T01:00:00Z', repoBytes: 123456789 },
      wal: { minSegment: 'a', maxSegment: 'b', lastArchivedAt: '2026-10-16T09:55:00Z' },
    },
    lastRun: { state: 'ok', exitCode: 0, at: '2026-10-16T01:05:00Z', durationSeconds: 90 },
    offsite: { status: 'ok', pg: { lastWalSyncAt: '2026-10-16T09:40:00Z' } },
    errors: ['offsite_disabled'],
  };

  it('kaynak yoksa "veri yok" (no_source); kaynak null dönerse de aynı', async () => {
    const none = await createSystemService(deps()).system(ACTOR);
    expect(none.backup).toMatchObject({ available: false, unavailableReason: 'no_source' });
    const nul = await createSystemService(deps({ backupStatus: async () => null })).system(ACTOR);
    expect(nul.backup.unavailableReason).toBe('no_source');
    expect(() => AdminSystemDto.parse(none)).not.toThrow();
  });

  it('geçerli kayıt: son tam yedek, çalışma sonucu, WAL gecikmesi (saniye) ve tatbikat yok; etiket/boyut sızmaz', async () => {
    const out = await createSystemService(deps({ backupStatus: async () => status })).system(ACTOR);
    expect(() => AdminSystemDto.parse(out)).not.toThrow();
    expect(out.backup).toMatchObject({
      available: true,
      overall: 'degraded',
      lastFullAt: '2026-10-15T01:00:00Z',
      lastRunOk: true,
      walLastArchivedAt: '2026-10-16T09:55:00Z',
      walLagSeconds: 300,
      offsiteWalSyncAt: '2026-10-16T09:40:00Z',
      restoreDrillAt: null,
      restoreDrillOk: null,
    });
    const flat = JSON.stringify(out.backup);
    expect(flat).not.toContain('GIZLI-ETIKET');
    expect(flat).not.toContain('123456789');
  });

  it('tatbikat kaydı varsa taşınır; biçimsiz kayıt invalid, kaynak hatası unreachable', async () => {
    const withDrill = await createSystemService(
      deps({
        backupStatus: async () => ({
          ...status,
          restoreDrill: { ok: false, at: '2026-10-01T10:00:00Z' },
        }),
      }),
    ).system(ACTOR);
    expect(withDrill.backup).toMatchObject({
      restoreDrillAt: '2026-10-01T10:00:00Z',
      restoreDrillOk: false,
    });
    const bad = await createSystemService(
      deps({ backupStatus: async () => ({ v: 2, overall: 'ok' }) }),
    ).system(ACTOR);
    expect(bad.backup).toMatchObject({ available: false, unavailableReason: 'invalid' });
    const down = await createSystemService(
      deps({
        backupStatus: async () => {
          throw new Error('bağlantı: 10.0.0.9:8433 reddedildi');
        },
      }),
    ).system(ACTOR);
    expect(down.backup).toMatchObject({ available: false, unavailableReason: 'unreachable' });
    expect(JSON.stringify(down)).not.toContain('10.0.0.9');
  });

  it('Valkey kaynağı (eda:ops:backup-status): anahtar yoksa no_source, bozuk JSON invalid, kayıt taşınır', async () => {
    const store = new Map<string, string>();
    const redis = { get: async (k: string) => store.get(k) ?? null };
    const svc = () => createSystemService(deps({ backupStatus: valkeyBackupStatus(redis) }));
    expect((await svc().system(ACTOR)).backup.unavailableReason).toBe('no_source');
    store.set(BACKUP_STATUS_KEY, '{bozuk');
    expect((await svc().system(ACTOR)).backup.unavailableReason).toBe('invalid');
    store.set(BACKUP_STATUS_KEY, JSON.stringify(status));
    expect((await svc().system(ACTOR)).backup).toMatchObject({
      available: true,
      lastFullAt: '2026-10-15T01:00:00Z',
    });
    const down = createSystemService(
      deps({
        backupStatus: valkeyBackupStatus({
          get: async () => {
            throw new Error('valkey yok');
          },
        }),
      }),
    );
    expect((await down.system(ACTOR)).backup.unavailableReason).toBe('unreachable');
  });
});

describe('KK-KANARYA-2: kaynak durumu özeti (sözleşme eşlemesi)', () => {
  it('veri olmayan yoklama "henüz kontrol yok"; son sonuç durumu, eşik ve oran', () => {
    const c = sourceCanaryFrom(
      [
        {
          probe: 'anayasa_search',
          last_checked_at: new Date('2026-10-17T02:00:00Z'),
          last_outcome: 'empty',
          last_duration_ms: 120,
          window_runs: 4,
          window_ok: 3,
          consecutive_failures: 1,
        },
        {
          probe: 'mevzuat_search',
          last_checked_at: '2026-10-17T02:00:01Z',
          last_outcome: 'ok',
          last_duration_ms: '80',
          window_runs: '7',
          window_ok: '7',
          consecutive_failures: 0,
        },
        { probe: 'bilinmeyen', last_outcome: 'ok', window_runs: 1, window_ok: 1 },
      ],
      7,
      2,
    );
    expect(c.items.map((i) => [i.probe, i.state])).toEqual([
      ['uyap_search', 'unknown'],
      ['anayasa_search', 'failing'],
      ['uyusmazlik_search', 'unknown'],
      ['mevzuat_search', 'ok'],
      ['mevzuat_article', 'unknown'],
    ]);
    expect(c.items[1]).toMatchObject({
      lastCheckedAt: '2026-10-17T02:00:00.000Z',
      lastOutcome: 'empty',
      consecutiveFailures: 1,
      degraded: false,
      successRate: 0.75,
    });
    expect(c.items[3]).toMatchObject({ lastDurationMs: 80, successRate: 1 });
    expect(c.items[0]).toMatchObject({ lastCheckedAt: null, windowRuns: 0, successRate: null });
  });

  it('art arda başarısızlık eşiğe ulaşınca degraded; bozuk sonuç değeri unknown sayılır', () => {
    const c = sourceCanaryFrom(
      [
        {
          probe: 'uyap_search',
          last_outcome: 'timeout',
          consecutive_failures: 2,
          window_runs: 2,
        },
        { probe: 'anayasa_search', last_outcome: 'down', window_runs: 1, window_ok: 5 },
      ],
      7,
      2,
    );
    expect(c.items[0]).toMatchObject({ state: 'failing', degraded: true, successRate: 0 });
    expect(c.items[1]).toMatchObject({ state: 'unknown', windowOk: 1 });
  });

  it('DB okunamazsa kart available=false, diğer bölümler etkilenmez', async () => {
    const svc = createSystemService(deps({ db: fakeDb(new Error('bağlantı yok')) }));
    const out = AdminSystemDto.parse(await svc.system(ACTOR));
    expect(out.sourceCanary).toEqual({
      available: false,
      windowDays: 7,
      failThreshold: 2,
      items: [],
    });
    expect(out.cache.available).toBe(true);
  });
});
