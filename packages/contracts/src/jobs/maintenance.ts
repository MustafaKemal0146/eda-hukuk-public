// `maintenance` kuyruğu yük şemaları (043 §3.2, §10). Zamanlayıcıdan gelen bakım işleri zarf dışında
// alan taşımaz (`{ v: 1 }`); diğer bakım işleri ilgili promptlarda eklenir.
import { z } from 'zod';
import { JobEnvelope } from './envelope.ts';

/** `audit.seal` (043 §10.2): zarfın kendisi; ek alan yok. */
export const AuditSealPayload = JobEnvelope.extend({}).strict();
export type AuditSealPayload = z.infer<typeof AuditSealPayload>;

/** `backup.verify` (043 §10.11): zamanlayıcı işi; zarfın kendisi, ek alan yok. */
export const BackupVerifyPayload = JobEnvelope.extend({}).strict();
export type BackupVerifyPayload = z.infer<typeof BackupVerifyPayload>;

/**
 * Yedek durum özeti anahtarı (002 §18 `eda:ops:backup-status`): `backup.verify` yazar (ACL `eda_jobs`
 * `~eda:ops:*`), api Sistem modülü salt okur (`eda_api` `%R~eda:ops:*`). Değer `BackupStatusSnapshot` JSON'udur.
 */
export const BACKUP_STATUS_KEY = 'eda:ops:backup-status';

const StatusAt = z.iso.datetime({ offset: true }).nullable().optional();

/**
 * Yedek betiğinin (`infra/scripts/backup-run.sh`) `status.json` v1 kaydının kullanılan alt kümesi. Fazlalık
 * alanlar (yol, etiket, depo boyutu, segment adları, hata listesi) ayrıştırmada ATILIR; Valkey'e yalnız bu alt
 * küme yazılır. `restoreDrill` isteğe bağlıdır (aylık tatbikat sonucu).
 */
export const BackupStatusSnapshot = z.object({
  v: z.literal(1),
  generatedAt: z.iso.datetime({ offset: true }),
  overall: z.enum(['ok', 'degraded', 'error']),
  pgbackrest: z.object({
    lastFull: z.object({ stoppedAt: StatusAt }).nullable().optional(),
    wal: z.object({ lastArchivedAt: StatusAt }).nullable().optional(),
    lastVerify: z.object({ ok: z.boolean().nullable(), at: StatusAt }).nullable().optional(),
  }),
  lastRun: z
    .object({ state: z.enum(['ok', 'failed', 'running', 'disabled']), at: StatusAt })
    .nullable()
    .optional(),
  offsite: z
    .object({ pg: z.object({ lastWalSyncAt: StatusAt }).nullable().optional() })
    .nullable()
    .optional(),
  restoreDrill: z.object({ ok: z.boolean(), at: StatusAt }).nullable().optional(),
});
export type BackupStatusSnapshot = z.infer<typeof BackupStatusSnapshot>;
