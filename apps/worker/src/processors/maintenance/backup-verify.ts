// `backup.verify` işleyicisi (043 §10.11; 073 §7.1): `backup` konteynırının içeriksiz durum ucunu
// (`BACKUP_STATUS_URL`, yalnız iç `data` ağı; Basic kimlik `eda_jobs:<backup_status_token>`) okur ve
// `BackupStatusSnapshot` alt kümesini Valkey `eda:ops:backup-status` anahtarına yazar (api Sistem modülü okur).
// DB yetkisi yok; dış HTTP yok. Son başarılı doğrulama `eda_backup_last_verify_success_timestamp` olarak
// yayınlanır; son yedek çalıştırması başarısız ya da `alerts.backupVerifyMaxHours`'tan eskiyse `warn` alarm
// günlüğü yazılır. Yol, etiket, hata metni ve belirteç hiçbir yere yazılmaz.
import { readFileSync } from 'node:fs';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { BACKUP_STATUS_KEY, BackupStatusSnapshot } from '@eda/contracts/jobs/maintenance';
import { type JobName, timeoutMs } from '@eda/contracts/queues';
import type { EdaLogger } from '@eda/observability/logger';
import type { Metrics } from '../../metrics.ts';

const JOB = 'backup.verify' satisfies JobName;
/** Basic kimlikteki kullanıcı adı (infra/backup/entrypoint.sh httpd.conf ile aynı). */
const STATUS_USER = 'eda_jobs';

export class BackupStatusError extends Error {
  override name = 'BackupStatusError';
}

export interface BackupVerifyDeps {
  readonly url: string | undefined;
  readonly tokenFile: string | undefined;
  readonly store: { set(key: string, value: string): Promise<unknown> };
  readonly logger: EdaLogger;
  readonly metrics: Metrics;
  readonly fetch?: typeof fetch;
  readonly readToken?: (file: string) => string;
  readonly now?: () => Date;
}

export type BackupVerifyOutcome =
  | { readonly state: 'skipped' }
  | {
      readonly state: 'stored';
      readonly overall: BackupStatusSnapshot['overall'];
      readonly alarm: boolean;
    };

export async function processBackupVerify(deps: BackupVerifyDeps): Promise<BackupVerifyOutcome> {
  if (deps.url === undefined || deps.url === '') {
    deps.logger.info({ event: 'job.skipped', job: JOB, reason: 'status_url_unset' });
    return { state: 'skipped' };
  }
  const headers: Record<string, string> = { accept: 'application/json' };
  if (deps.tokenFile !== undefined && deps.tokenFile !== '') {
    const token = (deps.readToken ?? ((f: string) => readFileSync(f, 'utf8')))(
      deps.tokenFile,
    ).trim();
    headers.authorization = `Basic ${Buffer.from(`${STATUS_USER}:${token}`).toString('base64')}`;
  }
  const res = await (deps.fetch ?? fetch)(deps.url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs('maintenance')),
  });
  if (!res.ok) throw new BackupStatusError(`yedek durum ucu ${res.status} döndü`);
  const parsed = BackupStatusSnapshot.safeParse(await res.json());
  if (!parsed.success)
    throw new BackupStatusError('yedek durum kaydı biçimsiz (status.json v1 bekleniyor)');
  const s = parsed.data;
  await deps.store.set(BACKUP_STATUS_KEY, JSON.stringify(s));

  const verify = s.pgbackrest.lastVerify;
  if (verify?.ok === true && verify.at != null) {
    deps.metrics.set(
      'eda_backup_last_verify_success_timestamp',
      Math.floor(Date.parse(verify.at) / 1000),
    );
  }
  const now = (deps.now ?? (() => new Date()))().getTime();
  const maxMs = CONFIG_DEFAULTS['alerts.backupVerifyMaxHours'] * 3_600_000;
  const lastOkAt =
    s.lastRun?.state === 'ok' && s.lastRun.at != null ? Date.parse(s.lastRun.at) : null;
  const alarm = s.overall === 'error' || lastOkAt === null || now - lastOkAt > maxMs;
  if (alarm) {
    deps.logger.warn({
      event: 'backup.verify.alarm',
      job: JOB,
      overall: s.overall,
      lastRunState: s.lastRun?.state ?? 'none',
    });
  }
  return { state: 'stored', overall: s.overall, alarm };
}
