'use client';
// Kaynak durumu kartı (yalnız okuma; 021 §7.3): günlük kanarya yoklamaları (UYAP karar araması, Anayasa
// Mahkemesi, Uyuşmazlık Mahkemesi, mevzuat arama, mevzuat madde getirme), son kontrol zamanı, durum
// rozeti ve son N gün başarı oranı. Sorgu metni, yanıt veya hata metni gösterilmez.
import { Badge, Card, Table, Td, Th, Tr } from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { PROBE_ICON, PROBE_TONE, type SourceCanaryDto, successPercent } from './model.ts';

export function SourceCanaryCard({ canary }: { canary: SourceCanaryDto }) {
  const t = useTranslations('system.sources');
  const format = useFormatter();
  const when = (iso: string | null) =>
    iso === null
      ? t('never')
      : format.dateTime(new Date(iso), {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

  return (
    <section aria-labelledby="kaynak-durumu" className="flex flex-col gap-3">
      <h2 id="kaynak-durumu" className="text-title text-fg">
        {t('title')}
      </h2>
      <p className="text-body-sm text-fg-muted">
        {t('intro', { days: canary.windowDays, threshold: canary.failThreshold })}
      </p>
      {!canary.available ? (
        <Card className="p-5">
          <p className="text-body-sm text-fg-muted">{t('unavailable')}</p>
        </Card>
      ) : (
        <Table caption={t('title')}>
          <thead>
            <tr>
              <Th>{t('col.source')}</Th>
              <Th>{t('col.state')}</Th>
              <Th>{t('col.lastChecked')}</Th>
              <Th>{t('col.successRate', { days: canary.windowDays })}</Th>
            </tr>
          </thead>
          <tbody>
            {canary.items.map((p) => {
              const pct = successPercent(p);
              return (
                <Tr key={p.probe}>
                  <Td className="font-medium">{t(`probe.${p.probe}`)}</Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={PROBE_TONE[p.state]} icon={PROBE_ICON[p.state]}>
                        {t(`state.${p.state}`)}
                      </Badge>
                      {p.lastOutcome !== null && p.lastOutcome !== 'ok' && (
                        <span className="text-caption text-fg-muted">
                          {t(`outcome.${p.lastOutcome}`)}
                          {p.degraded && ` · ${t('consecutive', { count: p.consecutiveFailures })}`}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <span className="text-body-sm text-fg">{when(p.lastCheckedAt)}</span>
                    {p.lastDurationMs !== null && (
                      <span className="block text-caption text-fg-muted tabular-nums">
                        {t('duration', { ms: format.number(p.lastDurationMs) })}
                      </span>
                    )}
                  </Td>
                  <Td className="tabular-nums">
                    {pct === null
                      ? t('noRuns')
                      : t('rate', {
                          pct: format.number(pct),
                          ok: format.number(p.windowOk),
                          runs: format.number(p.windowRuns),
                        })}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </section>
  );
}
