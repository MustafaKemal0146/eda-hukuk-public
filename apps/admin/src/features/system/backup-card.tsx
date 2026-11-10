'use client';
// Yedek durumu kartı (yalnız okuma): son tam yedek, son çalışma, WAL arşiv gecikmesi, son geri yükleme
// tatbikatı. Veri yoksa nedeni açıklanır; yol, etiket, boyut veya hata metni hiç gösterilmez.
import { Badge, Card } from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { BACKUP_ICON, BACKUP_TONE, type BackupDto, walLagMinutes } from './model.ts';

export function BackupCard({ backup }: { backup: BackupDto }) {
  const t = useTranslations('system.backup');
  const format = useFormatter();
  const when = (iso: string | null) =>
    iso === null
      ? t('none')
      : format.dateTime(new Date(iso), {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  const lag = walLagMinutes(backup);

  return (
    <section aria-labelledby="yedekleme" className="flex flex-col gap-3">
      <h2 id="yedekleme" className="text-title text-fg">
        {t('title')}
      </h2>
      <p className="text-body-sm text-fg-muted">{t('intro')}</p>
      {!backup.available || backup.overall === null ? (
        <Card className="flex flex-col gap-1 p-5">
          <p className="text-body font-medium text-fg">{t('unavailable.title')}</p>
          <p className="text-body-sm text-fg-muted">
            {t(`unavailable.${backup.unavailableReason ?? 'no_source'}`)}
          </p>
        </Card>
      ) : (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={BACKUP_TONE[backup.overall]} icon={BACKUP_ICON[backup.overall]} size="md">
              {t(`overall.${backup.overall}`)}
            </Badge>
            <span className="text-caption text-fg-subtle">
              {t('generatedAt', { time: when(backup.generatedAt) })}
            </span>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              <dt className="text-caption text-fg-subtle">{t('lastFull')}</dt>
              <dd className="text-body text-fg">{when(backup.lastFullAt)}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-caption text-fg-subtle">{t('lastRun')}</dt>
              <dd className="flex flex-wrap items-center gap-2 text-body text-fg">
                {backup.lastRunOk === null ? (
                  t('none')
                ) : (
                  <Badge
                    tone={backup.lastRunOk ? 'success' : 'danger'}
                    icon={backup.lastRunOk ? 'status.verified' : 'notice.error'}
                  >
                    {backup.lastRunOk ? t('runOk') : t('runFailed')}
                  </Badge>
                )}
                <span className="text-caption text-fg-muted">{when(backup.lastRunAt)}</span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-caption text-fg-subtle">{t('walLag')}</dt>
              <dd className="text-body tabular-nums text-fg">
                {lag === null ? t('none') : t('walLagValue', { minutes: format.number(lag) })}
              </dd>
              {backup.walLastArchivedAt !== null && (
                <dd className="text-caption text-fg-muted">
                  {t('walLastArchived', { time: when(backup.walLastArchivedAt) })}
                </dd>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-caption text-fg-subtle">{t('drill')}</dt>
              <dd className="flex flex-wrap items-center gap-2 text-body text-fg">
                {backup.restoreDrillAt === null ? (
                  t('none')
                ) : (
                  <>
                    {backup.restoreDrillOk !== null && (
                      <Badge
                        tone={backup.restoreDrillOk ? 'success' : 'danger'}
                        icon={backup.restoreDrillOk ? 'status.verified' : 'notice.error'}
                      >
                        {backup.restoreDrillOk ? t('drillOk') : t('drillFailed')}
                      </Badge>
                    )}
                    <span className="text-caption text-fg-muted">
                      {when(backup.restoreDrillAt)}
                    </span>
                  </>
                )}
              </dd>
            </div>
          </dl>
          {backup.offsiteWalSyncAt !== null && (
            <p className="text-caption text-fg-muted">
              {t('offsiteWal')}: {when(backup.offsiteWalSyncAt)}
            </p>
          )}
        </Card>
      )}
    </section>
  );
}
