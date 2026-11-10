'use client';
// Dava klasörü sayfası: künye (başlık, büro kodu, esas no, durum, görünürlük, açılış), düzenleme ve
// bağlantılı alanlar. Evrak yükleme hattı sonraki dilimdedir; burada açıkça belirtilir.
import type { CaseDtoValue } from '@eda/contracts/api/cases';
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  Field,
  Icon,
  Input,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
} from '@eda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, authRedirectFor, documentsApi } from '../studio/documents-api.ts';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; c: CaseDtoValue }
  | { kind: 'missing' }
  | { kind: 'error' };

export function CasePage({ caseId }: { caseId: string }) {
  const t = useTranslations('files');
  const format = useFormatter();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', code: '', esas: '', status: 'active' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', c: await documentsApi.cases.get(caseId) });
    } catch (err) {
      const to = authRedirectFor(err, `/dosyalar/${caseId}`);
      if (to) {
        router.replace(to);
        return;
      }
      setState(
        err instanceof ApiClientError && (err.status === 404 || err.code === 'CASE_NOT_FOUND')
          ? { kind: 'missing' }
          : { kind: 'error' },
      );
    }
  }, [caseId, router]);
  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <PageContainer width="content">
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      </PageContainer>
    );
  }
  if (state.kind === 'missing' || state.kind === 'error') {
    return (
      <PageContainer width="content">
        <ErrorState
          title={state.kind === 'missing' ? t('caseMissing') : t('loadError')}
          {...(state.kind === 'error' ? { onRetry: () => void load() } : {})}
          labels={{
            retry: t('retry'),
            retrying: t('loading'),
            supportCode: '',
            copy: '',
            copied: '',
          }}
        />
        <Link
          href="/dosyalar"
          className="text-body-sm text-primary underline-offset-4 hover:underline"
        >
          {t('back')}
        </Link>
      </PageContainer>
    );
  }

  const c = state.c;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const updated = await documentsApi.cases.patch(c.id, {
        title: form.title.trim(),
        officeFileCode: form.code.trim() === '' ? null : form.code.trim(),
        esasNo: form.esas.trim() === '' ? null : form.esas.trim(),
        status: form.status as 'active' | 'on_hold',
      });
      setState({ kind: 'ready', c: updated });
      setEditing(false);
    } catch {
      setError(t('newCaseForm.errors.save'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContainer width="content">
      <Link
        href="/dosyalar"
        className="text-body-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
      >
        {t('back')}
      </Link>
      <PageHeader
        title={c.title}
        description={c.esasNo ? t('esasLine', { esas: c.esasNo }) : t('noEsas')}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              setForm({
                title: c.title,
                code: c.officeFileCode ?? '',
                esas: c.esasNo ?? '',
                status: c.status === 'on_hold' ? 'on_hold' : 'active',
              });
              setError(null);
              setEditing(true);
            }}
          >
            {t('edit')}
          </Button>
        }
      />
      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            [
              'status',
              <Badge key="s" tone={c.status === 'active' ? 'success' : 'neutral'}>
                {t(`status.${c.status}`)}
              </Badge>,
            ],
            ['code', <span key="c">{c.officeFileCode ?? '—'}</span>],
            [
              'visibility',
              <span key="v" className="flex items-center gap-1.5">
                {c.visibility === 'restricted' && <Icon icon="control.locked" size="sm" />}
                {c.visibility === 'restricted'
                  ? t('newCaseForm.visibilityRestricted')
                  : t('newCaseForm.visibilityOrg')}
              </span>,
            ],
            [
              'opened',
              <span key="o" className="tabular-nums">
                {c.openedDate
                  ? format.dateTime(new Date(`${c.openedDate}T00:00:00`), { dateStyle: 'medium' })
                  : '—'}
              </span>,
            ],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1">
            <p className="text-caption text-fg-subtle">{t(`facts.${k}`)}</p>
            <div className="text-body-sm text-fg">{v}</div>
          </div>
        ))}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-2 p-5">
          <h2 className="text-title text-fg">{t('evidenceTitle')}</h2>
          <p className="text-body-sm text-fg-muted">{t('evidenceSoon')}</p>
        </Card>
        <Card className="flex flex-col gap-2 p-5">
          <h2 className="text-title text-fg">{t('linksTitle')}</h2>
          <Link
            href="/takvim"
            className="text-body-sm text-primary underline-offset-4 hover:underline"
          >
            {t('linkCalendar')}
          </Link>
          <Link
            href="/belgeler"
            className="text-body-sm text-primary underline-offset-4 hover:underline"
          >
            {t('linkDocuments')}
          </Link>
        </Card>
      </div>
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title={t('edit')}
        labels={{ close: t('newCaseForm.close') }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {t('newCaseForm.cancel')}
            </Button>
            <Button
              loading={busy}
              loadingLabel={t('newCaseForm.saving')}
              onClick={() => void save()}
            >
              {t('save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t('newCaseForm.name')} required>
            <Input
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('newCaseForm.code')}>
              <Input
                value={form.code}
                maxLength={40}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </Field>
            <Field label={t('newCaseForm.esas')}>
              <Input
                value={form.esas}
                maxLength={32}
                onChange={(e) => setForm({ ...form, esas: e.target.value })}
              />
            </Field>
          </div>
          <Field label={t('facts.status')}>
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              options={[
                { value: 'active', label: t('status.active') },
                { value: 'on_hold', label: t('status.on_hold') },
              ]}
            />
          </Field>
          {error && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </PageContainer>
  );
}
