'use client';
// Yapay zekâ ayarı ve istemler (053-ekranlar/11). Katalog ve istemler SALT OKURDUR; tek değişiklik model
// etkin/pasif anahtarıdır (step-up + onay iletişim kutusu). Veri sınıfı izinleri burada değiştirilemez.
// İstem metni düzenlenmez: istemler kodla sürümlenir; metin yalnız salt okur gösterilir.
import type {
  AdminAiCatalogResponseValue,
  AdminAiModelDtoValue,
  AdminAiPromptsResponseValue,
  AdminAiPromptTextResponseValue,
  AdminAiUsageResponseValue,
} from '@eda/contracts/api/admin-ai';
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  PageContainer,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useStepUp } from '../../components/step-up.tsx';
import { adminFetch } from '../../lib/admin-api.ts';
import { AiKeysSection } from './ai-keys-section.tsx';
import { errorTone, toggleBlock, usageOf } from './ai-model.ts';

type Loaded = {
  catalog: AdminAiCatalogResponseValue;
  usage: AdminAiUsageResponseValue;
  prompts: AdminAiPromptsResponseValue;
};
type State = { kind: 'loading' } | { kind: 'ready'; data: Loaded } | { kind: 'error' };

export function AiConfigView({ canWrite = true }: { canWrite?: boolean }) {
  const t = useTranslations('ai');
  const format = useFormatter();
  const stepUp = useStepUp();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [confirm, setConfirm] = useState<AdminAiModelDtoValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [promptText, setPromptText] = useState<AdminAiPromptTextResponseValue | null>(null);
  const [promptError, setPromptError] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [catalog, usage, prompts] = await Promise.all([
        adminFetch<AdminAiCatalogResponseValue>('/ai/catalog'),
        adminFetch<AdminAiUsageResponseValue>('/ai/usage'),
        adminFetch<AdminAiPromptsResponseValue>('/ai/prompts'),
      ]);
      setState({ kind: 'ready', data: { catalog, usage, prompts } });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function applyToggle(m: AdminAiModelDtoValue) {
    setBusy(true);
    setActionError(null);
    try {
      await stepUp.run(() =>
        adminFetch(`/ai/models/${m.id}/enabled`, { method: 'PUT', body: { enabled: !m.enabled } }),
      );
      setConfirm(null);
      await load();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setActionError(code === 'VALIDATION_CONFLICT' ? t('blocked.generic') : t('actionError'));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  async function showPrompt(key: string) {
    setPromptError(false);
    try {
      setPromptText(
        await adminFetch<AdminAiPromptTextResponseValue>(`/ai/prompts/${encodeURIComponent(key)}`),
      );
    } catch {
      setPromptError(true);
    }
  }

  if (state.kind === 'error') {
    return (
      <PageContainer>
        <ErrorState
          title={t('error')}
          onRetry={() => void load()}
          labels={{
            retry: t('retry'),
            retrying: t('loading'),
            supportCode: '',
            copy: '',
            copied: '',
          }}
        />
      </PageContainer>
    );
  }
  if (state.kind === 'loading') {
    return (
      <PageContainer>
        <PageHeader title={t('title')} />
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </PageContainer>
    );
  }

  const { catalog, usage, prompts } = state.data;
  const pct = (v: number) => format.number(v, { style: 'percent', maximumFractionDigits: 1 });
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <PageContainer>
      <PageHeader title={t('title')} description={t('intro')} />
      {actionError && (
        <p role="alert" className="text-body-sm text-danger">
          {actionError}
        </p>
      )}

      <section aria-labelledby="ai-saglik" className="flex flex-col gap-3">
        <h2 id="ai-saglik" className="text-title text-fg">
          {t('health.title')}
        </h2>
        <p className="text-body-sm text-fg-muted">
          {t('health.intro', { days: usage.windowDays })}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.providers.map((p) => (
            <Card key={p.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-body font-medium text-fg">{p.id}</p>
                <Badge tone={p.enabled ? 'success' : 'neutral'}>
                  {p.enabled ? t('state.enabled') : t('state.disabled')}
                </Badge>
              </div>
              <p className="text-body-sm text-fg-muted">
                {t('health.keySource')}:{' '}
                {p.secretConfigured === null
                  ? t('health.noKeyNeeded')
                  : p.secretConfigured
                    ? t('health.configured')
                    : t('health.missing')}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="ai-modeller" className="flex flex-col gap-3">
        <h2 id="ai-modeller" className="text-title text-fg">
          {t('models.title')}
        </h2>
        <p className="text-body-sm text-fg-muted">{t('models.intro')}</p>
        <Table caption={t('models.title')}>
          <thead>
            <tr>
              <Th>{t('models.alias')}</Th>
              <Th>{t('models.provider')}</Th>
              <Th>{t('models.label')}</Th>
              <Th>{t('models.capabilities')}</Th>
              <Th>{t('models.calls', { days: usage.windowDays })}</Th>
              <Th>{t('models.errorRate')}</Th>
              <Th>{t('models.state')}</Th>
              <Th>{t('models.action')}</Th>
            </tr>
          </thead>
          <tbody>
            {catalog.models.map((m) => {
              const u = usageOf(usage, m.alias, m.providerId);
              const block = toggleBlock(catalog, m);
              return (
                <Tr key={m.id}>
                  <Td className="font-medium">{m.alias}</Td>
                  <Td>{m.providerId}</Td>
                  <Td>{m.label}</Td>
                  <Td>
                    {[
                      m.capabilities.tools ? t('cap.tools') : null,
                      m.capabilities.strictTools ? t('cap.strictTools') : null,
                      `${t('cap.thinking')}: ${t(`thinking.${m.thinking}`)}`,
                    ]
                      .filter((x) => x !== null)
                      .join(' · ')}
                  </Td>
                  <Td className="tabular-nums">{format.number(u?.calls ?? 0)}</Td>
                  <Td>
                    {u === undefined || u.calls === 0 ? (
                      '—'
                    ) : (
                      <Badge tone={errorTone(u.calls, u.errorRate)}>{pct(u.errorRate)}</Badge>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={m.enabled ? 'success' : 'neutral'}>
                      {m.enabled ? t('state.enabled') : t('state.disabled')}
                    </Badge>
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || block !== null}
                      onClick={() => {
                        setActionError(null);
                        setConfirm(m);
                      }}
                    >
                      {m.enabled ? t('models.disable') : t('models.enable')}
                    </Button>
                    {block !== null && (
                      <p className="mt-1 text-caption text-fg-subtle">{t(`blocked.${block}`)}</p>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        {catalog.notInDb.models.length > 0 && (
          <p className="text-body-sm text-fg-muted">
            {t('models.notInDb', {
              list: catalog.notInDb.models.map((m) => `${m.alias} (${m.providerId})`).join(', '),
            })}
          </p>
        )}
      </section>

      <section aria-labelledby="ai-saglayici" className="flex flex-col gap-3">
        <h2 id="ai-saglayici" className="text-title text-fg">
          {t('providers.title')}
        </h2>
        <p className="text-body-sm text-fg-muted">{t('providers.intro')}</p>
        <Table caption={t('providers.title')}>
          <thead>
            <tr>
              <Th>{t('providers.id')}</Th>
              <Th>{t('providers.region')}</Th>
              <Th>{t('providers.classes')}</Th>
              <Th>{t('providers.terms')}</Th>
              <Th>{t('models.state')}</Th>
            </tr>
          </thead>
          <tbody>
            {catalog.providers.map((p) => (
              <Tr key={p.id}>
                <Td className="font-medium">{p.id}</Td>
                <Td>{p.region}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {p.allowedDataClasses.map((c) => (
                      <Badge key={c} tone={c === 'public' ? 'neutral' : 'info'}>
                        {t(`class.${c}`)}
                      </Badge>
                    ))}
                  </span>
                </Td>
                <Td>
                  {[
                    p.trainingUse ? t('providers.training') : t('providers.noTraining'),
                    p.humanReview ? t('providers.review') : t('providers.noReview'),
                    p.retentionDays === null
                      ? null
                      : t('providers.retention', { days: p.retentionDays }),
                  ]
                    .filter((x) => x !== null)
                    .join(' · ')}
                </Td>
                <Td>
                  <Badge tone={p.enabled ? 'success' : 'neutral'}>
                    {p.enabled ? t('state.enabled') : t('state.disabled')}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <p className="text-body-sm text-fg-muted">{t('providers.readOnly')}</p>
      </section>

      <section aria-labelledby="ai-istemler" className="flex flex-col gap-3">
        <h2 id="ai-istemler" className="text-title text-fg">
          {t('prompts.title')}
        </h2>
        <p className="text-body-sm text-fg-muted">{t('prompts.intro')}</p>
        <Table caption={t('prompts.title')}>
          <thead>
            <tr>
              <Th>{t('prompts.key')}</Th>
              <Th>{t('prompts.version')}</Th>
              <Th>{t('prompts.chars')}</Th>
              <Th>{t('prompts.hash')}</Th>
              <Th>{t('models.action')}</Th>
            </tr>
          </thead>
          <tbody>
            {prompts.items.map((p) => (
              <Tr key={p.key}>
                <Td className="font-medium">{p.key}</Td>
                <Td className="tabular-nums">{p.version}</Td>
                <Td className="tabular-nums">{format.number(p.chars)}</Td>
                <Td className="font-mono text-caption">{p.sha256.slice(0, 16)}</Td>
                <Td>
                  <Button size="sm" variant="outline" onClick={() => void showPrompt(p.key)}>
                    {t('prompts.view')}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {promptError && (
          <p role="alert" className="text-body-sm text-danger">
            {t('prompts.error')}
          </p>
        )}
      </section>

      <AiKeysSection canWrite={canWrite} />

      {catalog.models.some((m) => m.evalGatePassedAt !== null) && (
        <p className="text-caption text-fg-subtle">
          {t('models.evalNote', {
            date: when(
              catalog.models
                .map((m) => m.evalGatePassedAt)
                .filter((x): x is string => x !== null)
                .sort()
                .at(-1) ?? new Date().toISOString(),
            ),
          })}
        </p>
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={confirm?.enabled ? t('confirm.disableTitle') : t('confirm.enableTitle')}
        description={
          confirm
            ? t(confirm.enabled ? 'confirm.disableBody' : 'confirm.enableBody', {
                alias: confirm.alias,
                provider: confirm.providerId,
              })
            : undefined
        }
        impact={t('confirm.impact')}
        cancelLabel={t('cancel')}
        destructiveLabel={confirm?.enabled ? t('models.disable') : t('models.enable')}
        tone={confirm?.enabled ? 'danger' : 'primary'}
        confirmLoading={busy}
        confirmLoadingLabel={t('working')}
        onConfirm={() => confirm && void applyToggle(confirm)}
      />
      <Dialog
        open={promptText !== null}
        onOpenChange={(o) => {
          if (!o) setPromptText(null);
        }}
        title={promptText ? `${promptText.key} · v${promptText.version}` : ''}
        description={t('prompts.readOnlyNote')}
        labels={{ close: t('close') }}
      >
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-surface-sunken p-3 text-body-sm text-fg">
          {promptText?.text}
        </pre>
      </Dialog>
      {stepUp.dialog}
    </PageContainer>
  );
}
