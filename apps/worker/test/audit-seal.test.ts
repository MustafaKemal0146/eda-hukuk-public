// @tk TK-26
// KK-P03c-16 (KK-043-12 işleyici kısmı): audit.seal önce mühürler sonra doğrular; uyuşmazlık başına
// error günlüğü (yalnız kimlik ve neden) ve eda_audit_seal_mismatch_total artışı.
import { createLogger } from '@eda/observability/logger';
import { describe, expect, it } from 'vitest';
import { Metrics } from '../src/metrics.ts';
import { processAuditSeal } from '../src/processors/maintenance/audit-seal.ts';

// Tipler işleyici imzasından türetilir: testler @eda/db/jobs'u doğrudan içe aktarmaz (db-jobs-subpath).
type Deps = Parameters<typeof processAuditSeal>[0];
type JobsDb = Deps['db'];
type AuditVerifyResult = Awaited<ReturnType<NonNullable<Deps['verify']>>>;

const db: JobsDb = {
  query: () => Promise.reject(new Error('sahte db sorgu almaz')),
  transaction: () => Promise.reject(new Error('sahte db işlem almaz')),
  end: () => Promise.resolve(),
};

const CHAIN = '00000000-0000-4000-8000-000000000001';

function setup(verifyResult: AuditVerifyResult) {
  const lines: string[] = [];
  const order: string[] = [];
  const metrics = new Metrics();
  const deps = {
    db,
    metrics,
    logger: createLogger({ service: 'test', destination: { write: (l: string) => lines.push(l) } }),
    seal: (d: JobsDb) => {
      expect(d).toBe(db);
      order.push('seal');
      return Promise.resolve({ chains: 2, sealed: 1, rows: 7 });
    },
    verify: (d: JobsDb) => {
      expect(d).toBe(db);
      order.push('verify');
      return Promise.resolve(verifyResult);
    },
  };
  return { deps, lines, order, metrics };
}

describe('KK-P03c-16: audit.seal işleyicisi', () => {
  it('mühürler, sonra doğrular; uyuşmazlık yoksa sayaç 0 ve error günlüğü yok', async () => {
    const s = setup({ checked: 3, mismatches: [] });
    await expect(processAuditSeal(s.deps)).resolves.toEqual({
      chains: 2,
      sealed: 1,
      rows: 7,
      checked: 3,
      mismatches: 0,
    });
    expect(s.order).toEqual(['seal', 'verify']);
    expect(s.metrics.get('eda_audit_seal_mismatch_total')).toBe(0);
    expect(s.lines).toEqual([]);
  });

  it('her uyuşmazlık sayaç artırır ve yalnız kimlik/neden içeren error günlüğü yazar', async () => {
    const s = setup({
      checked: 5,
      mismatches: [
        { chainKey: CHAIN, sealId: 'a1', reason: 'merkle_root' },
        { chainKey: 'platform', sealId: 'b2', reason: 'row_count' },
      ],
    });
    const out = await processAuditSeal(s.deps);
    expect(out.mismatches).toBe(2);
    expect(s.metrics.get('eda_audit_seal_mismatch_total')).toBe(2);
    expect(s.metrics.render()).toContain('eda_audit_seal_mismatch_total 2');
    const logs = s.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      level: 'error',
      job: 'audit.seal',
      chainKey: CHAIN,
      sealId: 'a1',
      reason: 'merkle_root',
    });
    expect(Object.keys(logs[1] ?? {}).sort()).toEqual(
      ['chainKey', 'job', 'level', 'msg', 'reason', 'sealId', 'service', 'time'].sort(),
    );
  });
});
