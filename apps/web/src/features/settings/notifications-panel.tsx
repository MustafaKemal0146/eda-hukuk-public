'use client';
// Bildirim tercih matrisi çizimi (P28 D1 web dilimi; 053-08 §8.2). Veri çekmez; durum ve olaylar
// dışarıdan gelir (`settings-home.tsx`). Metinler `tr.json` `settings.notifications.*` anahtarlarından.
import { Alert, ErrorState, Icon, Skeleton, Switch } from '@eda/ui';
import { useTranslations } from 'next-intl';
import {
  cellEditable,
  cellOf,
  NOTIFICATION_CHANNELS,
  type NotificationCell,
  type NotificationChannelValue,
  type NotificationsLoadState,
  type PreferenceKindValue,
  type SaveProblem,
  visibleKinds,
} from './notifications-model.ts';

export interface NotificationsPanelProps {
  readonly state: NotificationsLoadState;
  readonly cells: readonly NotificationCell[];
  readonly emailVerified: boolean;
  /** Etkin büredeki rol; `credit_low` satırı yalnız `owner`/`admin` içindir. */
  readonly role: string | null;
  /** Kaydı süren hücre (`kind:channel`) veya `null`. */
  readonly savingKey: string | null;
  readonly problem: SaveProblem | null;
  readonly requestId: string | null;
  readonly onRetry: () => void;
  readonly onToggle: (
    kind: PreferenceKindValue,
    channel: NotificationChannelValue,
    enabled: boolean,
  ) => void;
}

export const cellKey = (kind: PreferenceKindValue, channel: NotificationChannelValue): string =>
  `${kind}:${channel}`;

function MatrixCell({
  cell,
  label,
  editable,
  busy,
  mandatoryNote,
  onToggle,
}: {
  cell: NotificationCell;
  label: string;
  editable: boolean;
  busy: boolean;
  mandatoryNote: string;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Switch
        checked={cell.enabled}
        onCheckedChange={onToggle}
        label={<span className="sr-only">{label}</span>}
        disabled={!editable || busy}
      />
      {cell.mandatory && (
        <span className="inline-flex items-center gap-1 text-caption text-fg-muted">
          <Icon icon="control.locked" size="sm" />
          {mandatoryNote}
        </span>
      )}
    </div>
  );
}

export function NotificationsPanel(props: NotificationsPanelProps) {
  const t = useTranslations('settings.notifications');
  const tl = useTranslations('legal');

  if (props.state === 'loading') {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <p role="status" className="text-body-sm text-fg-muted">
          {t('loading')}
        </p>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (props.state === 'error') {
    return (
      <ErrorState
        title={t('error.title')}
        message={t('error.body')}
        onRetry={props.onRetry}
        {...(props.requestId === null ? {} : { requestId: props.requestId })}
        labels={{
          retry: t('error.retry'),
          retrying: t('error.retrying'),
          supportCode: t('error.supportCode'),
          copy: t('error.copy'),
          copied: t('error.copied'),
        }}
      />
    );
  }

  const kinds = visibleKinds(props.role);

  return (
    <section
      id="bildirim-tercihleri"
      aria-labelledby="bildirim-tercihleri-baslik"
      className="rounded-lg border border-border bg-surface shadow-1"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 id="bildirim-tercihleri-baslik" className="text-title text-fg">
          {t('title')}
        </h2>
        <p className="mt-0.5 text-body-sm text-fg-muted">{t('body')}</p>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        <Alert tone="info">{tl('mandatory.y89')}</Alert>
        {props.problem !== null && (
          <Alert tone="danger" live>
            {props.problem === 'mandatory' ? t('mandatoryError') : t('saveFailed')}
          </Alert>
        )}
        {!props.emailVerified && <Alert tone="warning">{t('emailUnverified')}</Alert>}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body-sm">
            <caption className="sr-only">{t('matrixLabel')}</caption>
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t('kindColumn')}
                </th>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <th key={channel} scope="col" className="px-3 py-2 font-medium">
                    {t(`channels.${channel}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {kinds.map((kind) => (
                <tr key={kind}>
                  <th scope="row" className="py-3 pr-4 text-left align-top font-medium text-fg">
                    <span className="block">{t(`kinds.${kind}.label`)}</span>
                    <span className="mt-0.5 block text-caption font-normal text-fg-muted">
                      {t(`kinds.${kind}.hint`)}
                    </span>
                  </th>
                  {NOTIFICATION_CHANNELS.map((channel) => {
                    const cell = cellOf(props.cells, kind, channel);
                    return (
                      <td key={channel} className="px-3 py-3 align-top">
                        {cell === undefined ? (
                          <span aria-hidden="true" className="text-fg-subtle">
                            —
                          </span>
                        ) : (
                          <MatrixCell
                            cell={cell}
                            label={`${t(`kinds.${kind}.label`)} — ${t(`channels.${channel}`)}`}
                            editable={cellEditable(cell, props.emailVerified)}
                            busy={props.savingKey === cellKey(kind, channel)}
                            mandatoryNote={t('mandatory')}
                            onToggle={(enabled) => props.onToggle(kind, channel, enabled)}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-caption text-fg-muted">{t('pushHint')}</p>
        <p className="text-caption text-fg-muted">{t('mandatoryInfo')}</p>
      </div>
    </section>
  );
}
