'use client';
// API anahtarı bölümleri (#54 BYOK): büro/baro anahtarı (yalnız sahip ve yönetici yazar) ve kişisel
// anahtar. Anahtar değeri ekranda hiç görünmez; yalnız son 4 karakter ve bağlantı durumu gösterilir.
import { Badge, Button } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { AiKeyForm } from './ai-key-form.tsx';
import { type AiKeySaveProblem, type AiKeysState, maskedLast4 } from './ai-keys-model.ts';

function SlotHeader({ title, configured }: { title: string; configured: boolean }) {
  const t = useTranslations('settings.apiKeys');
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-body-sm font-medium text-fg">{title}</h3>
      <Badge tone={configured ? 'success' : 'neutral'}>
        {t(configured ? 'connected' : 'notConnected')}
      </Badge>
    </div>
  );
}

function CurrentKey({ last4 }: { last4: string | null }) {
  const t = useTranslations('settings.apiKeys');
  const masked = maskedLast4(last4);
  if (masked === null) return null;
  return (
    <p className="flex items-center gap-2 text-body-sm text-fg">
      <span className="text-fg-muted">{t('currentKey')}</span>
      <code className="font-mono">{masked}</code>
    </p>
  );
}

export interface SlotProps {
  readonly keys: AiKeysState;
  readonly busy: boolean;
  readonly onSave: (apiKey: string) => Promise<AiKeySaveProblem | null>;
  readonly onRemove: () => void;
}

export function OrgKeySlot({ keys, busy, onSave, onRemove }: SlotProps) {
  const t = useTranslations('settings.apiKeys');
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-5">
      <SlotHeader title={t('orgTitle')} configured={keys.org.configured} />
      {keys.org.configured && <CurrentKey last4={keys.org.last4} />}
      {keys.canManageOrg ? (
        <>
          <AiKeyForm
            label={t('orgKeyLabel')}
            saveLabel={t(keys.org.configured ? 'replace' : 'save')}
            disabled={busy}
            onSave={onSave}
          />
          {keys.org.configured && (
            <div>
              <Button variant="ghost" disabled={busy} onClick={onRemove}>
                {t('removeOrg')}
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="text-caption text-fg-muted">{t('orgReadOnly')}</p>
      )}
    </div>
  );
}

export function OwnKeySlot({ keys, busy, onSave, onRemove }: SlotProps) {
  const t = useTranslations('settings.apiKeys');
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-5">
      <SlotHeader title={t('ownTitle')} configured={keys.own.configured} />
      {keys.own.configured && <CurrentKey last4={keys.own.last4} />}
      <AiKeyForm
        label={t('ownKeyLabel')}
        saveLabel={t(keys.own.configured ? 'replace' : 'save')}
        disabled={busy}
        onSave={onSave}
      />
      {keys.own.configured && (
        <div>
          <Button variant="ghost" disabled={busy} onClick={onRemove}>
            {t('removeOwn')}
          </Button>
        </div>
      )}
    </div>
  );
}
