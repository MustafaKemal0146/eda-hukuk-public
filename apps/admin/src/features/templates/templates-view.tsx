'use client';
// Şablonlar: e-posta ve belge şablonlarının salt okur envanteri. Şablonlar kodda sürümlenir; düzenleme
// yoktur. Önizleme yalnız sentetik örnek verilerle üretilen DÜZ METİNDİR (ham HTML çizilmez).
import type {
  AdminTemplateItemDtoValue,
  AdminTemplateListResponseValue,
  AdminTemplatePreviewDtoValue,
} from '@eda/contracts/api/admin-templates';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageContainer,
  PageHeader,
  Skeleton,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
} from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '../../lib/admin-api.ts';

type Tab = 'email' | 'document';
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: AdminTemplateListResponseValue }
  | { kind: 'error' };

export function TemplatesView() {
  const t = useTranslations('templates');
  const format = useFormatter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('email');
  const [preview, setPreview] = useState<AdminTemplatePreviewDtoValue | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({
        kind: 'ready',
        data: await adminFetch<AdminTemplateListResponseValue>('/templates'),
      });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function openPreview(key: string) {
    setBusyKey(key);
    setPreview(null);
    setPreviewFailed(false);
    try {
      setPreview(
        await adminFetch<AdminTemplatePreviewDtoValue>(
          `/templates/email/${encodeURIComponent(key)}/preview`,
        ),
      );
    } catch {
      setPreviewFailed(true);
    } finally {
      setBusyKey(null);
      setPreviewOpen(true);
    }
  }

  const when = (v: string | null): string => {
    if (v === null) return '—';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
    return format.dateTime(date, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  if (state.kind === 'error') {
    return (
      <PageContainer width="content">
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
      <PageContainer width="content">
        <PageHeader title={t('title')} />
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PageContainer>
    );
  }

  const items = state.data.items.filter((i) => i.type === tab);
  const varLabel = (v: AdminTemplateItemDtoValue['variables'][number]) =>
    v.sealed
      ? `${v.name} (${t('sealed')})`
      : v.type === 'enum'
        ? `${v.name} (${v.options.join(' | ')})`
        : `${v.name} (${t(`varType.${v.type}`)})`;

  return (
    <PageContainer width="content">
      <PageHeader title={t('title')} description={t('intro')} />
      <Tabs
        value={tab}
        onValueChange={setTab}
        label={t('tabs')}
        items={[
          {
            value: 'email',
            label: t('tab.email'),
            count: state.data.items.filter((i) => i.type === 'email').length,
          },
          {
            value: 'document',
            label: t('tab.document'),
            count: state.data.items.filter((i) => i.type === 'document').length,
          },
        ]}
      />
      {tab === 'document' && <p className="text-body-sm text-fg-muted">{t('documentHidden')}</p>}
      {items.length === 0 ? (
        <EmptyState
          icon="nav.documents"
          title={t(tab === 'email' ? 'emptyEmail' : 'emptyDocument')}
        />
      ) : (
        <Table caption={t(`caption.${tab}`)}>
          <thead>
            <tr>
              <Th>{t('col.name')}</Th>
              <Th>{t('col.kind')}</Th>
              <Th>{tab === 'email' ? t('col.group') : t('col.caseType')}</Th>
              <Th>{t('col.version')}</Th>
              <Th>{t('col.changed')}</Th>
              {tab === 'email' && <Th>{t('col.variables')}</Th>}
              <Th>{t('col.status')}</Th>
              {tab === 'email' && <Th>{t('col.actions')}</Th>}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <Tr key={i.key}>
                <Td className="font-mono text-caption">
                  {tab === 'email' ? i.key : i.key.slice(0, 8)}
                </Td>
                <Td>
                  {tab === 'document' && i.kind
                    ? t(`docKind.${i.kind as 'petition' | 'notice' | 'memo' | 'free'}`)
                    : i.kind || '—'}
                </Td>
                <Td>
                  {tab === 'email' && i.group
                    ? t(`class.${i.group as 'security' | 'action' | 'service' | 'deadline'}`)
                    : (i.group ?? '—')}
                </Td>
                <Td className="tabular-nums">{i.version || '—'}</Td>
                <Td className="tabular-nums">{when(i.lastChanged)}</Td>
                {tab === 'email' && (
                  <Td>
                    {i.variables.length === 0 ? (
                      <span className="text-fg-subtle">{t('noVariables')}</span>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {i.variables.map((v) => (
                          <li key={v.name} className="font-mono text-caption">
                            {varLabel(v)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>
                )}
                <Td>
                  {tab === 'email' ? (
                    <Badge tone={i.implemented ? 'success' : 'neutral'}>
                      {i.implemented ? t('implemented') : t('planned')}
                    </Badge>
                  ) : (
                    <Badge tone={i.active ? 'success' : 'neutral'}>
                      {i.active ? t('active') : t('inactive')}
                    </Badge>
                  )}
                </Td>
                {tab === 'email' && (
                  <Td>
                    {i.previewable && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busyKey === i.key}
                        loadingLabel={t('loading')}
                        onClick={() => void openPreview(i.key)}
                      >
                        {t('preview')}
                      </Button>
                    )}
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        size="lg"
        title={t('previewTitle')}
        description={t('previewNote')}
        labels={{ close: t('close') }}
      >
        {previewFailed || preview === null ? (
          <p role="alert" className="text-body-sm text-danger">
            {t('previewError')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-caption text-fg-subtle">
              {preview.key} · {t('previewVersion', { version: preview.version })}
            </p>
            <div>
              <p className="text-caption text-fg-subtle">{t('previewSubject')}</p>
              <p className="text-body text-fg">{preview.subject}</p>
            </div>
            <div>
              <p className="text-caption text-fg-subtle">{t('previewBody')}</p>
              <pre className="max-h-96 overflow-auto rounded-md border border-border bg-surface-sunken p-3 font-mono text-caption whitespace-pre-wrap text-fg">
                {preview.text}
              </pre>
            </div>
          </div>
        )}
      </Dialog>
    </PageContainer>
  );
}
