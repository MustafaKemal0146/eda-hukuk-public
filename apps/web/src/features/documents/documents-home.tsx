'use client';
import type { DocumentListDtoValue } from '@eda/contracts/api/documents';
// Belgeler listesi (053-03 §2): gerçek belgeler, "Boş belge" ile yeni belge. Şablonla başlama ve
// sohbetle dilekçe hattı P18'dedir. Oturum yoksa `/giris`, MFA gerekiyorsa kurulum ekranına yönlenir.
import {
  AlertDialog,
  Button,
  DocStatusBadge,
  EmptyState,
  ErrorState,
  PageContainer,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '@eda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, authRedirectFor, documentsApi } from '../studio/documents-api.ts';

const DATE = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Istanbul',
});

type Load =
  | { state: 'loading' }
  | { state: 'ready'; items: DocumentListDtoValue[]; nextCursor: string | null }
  | { state: 'locked' }
  | { state: 'error' };

export function DocumentsHome() {
  const t = useTranslations('documents');
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [mfa, setMfa] = useState(false);
  const [toDelete, setToDelete] = useState<DocumentListDtoValue | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<'error' | 'forbidden' | null>(null);

  const fetchList = useCallback(async () => {
    setLoad({ state: 'loading' });
    try {
      const r = await documentsApi.documents.list({ limit: 50 });
      setLoad({ state: 'ready', items: r.items, nextCursor: r.nextCursor });
    } catch (err) {
      const to = authRedirectFor(err, '/belgeler');
      if (to) {
        router.replace(to);
        return;
      }
      if (err instanceof ApiClientError && err.status === 403) setLoad({ state: 'locked' });
      else setLoad({ state: 'error' });
    }
  }, [router]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await documentsApi.documents.remove(toDelete.id);
      setLoad((cur) =>
        cur.state === 'ready'
          ? { ...cur, items: cur.items.filter((d) => d.id !== toDelete.id) }
          : cur,
      );
      setToDelete(null);
    } catch (err) {
      const to = authRedirectFor(err, '/belgeler');
      if (to) router.replace(to);
      else
        setDeleteError(err instanceof ApiClientError && err.status === 403 ? 'forbidden' : 'error');
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function create() {
    setCreating(true);
    setCreateError(false);
    setMfa(false);
    try {
      const doc = await documentsApi.documents.create({ kind: 'petition', title: t('untitled') });
      router.push(`/belgeler/${doc.id}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'AUTH_MFA_REQUIRED') setMfa(true);
      else {
        const to = authRedirectFor(err, '/belgeler');
        if (to) router.replace(to);
        else setCreateError(true);
      }
    } finally {
      setCreating(false);
    }
  }

  const statusLabels = {
    draft: t('status.draft'),
    review_pending: t('status.review_pending'),
    approved: t('status.approved'),
    exported: t('status.exported'),
    filed_declared: t('status.filed_declared'),
    archived: t('status.archived'),
  } as const;

  return (
    <PageContainer width="content">
      <PageHeader
        title={t('title')}
        description={t('intro')}
        actions={
          <Button
            leadingIcon="action.add"
            loading={creating}
            loadingLabel={t('creating')}
            onClick={() => void create()}
          >
            {t('blank')}
          </Button>
        }
      />
      {mfa && (
        <div role="alert" className="rounded-md border border-warning-border bg-warning-soft p-4">
          <p className="text-body font-medium text-warning-on-soft">{t('mfaTitle')}</p>
          <p className="mt-1 text-body-sm text-warning-on-soft">{t('mfaBody')}</p>
          <Button
            className="mt-3"
            size="sm"
            render={<Link href="/iki-adimli?mod=kurulum&sonraki=/belgeler" />}
          >
            {t('mfaAction')}
          </Button>
        </div>
      )}
      {deleteError && (
        <p role="alert" className="text-body-sm text-danger">
          {t(deleteError === 'forbidden' ? 'delete.forbidden' : 'delete.error')}
        </p>
      )}
      {createError && (
        <p role="alert" className="text-body-sm text-danger">
          {t('createError')}
        </p>
      )}
      {load.state === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {load.state === 'error' && (
        <ErrorState
          title={t('loadError')}
          onRetry={() => void fetchList()}
          labels={{
            retry: t('retry'),
            retrying: t('loading'),
            supportCode: '',
            copy: '',
            copied: '',
          }}
        />
      )}
      {load.state === 'locked' && (
        <EmptyState icon="nav.documents" title={t('lockedTitle')} description={t('lockedBody')} />
      )}
      {load.state === 'ready' && load.items.length === 0 && (
        <EmptyState icon="nav.documents" title={t('emptyTitle')} description={t('emptyBody')} />
      )}
      {load.state === 'ready' && load.items.length > 0 && (
        <Table caption={t('recentTitle')}>
          <thead>
            <tr>
              <Th>{t('columns.name')}</Th>
              <Th>{t('columns.type')}</Th>
              <Th>{t('columns.status')}</Th>
              <Th>{t('columns.updated')}</Th>
              <Th>
                <span className="sr-only">{t('columns.actions')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {load.items.map((d) => (
              <Tr key={d.id}>
                <Td>
                  <Link
                    href={`/belgeler/${d.id}`}
                    className="font-medium text-fg underline-offset-4 hover:underline focus-visible:focus-ring"
                  >
                    {d.title}
                  </Link>
                </Td>
                <Td>{t(`kinds.${d.kind}`)}</Td>
                <Td>
                  <DocStatusBadge status={d.status} labels={statusLabels} />
                </Td>
                <Td className="tabular-nums text-fg-muted">{DATE.format(new Date(d.updatedAt))}</Td>
                <Td className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${t('delete.action')}: ${d.title}`}
                    onClick={() => {
                      setDeleteError(null);
                      setToDelete(d);
                    }}
                  >
                    {t('delete.action')}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title={t('delete.title')}
        description={t('delete.description', { title: toDelete?.title ?? '' })}
        impact={t('delete.impact')}
        cancelLabel={t('delete.cancel')}
        destructiveLabel={t('delete.confirm')}
        confirmLoading={deleting}
        confirmLoadingLabel={t('delete.confirm')}
        onConfirm={() => void confirmDelete()}
      />
    </PageContainer>
  );
}
