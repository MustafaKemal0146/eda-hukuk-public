// @tk TK-23
// KK-P03c-17 öncülü (043 §2.2, §13): :9464 `/health` süreç + PG + Valkey ve `draining` bildirir;
// bağımlılık düşük veya boşalma sırasında 503; `/metrics` Prometheus metni; gövdede hata ayrıntısı yok.
import { describe, expect, it } from 'vitest';
import { createHealthHandler } from '../src/health/server.ts';
import { drainWorker } from '../src/jobs/drain.ts';
import { Metrics } from '../src/metrics.ts';

const ok = () => Promise.resolve('PONG');
const down = () => Promise.reject(new Error('ECONNREFUSED 10.0.0.5:6379 gizli-ayrinti'));

describe('KK-P03c-17: sağlık uç noktası', () => {
  it('bağımlılık yoklaması olmayan süreç (worker) 200 döner', async () => {
    const h = createHealthHandler();
    const r = await h('GET', '/health');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ status: 'ok', draining: false, checks: {} });
  });

  it('PG ve Valkey ayakta: 200, durumlar ok', async () => {
    const h = createHealthHandler({ checks: { pg: ok, valkey: ok } });
    const r = await h('GET', '/health?x=1');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      status: 'ok',
      draining: false,
      checks: { pg: 'ok', valkey: 'ok' },
    });
  });

  it('bağımlılık düşükse 503 ve gövdede hata ayrıntısı yok', async () => {
    const h = createHealthHandler({ checks: { pg: ok, valkey: down } });
    const r = await h('GET', '/health');
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toMatchObject({ checks: { pg: 'ok', valkey: 'fail' } });
    expect(r.body).not.toContain('gizli-ayrinti');
  });

  it('yanıt vermeyen yoklama zaman aşımıyla fail sayılır', async () => {
    const h = createHealthHandler({
      checks: { pg: () => new Promise(() => undefined) },
      timeoutMs: 5,
    });
    const r = await h('GET', '/health');
    expect(r.status).toBe(503);
  });

  it('boşalma sırasında draining true ve 503', async () => {
    let draining = false;
    const h = createHealthHandler({ checks: { pg: ok }, isDraining: () => draining, cacheMs: 0 });
    expect((await h('GET', '/health')).status).toBe(200);
    draining = true;
    const r = await h('GET', '/health');
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toMatchObject({ draining: true });
  });

  it('yoklama sonucu önbellek süresince yeniden çalışmaz', async () => {
    let t = 0;
    let calls = 0;
    const h = createHealthHandler({
      checks: {
        pg: () => {
          calls += 1;
          return Promise.resolve();
        },
      },
      cacheMs: 1000,
      now: () => t,
    });
    await h('GET', '/health');
    t = 500;
    await h('GET', '/health');
    expect(calls).toBe(1);
    t = 1500;
    await h('GET', '/health');
    expect(calls).toBe(2);
  });

  it('/metrics Prometheus metni döner; yoksa 404; bilinmeyen yol 404', async () => {
    const m = new Metrics();
    m.inc('eda_job_skipped_stale_total', { job: 'audit.seal' });
    const h = createHealthHandler({ renderMetrics: () => m.render() });
    const r = await h('GET', '/metrics');
    expect(r.status).toBe(200);
    expect(r.contentType).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(r.body).toContain('# TYPE eda_audit_seal_mismatch_total counter');
    expect(r.body).toContain('eda_audit_seal_mismatch_total 0');
    expect(r.body).toContain('eda_job_skipped_stale_total{job="audit.seal"} 1');
    expect((await createHealthHandler()('GET', '/metrics')).status).toBe(404);
    expect((await h('POST', '/health')).status).toBe(404);
    expect((await h('GET', '/')).status).toBe(404);
  });
});

describe('KK-P03c-17: zarif boşaltma', () => {
  it('aktif işler süre içinde biterse normal kapanış', async () => {
    const calls: string[] = [];
    const worker = {
      pause: (doNotWaitActive?: boolean) => {
        calls.push(`pause:${String(doNotWaitActive)}`);
        return Promise.resolve();
      },
      close: (force?: boolean) => {
        calls.push(`close:${String(force)}`);
        return Promise.resolve();
      },
    };
    await expect(drainWorker(worker, 1000, () => new Promise(() => undefined))).resolves.toBe(
      'drained',
    );
    expect(calls).toEqual(['pause:false', 'close:false']);
  });

  it('süre dolarsa close(true) ile bırakılır', async () => {
    const calls: string[] = [];
    const worker = {
      pause: () => new Promise<void>(() => undefined),
      close: (force?: boolean) => {
        calls.push(`close:${String(force)}`);
        return Promise.resolve();
      },
    };
    await expect(drainWorker(worker, 1000, () => Promise.resolve())).resolves.toBe('forced');
    expect(calls).toEqual(['close:true']);
  });
});
