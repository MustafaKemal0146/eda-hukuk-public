// @tk TK-23
// KK-P03c-17: maintenance dağıtıcısı yalnız kayıtlı işi koşar; geçersiz yük kalıcı hatadır; dakikalık
// zamanlayıcı tiki bayatsa atlanır (043 §5.2; sahte saat); zaman aşımı geçici hatadır; yük loglanmaz.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { createLogger } from '@eda/observability/logger';
import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import {
  createProcessor,
  type JobHandler,
  JobTimeoutError,
  type ProcessableJob,
} from '../src/jobs/processor.ts';
import { isStaleTick, MINUTELY_PATTERN, staleIntervalMs } from '../src/jobs/stale.ts';
import { Metrics } from '../src/metrics.ts';

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 11, 9, 0, 0);

function setup(handler: JobHandler = () => Promise.resolve({ sealed: 1 }), now = T0) {
  const lines: string[] = [];
  const logger = createLogger({
    service: 'test',
    level: 'debug',
    destination: { write: (l) => lines.push(l) },
  });
  const metrics = new Metrics();
  let calls = 0;
  const process = createProcessor({
    queue: 'maintenance',
    handlers: {
      'audit.seal': (ctx) => {
        calls += 1;
        return handler(ctx);
      },
    },
    logger,
    metrics,
    now: () => now,
  });
  return { process, lines, metrics, calls: () => calls };
}

const job = (over: Partial<ProcessableJob> = {}): ProcessableJob => ({
  name: 'audit.seal',
  id: 'repeat:maintenance.audit_seal:1',
  data: { v: 1 },
  attemptsMade: 0,
  queueName: 'maintenance',
  timestamp: T0 - MINUTE,
  delay: MINUTE,
  repeatJobKey: 'maintenance.audit_seal',
  ...over,
});

describe('KK-P03c-17: maintenance iş dağıtıcısı', () => {
  it('kayıtlı iş çalışır; son koşu zamanı metriği güncellenir', async () => {
    const s = setup();
    await expect(s.process(job())).resolves.toEqual({ status: 'done', result: { sealed: 1 } });
    expect(s.calls()).toBe(1);
    expect(s.metrics.get('eda_scheduler_last_run_timestamp', { job: 'audit.seal' })).toBe(
      T0 / 1000,
    );
  });

  it('kayıtsız iş adı ve yanlış kuyruk kalıcı hatadır', async () => {
    const s = setup();
    await expect(s.process(job({ name: 'retention.purge' }))).rejects.toThrow(UnrecoverableError);
    await expect(s.process(job({ name: 'yok.boyle' }))).rejects.toThrow(UnrecoverableError);
    await expect(s.process(job({ queueName: 'chat' }))).rejects.toThrow(UnrecoverableError);
    expect(s.calls()).toBe(0);
  });

  it('geçersiz yük kalıcı hatadır ve yük değeri günlüğe/hataya yazılmaz', async () => {
    const s = setup();
    const data = { v: 1, email: 'ornek@example.invalid' };
    const run = s.process(job({ data }));
    await expect(run).rejects.toThrow(UnrecoverableError);
    await expect(s.process(job({ data }))).rejects.not.toThrow(/example\.invalid/);
    expect(s.calls()).toBe(0);
    expect(s.lines.join('')).not.toContain('example.invalid');
  });

  it('başarılı koşu günlüğünde yük ve sonuç yok, bağlam alanları var', async () => {
    const s = setup(() => Promise.resolve({ gizli: 'sonuc-icerigi' }));
    await s.process(job({ data: { v: 1, requestId: 'istek-12345678' } }));
    const line = JSON.parse(s.lines.at(-1) ?? '{}') as Record<string, unknown>;
    expect(line).toMatchObject({
      queue: 'maintenance',
      job: 'audit.seal',
      attempt: 1,
      requestId: 'istek-12345678',
      schedulerId: 'maintenance.audit_seal',
      outcome: 'ok',
    });
    expect(s.lines.join('')).not.toContain('sonuc-icerigi');
    expect(line).not.toHaveProperty('data');
  });

  it('işleyici hatası yeniden fırlatılır (geçici; BullMQ yeniden dener)', async () => {
    const s = setup(() => Promise.reject(new Error('baglanti')));
    await expect(s.process(job())).rejects.toThrow('baglanti');
    expect(JSON.parse(s.lines.at(-1) ?? '{}')).toMatchObject({ outcome: 'failed', err: 'Error' });
  });
});

describe('KK-P03c-17: zaman aşımı sınıfı', () => {
  it('sınıf süresi aşılınca JobTimeoutError ve sinyal iptal edilir', async () => {
    let aborted = false;
    const lines: string[] = [];
    const process = createProcessor({
      queue: 'maintenance',
      handlers: {
        'audit.seal': ({ signal }) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              resolve(undefined);
            });
          }),
      },
      logger: createLogger({ service: 'test', destination: { write: (l) => lines.push(l) } }),
      metrics: new Metrics(),
      timeoutOverrideMs: 5,
    });
    await expect(process(job({ timestamp: Date.now() - MINUTE }))).rejects.toThrow(JobTimeoutError);
    expect(aborted).toBe(true);
  });
});

describe('KK-P03c-17: bayat tik atlama (sahte saat)', () => {
  const factor = CONFIG_DEFAULTS['jobs.staleSkipFactor'];

  it('yalnız dakikalık kalıp için aralık tanımlıdır', () => {
    expect(staleIntervalMs(MINUTELY_PATTERN)).toBe(MINUTE);
    expect(staleIntervalMs('5 * * * *')).toBeUndefined();
  });

  it('planlanan andan factor x aralık sonrası bayattır; sınırda değildir', () => {
    const t = { timestamp: T0 - MINUTE, delay: MINUTE, repeatJobKey: 'maintenance.audit_seal' };
    expect(isStaleTick(t, MINUTE, T0)).toBe(false);
    expect(isStaleTick(t, MINUTE, T0 + factor * MINUTE)).toBe(false);
    expect(isStaleTick(t, MINUTE, T0 + factor * MINUTE + 1)).toBe(true);
  });

  it('zamanlayıcıdan gelmeyen iş hiçbir zaman bayat sayılmaz', () => {
    expect(isStaleTick({ timestamp: 0, delay: 0 }, MINUTE, T0)).toBe(false);
  });

  it('bayat tik işleyiciyi çağırmadan atlanır ve sayaç artar', async () => {
    const late = T0 + (factor + 1) * MINUTE;
    const s = setup(undefined, late);
    await expect(s.process(job())).resolves.toEqual({ status: 'skipped_stale' });
    expect(s.calls()).toBe(0);
    expect(s.metrics.get('eda_job_skipped_stale_total', { job: 'audit.seal' })).toBe(1);
    expect(JSON.parse(s.lines.at(-1) ?? '{}')).toMatchObject({ outcome: 'skipped_stale' });
  });
});
