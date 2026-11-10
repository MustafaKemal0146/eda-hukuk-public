// @tk TK-28
// KK-021-7.3 kaynak kanaryası (`source_status.canary`, `corpus` kuyruğu): beş yoklama sırayla atılır,
// sonuç sınıflandırması (ok/boş/hata/zaman aşımı + süre), kaynak başına özet, durum değişiminde TEK
// e-posta (bozuldu / düzeldi; spam yok), uyarı e-postası içeriksiz ve "Bedesten" sözcüğü içermez, iş
// dağıtıcısı kayıtlı olmayan işi ve geçersiz yükü kalıcı hata sayar. Ağ ve DB yoktur (bellek içi depo).
import { SOURCE_CANARY_PROBES, type SourceCanaryOutcome } from '@eda/contracts/enums';
import { JOBS } from '@eda/contracts/queues';
import { renderSourceCanaryAlert, type SourceCanaryAlertInput } from '@eda/email/ops-alert';
import { createLogger } from '@eda/observability/logger';
import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { alertSender, createCorpusHandler } from '../src/corpus.ts';
import { Metrics } from '../src/metrics.ts';
import {
  type CanaryRecordInput,
  type CanaryStore,
  classify,
  isFailing,
  type ProbeCall,
  type ProbeResult,
  runSourceCanary,
} from '../src/processors/corpus/source-status-canary.ts';

type Probe = (typeof SOURCE_CANARY_PROBES)[number];

/** Bellek içi depo: geçmiş yoklama başına yeniden eskiye. */
function memoryStore(): CanaryStore & {
  history: Map<string, SourceCanaryOutcome[]>;
  calls: CanaryRecordInput[];
} {
  const history = new Map<string, SourceCanaryOutcome[]>();
  const calls: CanaryRecordInput[] = [];
  return {
    history,
    calls,
    async record(input) {
      calls.push(input);
      const before = new Map(
        [...history].map(([k, v]) => [k, v.slice(0, input.historyDepth)] as const),
      );
      for (const r of input.runs)
        history.set(r.probe, [r.outcome, ...(history.get(r.probe) ?? [])]);
      return before;
    },
  };
}

function probesFrom(results: Partial<Record<Probe, ProbeResult | 'throw'>>) {
  const order: Probe[] = [];
  const call =
    (p: Probe): ProbeCall =>
    async () => {
      order.push(p);
      const r = results[p] ?? { ok: true, count: 1, stale: false };
      if (r === 'throw') throw new Error('ağ');
      return r;
    };
  const probes: Record<Probe, ProbeCall> = {
    uyap_search: call('uyap_search'),
    anayasa_search: call('anayasa_search'),
    uyusmazlik_search: call('uyusmazlik_search'),
    mevzuat_search: call('mevzuat_search'),
    mevzuat_article: call('mevzuat_article'),
  };
  return { probes, order };
}

const silent = createLogger({ service: 'test', level: 'fatal' });

function run(
  store: CanaryStore,
  results: Partial<Record<Probe, ProbeResult | 'throw'>>,
  alerts: SourceCanaryAlertInput[],
  metrics = new Metrics(),
) {
  let t = 0;
  return runSourceCanary({
    probes: probesFrom(results).probes,
    store,
    sendAlert: async (a) => {
      alerts.push(a);
    },
    logger: silent,
    metrics,
    now: () => new Date('2026-10-17T02:00:00Z'),
    tick: () => {
      t += 7;
      return t;
    },
    threshold: 2,
    windowDays: 7,
  });
}

const FAIL: ProbeResult = { ok: false, reason: 'upstream_5xx' };

describe('KK-021-7.3 sonuç sınıflandırması', () => {
  it('ok / boş / hata / zaman aşımı; önbellekten bayat yanıt hata sayılır', () => {
    expect(classify({ ok: true, count: 3, stale: false })).toBe('ok');
    expect(classify({ ok: true, count: 0, stale: false })).toBe('empty');
    expect(classify({ ok: true, count: 3, stale: true })).toBe('error');
    expect(classify({ ok: false, reason: 'timeout' })).toBe('timeout');
    expect(classify({ ok: false, reason: 'waf_blocked' })).toBe('error');
    expect(classify({ ok: false, reason: null })).toBe('error');
  });

  it('bozukluk: son N sonucun tamamı başarısız (boş da başarısızdır)', () => {
    expect(isFailing(['error', 'empty'], 2)).toBe(true);
    expect(isFailing(['error'], 2)).toBe(false);
    expect(isFailing(['error', 'ok', 'error'], 2)).toBe(false);
    expect(isFailing(['timeout', 'error', 'ok'], 2)).toBe(true);
  });
});

describe('KK-021-7.3 kanarya çalıştırması', () => {
  it('beş yoklama sırayla; her biri süre ve sonuçla kaydedilir; kaynak özeti ve pencere silme', async () => {
    const store = memoryStore();
    const metrics = new Metrics();
    const alerts: SourceCanaryAlertInput[] = [];
    const res = await run(
      store,
      { anayasa_search: { ok: true, count: 0, stale: false }, mevzuat_article: 'throw' },
      alerts,
      metrics,
    );
    expect(res.runs.map((r) => r.probe)).toEqual([...SOURCE_CANARY_PROBES]);
    expect(res.runs.map((r) => r.outcome)).toEqual(['ok', 'empty', 'ok', 'ok', 'error']);
    expect(res.runs.every((r) => r.durationMs === 7)).toBe(true);
    const call = store.calls[0];
    expect(call?.historyDepth).toBe(2);
    expect(call?.purgeBefore.toISOString()).toBe('2026-10-10T02:00:00.000Z');
    expect(Object.fromEntries(call?.sources ?? [])).toEqual({
      bedesten: true,
      anayasa: false,
      uyusmazlik: true,
      mevzuat: false,
    });
    expect(metrics.get('eda_source_canary_ok', { source: 'bedesten' })).toBe(1);
    expect(metrics.get('eda_source_canary_ok', { source: 'mevzuat' })).toBe(0);
    // İlk başarısızlık eşiğin altında: e-posta yok.
    expect(alerts).toEqual([]);
  });

  it('durum değişiminde tek "bozuldu", bozuk sürerken sessiz, toparlanınca tek "düzeldi"', async () => {
    const store = memoryStore();
    const alerts: SourceCanaryAlertInput[] = [];
    await run(store, { uyap_search: FAIL }, alerts);
    expect(alerts).toHaveLength(0);
    await run(store, { uyap_search: { ok: false, reason: 'timeout' } }, alerts);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'degraded',
      changed: ['uyap_search'],
      threshold: 2,
    });
    expect(alerts[0]?.failing.uyap_search).toBe(true);
    expect(alerts[0]?.failing.anayasa_search).toBe(false);
    await run(store, { uyap_search: FAIL }, alerts);
    await run(store, { uyap_search: FAIL }, alerts);
    expect(alerts).toHaveLength(1);
    await run(store, {}, alerts);
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({ kind: 'recovered', changed: ['uyap_search'] });
    await run(store, {}, alerts);
    expect(alerts).toHaveLength(2);
  });

  it('e-posta gönderilemezse kayıt yazılmış olur ve iş hata verir', async () => {
    const store = memoryStore();
    store.history.set('mevzuat_search', ['error']);
    await expect(
      runSourceCanary({
        probes: probesFrom({ mevzuat_search: FAIL }).probes,
        store,
        sendAlert: async () => {
          throw new Error('smtp');
        },
        logger: silent,
        metrics: new Metrics(),
        threshold: 2,
      }),
    ).rejects.toThrow('kaynak durumu e-postası gönderilemedi');
    expect(store.history.get('mevzuat_search')).toEqual(['error', 'error']);
  });
});

describe('KK-021-7.3 uyarı e-postası', () => {
  const input: SourceCanaryAlertInput = {
    kind: 'degraded',
    changed: ['uyap_search', 'mevzuat_article'],
    failing: {
      uyap_search: true,
      anayasa_search: false,
      uyusmazlik_search: false,
      mevzuat_search: false,
      mevzuat_article: true,
    },
    threshold: 2,
  };

  it('Türkçe, yalnız kaynak adı ve durum; "Bedesten" sözcüğü ve iç kod anahtarı yok', async () => {
    const m = await renderSourceCanaryAlert(input, null);
    expect(m.subject).toBe('Kaynak bozulması: UYAP karar araması (+1)');
    expect(m.text).toContain('UYAP karar araması: Bozuk');
    expect(m.text).toContain('Anayasa Mahkemesi karar araması: Çalışıyor');
    expect(m.text).toContain('art arda 2 kez');
    for (const body of [m.subject, m.text, m.html]) {
      expect(body).not.toMatch(/bedesten/i);
      expect(body).not.toContain('kıdem tazminatı');
    }
    const ok = await renderSourceCanaryAlert(
      { ...input, kind: 'recovered', changed: ['anayasa_search'] },
      null,
    );
    expect(ok.subject).toBe('Kaynak düzeldi: Anayasa Mahkemesi karar araması');
  });

  it('alıcı destek adresi (APP_DOMAIN türevi), otomatik ileti başlıkları', async () => {
    const sent: { to: string; headers: Readonly<Record<string, string>> }[] = [];
    const send = alertSender(
      {
        send: async (msg) => {
          sent.push(msg);
          return { providerMessageId: 'x' };
        },
        close: () => undefined,
      },
      'ornek.test',
      () => new Date(0),
    );
    await send(input);
    expect(sent[0]?.to).toBe('destek@ornek.test');
    expect(sent[0]?.headers['Auto-Submitted']).toBe('auto-generated');
    expect(sent[0]?.headers['Message-ID']).toBe('<source-canary-degraded-0@ornek.test>');
  });
});

describe('KK-021-7.3 corpus iş dağıtıcısı', () => {
  const deps = () => ({
    probes: probesFrom({}).probes,
    store: memoryStore(),
    sendAlert: async () => undefined,
    logger: silent,
    metrics: new Metrics(),
  });

  it('kayıt: corpus kuyruğu, 05:00 TSİ zamanlayıcı, tek deneme', () => {
    const def = JOBS['source_status.canary'];
    expect(def.queue).toBe('corpus');
    expect(def.attempts).toBe(1);
    expect(def.scheduler).toEqual({
      id: 'corpus.source_status_canary',
      pattern: '0 5 * * *',
      tz: 'Europe/Istanbul',
    });
  });

  it('kayıtlı iş çalışır; kayıtsız iş ve geçersiz yük kalıcı hatadır', async () => {
    const handler = createCorpusHandler(deps);
    await expect(handler({ name: 'source_status.canary', data: { v: 1 } })).resolves.toMatchObject({
      degraded: [],
    });
    await expect(handler({ name: 'corpus.embed', data: { v: 1 } })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await expect(
      handler({ name: 'source_status.canary', data: { v: 1, query: 'x' } }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('zaman aşımında yoklamalara iptal sinyali gider', async () => {
    let aborted = false;
    const slow: ProbeCall = (signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          resolve({ ok: false, reason: 'timeout' });
        });
      });
    const handler = createCorpusHandler(
      () => ({ ...deps(), probes: { ...probesFrom({}).probes, uyap_search: slow } }),
      20,
    );
    await expect(handler({ name: 'source_status.canary', data: { v: 1 } })).rejects.toThrow(
      'zaman aşımı',
    );
    expect(aborted).toBe(true);
  });
});

describe('KK-021-7.3 hız sınırlayıcı reddi portal arızası sayılmaz', () => {
  it('queue_wait_exceeded: sınırlayıcı penceresi kadar bekleyip bir kez yeniden denenir, başarılıysa ok kalır', async () => {
    const waits: number[] = [];
    let article = 0;
    const base = probesFrom({}).probes;
    const probes: Record<Probe, ProbeCall> = {
      ...base,
      mevzuat_article: async () =>
        article++ === 0
          ? { ok: false, reason: 'queue_wait_exceeded' }
          : { ok: true, count: 1, stale: false },
    };
    const res = await runSourceCanary({
      probes,
      store: memoryStore(),
      sendAlert: async () => undefined,
      logger: silent,
      metrics: new Metrics(),
      now: () => new Date('2026-10-17T02:00:00Z'),
      tick: () => 0,
      sleep: async (ms) => {
        waits.push(ms);
      },
      threshold: 2,
      windowDays: 7,
    });
    expect(article).toBe(2);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(0);
    expect(res.runs.find((r) => r.probe === 'mevzuat_article')?.outcome).toBe('ok');
  });

  it('yeniden denemede de reddedilirse hata sayılır; başka hata nedenlerinde yeniden deneme yok', async () => {
    const waits: number[] = [];
    let calls = 0;
    const base = probesFrom({}).probes;
    const probes: Record<Probe, ProbeCall> = {
      ...base,
      mevzuat_article: async () => {
        calls++;
        return { ok: false, reason: 'queue_wait_exceeded' };
      },
      uyap_search: async () => ({ ok: false, reason: 'upstream_5xx' }),
    };
    const res = await runSourceCanary({
      probes,
      store: memoryStore(),
      sendAlert: async () => undefined,
      logger: silent,
      metrics: new Metrics(),
      now: () => new Date('2026-10-17T02:00:00Z'),
      tick: () => 0,
      sleep: async (ms) => {
        waits.push(ms);
      },
      threshold: 2,
      windowDays: 7,
    });
    expect(calls).toBe(2);
    expect(waits).toHaveLength(1);
    expect(res.runs.find((r) => r.probe === 'mevzuat_article')?.outcome).toBe('error');
    expect(res.runs.find((r) => r.probe === 'uyap_search')?.outcome).toBe('error');
  });
});
