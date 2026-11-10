// @tk TK-26
// KK-043-17 (backup.verify işleyici kısmı; 073 §7.1): durum ucu Basic kimlikle okunur, yalnız içeriksiz alt
// küme Valkey `eda:ops:backup-status` anahtarına yazılır (yol/etiket/hata atılır), son başarılı doğrulama
// metriği yayınlanır, 36 saatten eski/başarısız yedekte alarm günlüğü; URL yoksa iş atlanır; belirteç sızmaz.
import { BACKUP_STATUS_KEY } from '@eda/contracts/jobs/maintenance';
import { createLogger } from '@eda/observability/logger';
import { describe, expect, it } from 'vitest';
import { Metrics } from '../src/metrics.ts';
import {
  BackupStatusError,
  processBackupVerify,
} from '../src/processors/maintenance/backup-verify.ts';

const TOKEN = 'sentetik-belirtec-0123456789';
const NOW = new Date('2026-10-17T06:00:00Z');

const STATUS = {
  v: 1,
  generatedAt: '2026-10-17T02:10:00Z',
  overall: 'ok',
  pgbackrest: {
    stanza: 'eda',
    status: 'ok',
    lastFull: { label: '20261012-020000F', stoppedAt: '2026-10-12T02:05:00Z', repoBytes: 12345 },
    wal: {
      minSegment: '000000010000000000000001',
      maxSegment: '00000001000000000000000F',
      lastArchivedAt: null,
    },
    lastVerify: { ok: true, at: '2026-10-17T02:09:00Z', scope: 'set=latest' },
  },
  lastRun: { state: 'ok', exitCode: 0, at: '2026-10-17T02:09:30Z', durationSeconds: 300 },
  offsite: { status: 'ok', pg: { lastSnapshotAt: null, lastWalSyncAt: '2026-10-17T05:55:00Z' } },
  restoreDrill: { ok: true, at: '2026-10-05T00:40:00Z' },
  errors: ['/var/lib/pgbackrest yolu burada olmamalı'],
};

function setup(body: unknown, status = 200, url = 'http://backup:8433/status.json') {
  const lines: string[] = [];
  const stored = new Map<string, string>();
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const metrics = new Metrics();
  const deps = {
    url,
    tokenFile: '/run/secrets/backup_status_token',
    store: {
      set: (k: string, v: string) => {
        stored.set(k, v);
        return Promise.resolve('OK');
      },
    },
    logger: createLogger({ service: 'test', destination: { write: (l: string) => lines.push(l) } }),
    metrics,
    readToken: () => `${TOKEN}\n`,
    now: () => NOW,
    fetch: ((u: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(u), init });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }) as typeof fetch,
  };
  return { deps, lines, stored, calls, metrics };
}

describe('KK-043-17: backup.verify', () => {
  it('durum ucunu Basic kimlikle okur, yalnız alt kümeyi yazar, metrik yayınlar', async () => {
    const t = setup(STATUS);
    const out = await processBackupVerify(t.deps);
    expect(out).toEqual({ state: 'stored', overall: 'ok', alarm: false });
    const auth = (t.calls[0]?.init?.headers as Record<string, string> | undefined)?.authorization;
    expect(auth).toBe(`Basic ${Buffer.from(`eda_jobs:${TOKEN}`).toString('base64')}`);
    expect(t.calls[0]?.init?.redirect).toBe('error');
    const raw = t.stored.get(BACKUP_STATUS_KEY) ?? '';
    const snap = JSON.parse(raw);
    expect(snap.restoreDrill).toEqual({ ok: true, at: '2026-10-05T00:40:00Z' });
    expect(snap.pgbackrest.lastFull).toEqual({ stoppedAt: '2026-10-12T02:05:00Z' });
    expect(raw).not.toMatch(/label|repoBytes|Segment|errors|var\/lib|stanza|scope/);
    expect(t.metrics.render()).toContain(
      `eda_backup_last_verify_success_timestamp ${Date.parse('2026-10-17T02:09:00Z') / 1000}`,
    );
    expect(t.lines.join('')).not.toContain(TOKEN);
  });

  it('son yedek çalıştırması başarısız ya da 36 saatten eskiyse alarm günlüğü', async () => {
    const failed = setup({ ...STATUS, lastRun: { ...STATUS.lastRun, state: 'failed' } });
    expect((await processBackupVerify(failed.deps)).state).toBe('stored');
    expect(failed.lines.join('')).toContain('backup.verify.alarm');
    const old = setup({ ...STATUS, lastRun: { ...STATUS.lastRun, at: '2026-10-15T17:00:00Z' } });
    expect(await processBackupVerify(old.deps)).toMatchObject({ alarm: true });
    const recent = setup({ ...STATUS, lastRun: { ...STATUS.lastRun, at: '2026-10-15T19:00:00Z' } });
    expect(await processBackupVerify(recent.deps)).toMatchObject({ alarm: false });
  });

  it('URL tanımsız/boşsa iş atlanır, hiçbir şey yazılmaz', async () => {
    const t = setup(STATUS, 200, '');
    expect(await processBackupVerify(t.deps)).toEqual({ state: 'skipped' });
    expect(await processBackupVerify({ ...t.deps, url: undefined })).toEqual({ state: 'skipped' });
    expect(t.calls).toHaveLength(0);
    expect(t.stored.size).toBe(0);
  });

  it('HTTP hatası ve biçimsiz kayıt işi düşürür (yeniden denenir), eski özet ezilmez', async () => {
    const e401 = setup(STATUS, 401);
    await expect(processBackupVerify(e401.deps)).rejects.toBeInstanceOf(BackupStatusError);
    expect(e401.stored.size).toBe(0);
    const bad = setup({ v: 2, overall: 'ok' });
    await expect(processBackupVerify(bad.deps)).rejects.toThrow(/biçimsiz/);
    expect(bad.stored.size).toBe(0);
  });
});
