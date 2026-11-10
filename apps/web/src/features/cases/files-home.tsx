'use client';
// Dosyalar (053-06): dava klasörleri listesi (arama, durum süzgeci, imleçli yükleme) ve yeni klasör.
// Evrak yükleme hattı (tarama, şifreli saklama) sonraki dilimdedir; ekranda vaat edilmez.
import type { CaseDtoValue } from '@eda/contracts/api/cases';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '@eda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authRedirectFor, documentsApi } from '../studio/documents-api.ts';
import { NewCaseDialog } from './new-case-dialog.tsx';

type Load = 'loading' | 'ready' | 'error';
const STATUSES = ['', 'active', 'on_hold', 'closed', 'archived'] as const;

export function FilesHome() {
  const t = useTranslations('files');
  const format = useFormatter();
  const router = useRouter();
  const [items, setItems] = useState<CaseDtoValue[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<Load>('loading');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('');
  const [creating, setCreating] = useState(false);
  const seq = useRef(0);

  const onAuth = useCallback(
    (err: unknown): boolean => {
      const to = authRedirectFor(err, '/dosyalar');
      if (to) router.replace(to);
      return to !== null;
    },
    [router],
  );

  const load = useCallback(
    async (cursor?: string) => {
      const mine = ++seq.current;
      if (!cursor) setState('loading');
      try {
        const r = await documentsApi.cases.list({
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(status ? { status } : {}),
          ...(cursor ? { cursor } : {}),
        });
        if (mine !== seq.current) return;
        setItems((cur) => (cursor ? [...cur, ...r.items] : r.items));
        setNext(r.nextCursor);
        setState('ready');
      } catch (err) {
        if (mine !== seq.current || onAuth(err)) return;
        setState('error');
      }
    },
    [q, status, onAuth],
  );

  useEffect(() => {
    const h = setTimeout(() => void load(), 250);
    return () => clearTimeout(h);
  }, [load]);

  const filtered = q.trim() !== '' || status !== '';

  return (
    <PageContainer width="content">
      <PageHeader
        title={t('title')}
        description={t('intro')}
        actions={
          <Button leadingIcon="action.add" onClick={() => setCreating(true)}>
            {t('newCase')}
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <Input
            type="search"
            aria-label={t('search')}
            placeholder={t('searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          aria-label={t('statusFilter')}
          className="w-48"
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
          options={STATUSES.map((s) => ({
            value: s,
            label: t(s === '' ? 'statusAll' : `status.${s}`),
          }))}
        />
      </div>

      {state === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {state === 'error' && (
        <ErrorState
          title={t('loadError')}
          onRetry={() => void load()}
          labels={{
            retry: t('retry'),
            retrying: t('loading'),
            supportCode: '',
            copy: '',
            copied: '',
          }}
        />
      )}
      {state === 'ready' && items.length === 0 && (
        <EmptyState
          icon="nav.files"
          title={filtered ? t('noMatchTitle') : t('casesEmptyTitle')}
          description={filtered ? t('noMatchBody') : t('casesEmptyBody')}
          actions={
            filtered ? undefined : (
              <Button variant="outline" leadingIcon="action.add" onClick={() => setCreating(true)}>
                {t('newCase')}
              </Button>
            )
          }
        />
      )}
      {state === 'ready' && items.length > 0 && (
        <Table caption={t('casesTitle')}>
          <thead>
            <tr>
              <Th>{t('columns.name')}</Th>
              <Th>{t('columns.code')}</Th>
              <Th>{t('columns.docket')}</Th>
              <Th>{t('columns.status')}</Th>
              <Th>{t('columns.updated')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <span className="flex items-center gap-2">
                    {c.visibility === 'restricted' && (
                      <Icon icon="control.locked" size="sm" className="text-fg-subtle" />
                    )}
                    <Link
                      href={`/dosyalar/${c.id}`}
                      className="font-medium text-fg underline-offset-4 hover:underline focus-visible:focus-ring"
                    >
                      {c.title}
                    </Link>
                    {c.visibility === 'restricted' && (
                      <span className="sr-only">{t('visibilityRestrictedShort')}</span>
                    )}
                  </span>
                </Td>
                <Td className="text-fg-muted">{c.officeFileCode ?? '—'}</Td>
                <Td className="tabular-nums text-fg-muted">{c.esasNo ?? '—'}</Td>
                <Td>
                  <Badge tone={c.status === 'active' ? 'success' : 'neutral'}>
                    {t(`status.${c.status}`)}
                  </Badge>
                </Td>
                <Td className="tabular-nums text-fg-muted">
                  {format.dateTime(new Date(c.updatedAt), { dateStyle: 'medium' })}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {next && state === 'ready' && (
        <Button variant="outline" onClick={() => void load(next)}>
          {t('more')}
        </Button>
      )}

      <p className="flex items-center gap-2 text-caption text-fg-subtle">
        <Icon icon="status.secure" size="sm" />
        {t('uploadNote')}
      </p>

      <NewCaseDialog
        open={creating}
        onClose={() => setCreating(false)}
        onAuth={onAuth}
        onCreated={(c) => {
          setCreating(false);
          router.push(`/dosyalar/${c.id}`);
        }}
      />
    </PageContainer>
  );
}
