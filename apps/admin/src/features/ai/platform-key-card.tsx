'use client';
// "Platform ortak anahtarı" kartı: süper yönetici sistem varsayılan Anthropic anahtarını girer,
// değiştirir, siler ve ona görünen ad verir; düşüşü açıp kapatır; platform geneli günlük sınırları
// (kullanıcı turu/token, büro maliyet tavanı) ayarlar. Anahtar alanı password türündedir, kayıttan hemen
// sonra temizlenir ve hiçbir yerde saklanmaz; hiçbir yanıt anahtarı taşımaz (yalnız ad, son 4 hane, durum).
// Env bayrağı SERT kapıdır (üretimde düşüş her zaman kapalı); buradaki anahtar ek yumuşak kapıdır.
// Her değişiklik yeniden doğrulama (step-up) ister; denetim kaydı sunucuda yazılır.
import type { AdminAiPlatformKeyDtoValue } from '@eda/contracts/api/admin-ai-keys';
import { AI_API_KEY_PATTERN } from '@eda/contracts/api/ai-keys';
import { Alert, AlertDialog, Badge, Button, Card, Dialog, Field, Input, Switch } from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useState } from 'react';
import { AdminApiError, adminFetch } from '../../lib/admin-api.ts';
import {
  capDraftFromCard,
  draftFromCard,
  isLabelValid,
  type KeyErrorKey,
  keyErrorKey,
  microToUsd,
  type PlatformLimitsDraft,
  parsePlatformCap,
  parsePlatformLimits,
  platformState,
  platformTone,
} from './ai-keys-model.ts';
import type { StepUpRun } from './key-dialogs.tsx';

type Modal = null | 'key' | 'label' | 'remove';

interface Props {
  readonly card: AdminAiPlatformKeyDtoValue;
  readonly run: StepUpRun;
  /** Yazma yetkisi (süper yönetici); yoksa kart salt okurdur. */
  readonly canWrite: boolean;
  readonly onChanged: () => void | Promise<void>;
}

const PK = '/ai/keys/platform';

export function PlatformKeyCard({ card, run, canWrite, onChanged }: Props) {
  const t = useTranslations('ai.keys.platform');
  const te = useTranslations('ai.keys.error');
  const format = useFormatter();
  const [modal, setModal] = useState<Modal>(null);
  const [secret, setSecret] = useState('');
  const [label, setLabel] = useState('');
  const [draft, setDraft] = useState<PlatformLimitsDraft>(() => draftFromCard(card));
  const [badField, setBadField] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState(() => capDraftFromCard(card));
  const [capBad, setCapBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<KeyErrorKey | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Sunucudaki değerler değişince (kayıt, yenileme) form taslağı kartla eşitlenir.
  useEffect(() => {
    setDraft(draftFromCard(card));
    setCapDraft(capDraftFromCard(card));
  }, [card]);

  const state = platformState(card);
  const hasPanelKey = card.key.source === 'panel';
  const usd = (micro: number) =>
    t('usd', {
      value: format.number(microToUsd(micro), {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    });

  function closeModal() {
    setModal(null);
    setSecret('');
    setError(null);
  }

  async function perform(
    fn: () => Promise<unknown>,
    okText: string,
    after?: () => void,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await run(fn);
      // Anahtar alanı hemen temizlenir; başarıdan sonra hiçbir yerde tutulmaz.
      setSecret('');
      after?.();
      setNotice(okText);
      await onChanged();
      return true;
    } catch (e) {
      const api = e instanceof AdminApiError ? e : null;
      setError(keyErrorKey(api?.code, api?.status));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const keyValid = AI_API_KEY_PATTERN.test(secret.trim());
  const labelValid = isLabelValid(label);

  async function saveKey() {
    if (busy || !keyValid || !labelValid) return;
    const ok = await perform(
      () =>
        adminFetch(`${PK}/key`, {
          method: 'PUT',
          body: { apiKey: secret.trim(), label: label.trim() },
        }),
      t('saved'),
      () => setModal(null),
    );
    if (ok) setLabel('');
  }

  async function saveLabel() {
    if (busy || !labelValid) return;
    await perform(
      () => adminFetch(`${PK}/key/label`, { method: 'PUT', body: { label: label.trim() } }),
      t('renamed'),
      () => setModal(null),
    );
  }

  async function removeKey() {
    await perform(
      () => adminFetch(`${PK}/key`, { method: 'DELETE' }),
      t('removed'),
      () => setModal(null),
    );
  }

  async function toggle(enabled: boolean) {
    await perform(
      () => adminFetch(`${PK}/fallback`, { method: 'PUT', body: { enabled } }),
      enabled ? t('switchedOn') : t('switchedOff'),
    );
  }

  async function saveLimits(e?: FormEvent, reset = false) {
    e?.preventDefault();
    const parsed = reset
      ? ({
          ok: true,
          value: { userTurnsPerDay: null, userTokensPerDay: null, orgDailyCapMicroUsd: null },
        } as const)
      : parsePlatformLimits(draft);
    if (!parsed.ok) {
      setBadField(parsed.field);
      return;
    }
    setBadField(null);
    await perform(
      () => adminFetch(`${PK}/limits`, { method: 'PUT', body: parsed.value }),
      reset ? t('limitsReset') : t('limitsSaved'),
    );
  }

  async function saveCap(e?: FormEvent, reset = false) {
    e?.preventDefault();
    const parsed = reset
      ? ({ ok: true, value: { platformDailyCapMicroUsd: null } } as const)
      : parsePlatformCap(capDraft);
    if (!parsed.ok) {
      setCapBad(true);
      return;
    }
    setCapBad(false);
    await perform(
      () => adminFetch(`${PK}/cap`, { method: 'PUT', body: parsed.value }),
      reset ? t('capReset') : t('capSaved'),
    );
  }

  const when = (iso: string | null) =>
    iso === null
      ? '—'
      : format.dateTime(new Date(iso), { day: 'numeric', month: 'long', year: 'numeric' });
  const sourceText =
    card.key.source === 'panel'
      ? t('source.panel')
      : card.key.source === 'server_secret'
        ? t('source.server_secret')
        : t('source.none');

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-body font-medium text-fg">{t('title')}</p>
          <p className="text-body-sm text-fg-muted">{t('intro')}</p>
        </div>
        <Badge tone={platformTone(state)}>{t(`state.${state}`)}</Badge>
      </div>

      {!card.fallbackEnabled && <Alert tone="info">{t('envClosed')}</Alert>}
      {notice !== null && (
        <p role="status" className="text-body-sm text-success">
          {notice}
        </p>
      )}
      {error !== null && modal === null && (
        <p role="alert" className="text-body-sm text-danger">
          {te(error)}
        </p>
      )}

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-caption text-fg-subtle">{t('envGate')}</dt>
          <dd>
            <Badge tone={card.fallbackEnabled ? 'success' : 'neutral'}>
              {card.fallbackEnabled ? t('on') : t('off')}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className="text-caption text-fg-subtle">{t('keySource')}</dt>
          <dd className="text-body-sm text-fg">{sourceText}</dd>
        </div>
        <div>
          <dt className="text-caption text-fg-subtle">{t('keyLabel')}</dt>
          <dd className="text-body-sm text-fg">{card.key.label ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-caption text-fg-subtle">{t('keyLast4')}</dt>
          <dd className="font-mono text-body-sm text-fg">{card.key.last4 ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-caption text-fg-subtle">{t('keyUpdated')}</dt>
          <dd className="text-body-sm text-fg">{when(card.key.updatedAt)}</dd>
        </div>
      </dl>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setLabel(card.key.label ?? '');
              setModal('key');
            }}
          >
            {hasPanelKey ? t('replaceKey') : t('setKey')}
          </Button>
          {hasPanelKey && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setLabel(card.key.label ?? '');
                  setModal('label');
                }}
              >
                {t('rename')}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setModal('remove');
                }}
              >
                {t('removeKey')}
              </Button>
            </>
          )}
        </div>
      )}

      {canWrite && (
        <Switch
          checked={card.fallbackSwitch}
          onCheckedChange={(v) => void toggle(v)}
          disabled={busy}
          label={t('switchLabel')}
          description={t('switchHint')}
        />
      )}

      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(
          [
            ['turns', card.last24h.turns],
            ['users', card.last24h.users],
            ['orgs', card.last24h.orgs],
            ['tokens', card.last24h.tokens],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-caption text-fg-subtle">
              {t(k)} · {t('last24h')}
            </dt>
            <dd className="text-body tabular-nums text-fg">{format.number(v)}</dd>
          </div>
        ))}
        <div>
          <dt className="text-caption text-fg-subtle">{t('cost')}</dt>
          <dd className="text-body tabular-nums text-fg">
            {usd(card.last24h.estimatedCostMicroUsd)}
          </dd>
        </div>
      </dl>

      <form
        onSubmit={(e) => void saveLimits(e)}
        className="flex flex-col gap-3 border-t border-border pt-4"
        noValidate
        aria-labelledby="platform-limits-title"
      >
        <div>
          <p id="platform-limits-title" className="text-body font-medium text-fg">
            {t('limitsTitle')}
          </p>
          <p className="text-body-sm text-fg-muted">{t('limitsIntro')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label={t('limitTurns')}
            description={t('limitDefault', {
              value: format.number(card.limits.defaults.userTurnsPerDay),
            })}
            {...(badField === 'userTurnsPerDay' ? { error: t('limitInvalid') } : {})}
          >
            <Input
              inputMode="numeric"
              value={draft.userTurnsPerDay}
              onChange={(e) => setDraft({ ...draft, userTurnsPerDay: e.target.value })}
              placeholder={String(card.limits.defaults.userTurnsPerDay)}
              disabled={!canWrite}
              maxLength={6}
            />
          </Field>
          <Field
            label={t('limitTokens')}
            description={t('limitDefault', {
              value: format.number(card.limits.defaults.userTokensPerDay),
            })}
            {...(badField === 'userTokensPerDay' ? { error: t('limitInvalid') } : {})}
          >
            <Input
              inputMode="numeric"
              value={draft.userTokensPerDay}
              onChange={(e) => setDraft({ ...draft, userTokensPerDay: e.target.value })}
              placeholder={String(card.limits.defaults.userTokensPerDay)}
              disabled={!canWrite}
              maxLength={10}
            />
          </Field>
          <Field
            label={t('limitOrgCap')}
            description={t('limitOrgDefault', {
              floor: usd(card.limits.defaults.orgDailyCapFloorMicroUsd),
              perSeat: usd(card.limits.defaults.orgDailyCapPerSeatMicroUsd),
            })}
            {...(badField === 'orgDailyCapUsd' ? { error: t('limitInvalid') } : {})}
          >
            <Input
              inputMode="decimal"
              value={draft.orgDailyCapUsd}
              onChange={(e) => setDraft({ ...draft, orgDailyCapUsd: e.target.value })}
              placeholder={t('limitOrgPlaceholder')}
              disabled={!canWrite}
              maxLength={12}
            />
          </Field>
        </div>
        <p className="text-caption text-fg-subtle">
          {t('limits', {
            turns: format.number(card.limits.userTurnsPerDay),
            tokens: format.number(card.limits.userTokensPerDay),
          })}{' '}
          {t('precedence')} {t('estimateNote')}
        </p>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy} loadingLabel={t('working')}>
              {t('limitsSave')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void saveLimits(undefined, true)}
            >
              {t('limitsDefaults')}
            </Button>
          </div>
        )}
      </form>

      <form
        onSubmit={(e) => void saveCap(e)}
        className="flex flex-col gap-3 border-t border-border pt-4"
        noValidate
        aria-labelledby="platform-cap-title"
      >
        <div>
          <p id="platform-cap-title" className="text-body font-medium text-fg">
            {t('capTitle')}
          </p>
          <p className="text-body-sm text-fg-muted">{t('capIntro')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label={t('capLabel')}
            description={t('capDefault', {
              value: usd(card.limits.defaults.platformDailyCapMicroUsd),
            })}
            {...(capBad ? { error: t('limitInvalid') } : {})}
          >
            <Input
              inputMode="decimal"
              value={capDraft}
              onChange={(e) => setCapDraft(e.target.value)}
              placeholder={String(microToUsd(card.limits.defaults.platformDailyCapMicroUsd))}
              disabled={!canWrite}
              maxLength={10}
            />
          </Field>
        </div>
        <p className="text-caption text-fg-subtle">
          {t('capEffective', { value: usd(card.limits.platformDailyCapMicroUsd) })} {t('capNote')}
        </p>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy} loadingLabel={t('working')}>
              {t('capSave')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void saveCap(undefined, true)}
            >
              {t('limitsDefaults')}
            </Button>
          </div>
        )}
      </form>

      <Dialog
        open={modal === 'key'}
        onOpenChange={(o) => {
          if (!o) closeModal();
        }}
        title={hasPanelKey ? t('dialog.replaceTitle') : t('dialog.setTitle')}
        description={t('dialog.description')}
        size="sm"
        labels={{ close: t('dialog.cancel') }}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={closeModal}>
              {t('dialog.cancel')}
            </Button>
            <Button
              type="submit"
              form="platform-key-form"
              loading={busy}
              loadingLabel={t('working')}
              disabled={!keyValid || !labelValid}
            >
              {t('dialog.submit')}
            </Button>
          </>
        }
      >
        <form
          id="platform-key-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void saveKey();
          }}
          className="flex flex-col gap-3"
          noValidate
        >
          <Field
            label={t('dialog.labelField')}
            description={t('dialog.labelHint')}
            {...(label !== '' && !labelValid ? { error: t('dialog.labelInvalid') } : {})}
          >
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('dialog.labelPlaceholder')}
              maxLength={60}
              autoComplete="off"
              autoFocus
            />
          </Field>
          <Field
            label={t('dialog.keyField')}
            description={t('dialog.keyHint')}
            {...(secret !== '' && !keyValid ? { error: t('dialog.keyInvalid') } : {})}
          >
            <Input
              type="password"
              name="platform-ai-api-key"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={400}
            />
          </Field>
          {error !== null && (
            <p role="alert" className="text-body-sm text-danger">
              {te(error)}
            </p>
          )}
        </form>
      </Dialog>

      <Dialog
        open={modal === 'label'}
        onOpenChange={(o) => {
          if (!o) closeModal();
        }}
        title={t('dialog.renameTitle')}
        description={t('dialog.renameDescription')}
        size="sm"
        labels={{ close: t('dialog.cancel') }}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={closeModal}>
              {t('dialog.cancel')}
            </Button>
            <Button
              type="submit"
              form="platform-label-form"
              loading={busy}
              loadingLabel={t('working')}
              disabled={!labelValid}
            >
              {t('dialog.renameSubmit')}
            </Button>
          </>
        }
      >
        <form
          id="platform-label-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void saveLabel();
          }}
          className="flex flex-col gap-3"
          noValidate
        >
          <Field
            label={t('dialog.labelField')}
            description={t('dialog.labelHint')}
            {...(label !== '' && !labelValid ? { error: t('dialog.labelInvalid') } : {})}
          >
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
              autoComplete="off"
              autoFocus
            />
          </Field>
          {error !== null && (
            <p role="alert" className="text-body-sm text-danger">
              {te(error)}
            </p>
          )}
        </form>
      </Dialog>

      <AlertDialog
        open={modal === 'remove'}
        onOpenChange={(o) => {
          if (!o) closeModal();
        }}
        title={t('removeDialog.title')}
        description={t('removeDialog.body')}
        impact={t('removeDialog.impact')}
        cancelLabel={t('dialog.cancel')}
        destructiveLabel={t('removeDialog.confirm')}
        tone="danger"
        confirmLoading={busy}
        confirmLoadingLabel={t('working')}
        onConfirm={() => void removeKey()}
      />
    </Card>
  );
}
