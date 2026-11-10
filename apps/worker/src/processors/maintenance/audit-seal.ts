// `audit.seal` işleyicisi (043 §10.2; KK-P03c-16): bekleyen zincirleri mühürler, ardından son
// `audit.verifyLastSeals` mührü doğrular. Uyuşmazlık başına `error` günlüğü (yalnız zincir anahtarı,
// mühür kimliği ve neden) + `eda_audit_seal_mismatch_total`. İçerik ve yük loglanmaz. Çift koşu
// DB tarafında no-op'tur (ON CONFLICT + danışma kilidi).

import type { JobName } from '@eda/contracts/queues';
import {
  type AuditSealResult,
  type AuditVerifyResult,
  type JobsDb,
  runAuditSeal,
  verifyAuditSeals,
} from '@eda/db/jobs';
import type { EdaLogger } from '@eda/observability/logger';
import type { Metrics } from '../../metrics.ts';

const JOB = 'audit.seal' satisfies JobName;

export interface AuditSealDeps {
  readonly db: JobsDb;
  readonly logger: EdaLogger;
  readonly metrics: Metrics;
  readonly seal?: (db: JobsDb) => Promise<AuditSealResult>;
  readonly verify?: (db: JobsDb) => Promise<AuditVerifyResult>;
}

export interface AuditSealOutcome {
  readonly chains: number;
  readonly sealed: number;
  readonly rows: number;
  readonly checked: number;
  readonly mismatches: number;
}

export async function processAuditSeal(deps: AuditSealDeps): Promise<AuditSealOutcome> {
  const seal = deps.seal ?? ((db: JobsDb) => runAuditSeal(db));
  const verify = deps.verify ?? ((db: JobsDb) => verifyAuditSeals(db));
  const sealed = await seal(deps.db);
  const verified = await verify(deps.db);
  for (const m of verified.mismatches) {
    deps.metrics.inc('eda_audit_seal_mismatch_total');
    // kapalı olay sözlüğünde iş olayı yok; `event` alanı yazılmaz.
    deps.logger.error(
      { job: JOB, chainKey: m.chainKey, sealId: m.sealId, reason: m.reason },
      'denetim mührü doğrulaması uyuşmadı',
    );
  }
  return {
    chains: sealed.chains,
    sealed: sealed.sealed,
    rows: sealed.rows,
    checked: verified.checked,
    mismatches: verified.mismatches.length,
  };
}
