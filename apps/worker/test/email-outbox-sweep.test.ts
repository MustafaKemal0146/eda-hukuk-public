// @tk TK-23
// KK-P04a-12 (KK-045-4, KK-045-13): email_outbox.sweep bayat satırı `jobId = deliveryId` ile yeniden
// kuyruğa alır; başarısız kümedeki aynı iş yeniden denenir, bekleyen/çalışan işe dokunulmaz,
// tamamlanmış kümede kalan iş kaldırılıp yeniden eklenir. Yük yalnız `{ v, deliveryId }`.
import { emailJobOptions } from '@eda/contracts/notifications';
import { createLogger } from '@eda/observability/logger';
import { describe, expect, it } from 'vitest';
import { Metrics } from '../src/metrics.ts';
import {
  type EmailOutboxSweepDeps,
  processEmailOutboxSweep,
  type RequeueJob,
  type RequeueQueue,
} from '../src/processors/maintenance/email-outbox-sweep.ts';

const IDS = [
  '0198d2a4-0000-7000-8000-0000000000e1',
  '0198d2a4-0000-7000-8000-0000000000e2',
  '0198d2a4-0000-7000-8000-0000000000e3',
  '0198d2a4-0000-7000-8000-0000000000e4',
];

function fakeDb(): EmailOutboxSweepDeps['db'] {
  const rows = IDS.map((id) => ({ id, class: 'action', template_code: 'verify_email' }));
  const q = async (sql: string) =>
    sql.startsWith('SELECT')
      ? { rows, rowCount: rows.length }
      : { rows: [], rowCount: sql.includes("'expired'") ? 2 : 1 };
  return {
    query: q as never,
    transaction: async (fn) => fn({ query: q as never }),
    end: async () => undefined,
  };
}

describe('KK-P04a-12: email_outbox.sweep yeniden kuyruğa alma', () => {
  it('iş durumuna göre ekle / yeniden dene / dokunma / kaldırıp ekle', async () => {
    const states: Record<string, string | undefined> = {
      [IDS[0] ?? '']: undefined,
      [IDS[1] ?? '']: 'failed',
      [IDS[2] ?? '']: 'active',
      [IDS[3] ?? '']: 'completed',
    };
    const calls: string[] = [];
    const added: { data: unknown; opts: unknown }[] = [];
    const queue: RequeueQueue = {
      async getJob(id) {
        const st = states[id];
        if (st === undefined) return undefined;
        const job: RequeueJob = {
          getState: async () => st,
          retry: async () => {
            calls.push(`retry:${id}`);
          },
          remove: async () => {
            calls.push(`remove:${id}`);
          },
        };
        return job;
      },
      async add(_name, data, opts) {
        added.push({ data, opts });
      },
    };
    const metrics = new Metrics();
    const out = await processEmailOutboxSweep({
      db: fakeDb(),
      queue,
      logger: createLogger({ service: 't', destination: { write: () => undefined } }),
      metrics,
    });
    expect(out).toEqual({ expired: 2, reset: 1, requeued: 3 });
    expect(calls).toEqual([`retry:${IDS[1]}`, `remove:${IDS[3]}`]);
    expect(added.map((a) => a.data)).toEqual([
      { v: 1, deliveryId: IDS[0] },
      { v: 1, deliveryId: IDS[3] },
    ]);
    expect(added[0]?.opts).toEqual(emailJobOptions(IDS[0] ?? '', 'action', 'verify_email'));
    expect(metrics.get('eda_email_requeued_total')).toBe(3);
  });
});
