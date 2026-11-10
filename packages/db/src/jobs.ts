// `@eda/db/jobs` (031 §4.1, §10, §11): `eda_jobs` havuzu ve bakım işlerinin DB tarafı. Yalnız
// apps/worker/src/jobs.ts, apps/worker/src/jobs/**, apps/worker/src/db/jobs-pool.ts ve
// apps/worker/src/processors/maintenance/** içe aktarır (dependency-cruiser `db-jobs-subpath`).
// Ham `Pool` dışa verilmez.
import { loadJobsPoolConfig } from './config/load.ts';
import { type JobsDb, wrapJobsPool } from './jobs/db.ts';
import { createPool, type PoolConfig } from './pool.ts';

export {
  type AuditSealOptions,
  type AuditSealResult,
  type AuditVerifyOptions,
  type AuditVerifyResult,
  PLATFORM_CHAIN,
  runAuditSeal,
  type SealMismatch,
  verifyAuditSeals,
} from './jobs/audit-seal.ts';
export type { JobsDb, JobsQueryable } from './jobs/db.ts';
export {
  type EmailOutboxSweepOptions,
  type EmailOutboxSweepResult,
  runEmailOutboxSweep,
  SENDING_STALE_MIN,
  type SweptDelivery,
} from './jobs/email-outbox-sweep.ts';
export type { PoolConfig } from './pool.ts';

/** Yapılandırmayla `eda_jobs` erişimi (sır yalnız dosyadan okunur). */
export function createJobsDb(cfg: PoolConfig): JobsDb {
  return wrapJobsPool(createPool('jobs', cfg));
}

/** Env'den (`PG_JOBS_*`, boyut `db.jobsPoolMax`) `eda_jobs` erişimi. */
export function jobsDb(): JobsDb {
  return createJobsDb(loadJobsPoolConfig());
}

export class JobsRoleError extends Error {
  override name = 'JobsRoleError';
}

/**
 * Açılış güvenceleri (043 §13): bağlantı rolü `eda_jobs`, BYPASSRLS açık, süper kullanıcı değil.
 * Biri sağlanmazsa `JobsRoleError` (jobs başlamaz).
 */
export async function assertJobsRole(db: JobsDb): Promise<void> {
  const r = await db.query<{ usr: string; bypass: boolean; superuser: boolean }>(
    `SELECT current_user AS usr, r.rolbypassrls AS bypass, r.rolsuper AS superuser
     FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`,
  );
  const row = r.rows[0];
  if (row === undefined || row.usr !== 'eda_jobs') {
    throw new JobsRoleError('jobs bağlantı rolü eda_jobs olmalı');
  }
  if (!row.bypass) throw new JobsRoleError('eda_jobs rolünde BYPASSRLS beklenir');
  if (row.superuser) throw new JobsRoleError('jobs süper kullanıcıyla çalışamaz');
}
