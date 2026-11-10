'use client';
// Ayarlar > Yapay zekâ API anahtarı (#54 BYOK): kaynak seçimi ("Bürodan çek" / "Kendi anahtarım"),
// büro/baro anahtarı (yalnız sahip ve yönetici) ve kişisel anahtar. Seçili kaynakta anahtar yoksa net
// uyarı verilir; platform anahtarına sessiz düşme yoktur. Veri çekmez: durum ve olaylar dışarıdan gelir.
import { Alert, Button, ErrorState, Skeleton } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { OrgKeySlot, OwnKeySlot } from './ai-key-slots.tsx';
import {
  type AiKeySaveProblem,
  type AiKeySource,
  type AiKeysLoadState,
  type AiKeysState,
  canUseOrgSource,
  missingSource,
  usesPlatformKey,
} from './ai-keys-model.ts';

export interface AiKeysPanelProps {
  readonly state: AiKeysLoadState;
  readonly keys: AiKeysState | null;
  readonly requestId: string | null;
  readonly busy: boolean;
  readonly onRetry: () => void;
  readonly onSource: (source: AiKeySource) => void;
  readonly onSaveOrg: (apiKey: string) => Promise<AiKeySaveProblem | null>;
  readonly onRemoveOrg: () => void;
  readonly onSaveOwn: (apiKey: string) => Promise<AiKeySaveProblem | null>;
  readonly onRemoveOwn: () => void;
}

export function AiKeysPanel(props: AiKeysPanelProps) {
  const t = useTranslations('settings.apiKeys');
  const keys = props.keys;

  if (props.state === 'loading') {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <p role="status" className="text-body-sm text-fg-muted">
          {t('loading')}
        </p>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (props.state === 'error' || keys === null) {
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

  const missing = missingSource(keys);
  return (
    <section
      id="api-anahtari"
      aria-labelledby="api-anahtari-baslik"
      className="rounded-lg border border-border bg-surface shadow-1"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 id="api-anahtari-baslik" className="text-title text-fg">
          {t('title')}
        </h2>
        <p className="mt-0.5 text-body-sm text-fg-muted">{t('body')}</p>
      </div>
      <div className="flex flex-col gap-6 px-5 py-5">
        {usesPlatformKey(keys) && (
          <Alert tone="info" live>
            {keys.platformLabel === null
              ? t('platformInUse')
              : t('platformInUseNamed', { name: keys.platformLabel })}
          </Alert>
        )}
        {missing !== null && (
          <Alert tone="warning" live>
            {t(missing === 'org' ? 'missing.org' : 'missing.own')}
          </Alert>
        )}
        <div className="flex flex-col gap-3">
          <h3 className="text-body-sm font-medium text-fg">{t('sourceTitle')}</h3>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={keys.source === 'org' ? 'primary' : 'outline'}
              aria-pressed={keys.source === 'org'}
              disabled={props.busy || !canUseOrgSource(keys)}
              onClick={() => props.onSource('org')}
            >
              {t('useOrg')}
            </Button>
            <Button
              variant={keys.source === 'own' ? 'primary' : 'outline'}
              aria-pressed={keys.source === 'own'}
              disabled={props.busy}
              onClick={() => props.onSource('own')}
            >
              {t('useOwn')}
            </Button>
          </div>
          {!canUseOrgSource(keys) && <p className="text-caption text-fg-muted">{t('orgNone')}</p>}
        </div>
        <OrgKeySlot
          keys={keys}
          busy={props.busy}
          onSave={props.onSaveOrg}
          onRemove={props.onRemoveOrg}
        />
        <OwnKeySlot
          keys={keys}
          busy={props.busy}
          onSave={props.onSaveOwn}
          onRemove={props.onRemoveOwn}
        />
      </div>
    </section>
  );
}
