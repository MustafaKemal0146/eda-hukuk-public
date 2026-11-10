// Yedek durumu özeti (Sistem modülü, yalnız okuma). Kaynak, yedek betiğinin (`infra/scripts/backup-run.sh`)
// ürettiği içeriksiz `status.json` (v1) kaydıdır; API konteyneri yedek deposuna ve durum ucuna ERİŞEMEZ
// (ağ/volume yok). `backup.verify` (jobs) durumu okuyup alt kümesini Valkey `eda:ops:backup-status`
// anahtarına yazar; kayıt buradan enjekte edilen kaynak işleviyle (`valkeyBackupStatus`) okunur. Kaynak yoksa,
// ulaşılamıyorsa ya da kayıt biçimsizse kart "veri yok" döner (neden koduyla). Yol, etiket, depo boyutu ve
// hata metni özete ALINMAZ: yalnız zaman damgaları, durum kodları ve bir gecikme sayısı.
import type { AdminSystemDtoValue } from '@eda/contracts/api/admin-system';
import { BACKUP_STATUS_KEY, BackupStatusSnapshot } from '@eda/contracts/jobs/maintenance';

type Backup = AdminSystemDtoValue['backup'];

export const BACKUP_UNAVAILABLE = (reason: 'no_source' | 'unreachable' | 'invalid'): Backup => ({
  available: false,
  unavailableReason: reason,
  generatedAt: null,
  overall: null,
  lastFullAt: null,
  lastRunOk: null,
  lastRunAt: null,
  walLastArchivedAt: null,
  walLagSeconds: null,
  offsiteWalSyncAt: null,
  restoreDrillAt: null,
  restoreDrillOk: null,
});

/** Ham kaydı (JSON ayrıştırılmış) özete çevirir; `now` WAL gecikmesini hesaplamak içindir. */
export function backupSummaryFrom(raw: unknown, now: Date): Backup {
  const parsed = BackupStatusSnapshot.safeParse(raw);
  if (!parsed.success) return BACKUP_UNAVAILABLE('invalid');
  const s = parsed.data;
  const walAt = s.pgbackrest.wal?.lastArchivedAt ?? null;
  return {
    available: true,
    unavailableReason: null,
    generatedAt: s.generatedAt,
    overall: s.overall,
    lastFullAt: s.pgbackrest.lastFull?.stoppedAt ?? null,
    lastRunOk: s.lastRun == null ? null : s.lastRun.state === 'ok',
    lastRunAt: s.lastRun?.at ?? null,
    walLastArchivedAt: walAt,
    walLagSeconds:
      walAt === null ? null : Math.max(0, Math.floor((now.getTime() - Date.parse(walAt)) / 1000)),
    offsiteWalSyncAt: s.offsite?.pg?.lastWalSyncAt ?? null,
    restoreDrillAt: s.restoreDrill?.at ?? null,
    restoreDrillOk: s.restoreDrill == null ? null : s.restoreDrill.ok,
  };
}

/**
 * Valkey kaynak işlevi: `backup.verify` henüz yazmadıysa `null` ("veri yok"), bozuk JSON biçimsiz sayılır
 * (`invalid`), bağlantı hatası çağırana yayılır (`unreachable`). Yalnız GET (ACL `%R~eda:ops:*`).
 */
export function valkeyBackupStatus(redis: {
  get(key: string): Promise<string | null>;
}): () => Promise<unknown> {
  return async () => {
    const raw = await redis.get(BACKUP_STATUS_KEY);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return { v: 'bozuk' };
    }
  };
}
