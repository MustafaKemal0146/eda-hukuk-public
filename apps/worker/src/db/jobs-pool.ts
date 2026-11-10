// `eda_jobs` havuzu (031 §10, 043 §13): yalnız jobs girişi kullanır (dependency-cruiser
// `worker-no-maintenance`, `db-jobs-subpath`). Açılışta rol güvencesi: current_user = eda_jobs,
// BYPASSRLS, süper kullanıcı değil; sağlanmazsa havuz kapatılır ve hata yukarı taşınır.
import { assertJobsRole, type JobsDb, jobsDb } from '@eda/db/jobs';

export async function openJobsDb(
  open: () => JobsDb = jobsDb,
  assertRole: (db: JobsDb) => Promise<void> = assertJobsRole,
): Promise<JobsDb> {
  const db = open();
  try {
    await assertRole(db);
    return db;
  } catch (err) {
    await db.end().catch(() => undefined);
    throw err;
  }
}
