'use client';
// Kullanıcılar listesi (053-ekranlar/11 §3.4): arama (e-posta öneki, kimlik), durum/rol/doğrulama
// süzgeci, imleçle sayfalama. Yalnız kimlik, e-posta, durum ve sayaç gösterilir; içerik yoktur.
// Arama metni URL'ye yazılmaz (POST gövdesi). Okuma da passkey ile yeniden doğrulama (step-up) ister.
import type {
  AdminUserListItemDtoValue,
  AdminUserListResponseValue,
} from '@eda/contracts/api/admin-users';
import { PLATFORM_ROLES, VERIFICATION_STATUSES } from '@eda/contracts/enums';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
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
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useStepUp } from '../../components/step-up.tsx';
import { adminFetch } from '../../lib/admin-api.ts';
import {
  accountTone,
  EMPTY_FILTERS,
  isQueryTooShort,
  searchBody,
  type UserFilters,
  verificationTone,
} from './users-model.ts';

type State = 'loading' | 'ready' | 'error';

export function UsersView() {
  const t = useTranslations('users');
  const format = useFormatter();
  const stepUp = useStepUp();
  const runStepUp = stepUp.run;
  const [draft, setDraft] = useState<UserFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<UserFilters>(EMPTY_FILTERS);
  const [items, setItems] = useState<AdminUserListItemDtoValue[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<State>('loading');
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (filters: UserFilters, cursor?: string) => {
      const mine = ++seq.current;
      if (cursor === undefined) setState('loading');
      else setMore(true);
      try {
        const r = await runStepUp(() =>
          adminFetch<AdminUserListResponseValue>('/users/search', {
            method: 'POST',
            body: searchBody(filters, cursor),
          }),
        );
        if (mine !== seq.current) return;
        setItems((cur) => (cursor ? [...cur, ...r.items] : r.items));
        setNext(r.nextCursor);
        setState('ready');
      } catch {
        if (mine === seq.current) setState('error');
      } finally {
        if (mine === seq.current) setMore(false);
      }
    },
    [runStepUp],
  );
  useEffect(() => {
    void load(applied);
  }, [load, applied]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (isQueryTooShort(draft.query)) return;
    setApplied(draft);
  }

  const when = (iso: string | null) =>
    iso === null
      ? t('never')
      : format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' });
  const whenTime = (iso: string | null) =>
    iso === null
      ? t('never')
      : format.dateTime(new Date(iso), {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });

  return (
    <PageContainer width="content">
      <PageHeader title={t('title')} description={t('intro')} />
      <form
        onSubmit={submit}
        aria-label={t('filters')}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
      >
        <Field
          label={t('search')}
          description={t('searchHint')}
          error={isQueryTooShort(draft.query) ? t('searchShort') : undefined}
        >
          <Input
            type="search"
            value={draft.query}
            maxLength={254}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setDraft({ ...draft, query: e.target.value })}
          />
        </Field>
        <Field label={t('filter.account')}>
          <Select
            value={draft.accountStatus}
            onChange={(e) =>
              setDraft({ ...draft, accountStatus: e.target.value as UserFilters['accountStatus'] })
            }
            options={[
              { value: '', label: t('filter.all') },
              { value: 'active', label: t('account.active') },
              { value: 'suspended', label: t('account.suspended') },
            ]}
          />
        </Field>
        <Field label={t('filter.role')}>
          <Select
            value={draft.platformRole}
            onChange={(e) =>
              setDraft({ ...draft, platformRole: e.target.value as UserFilters['platformRole'] })
            }
            options={[
              { value: '', label: t('filter.all') },
              ...PLATFORM_ROLES.map((r) => ({ value: r, label: t(`role.${r}`) })),
            ]}
          />
        </Field>
        <Field label={t('filter.verification')}>
          <Select
            value={draft.verificationStatus}
            onChange={(e) =>
              setDraft({
                ...draft,
                verificationStatus: e.target.value as UserFilters['verificationStatus'],
              })
            }
            options={[
              { value: '', label: t('filter.all') },
              ...VERIFICATION_STATUSES.map((s) => ({ value: s, label: t(`verification.${s}`) })),
            ]}
          />
        </Field>
        <Button type="submit" disabled={isQueryTooShort(draft.query)}>
          {t('apply')}
        </Button>
      </form>

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
          title={t('error')}
          onRetry={() => void load(applied)}
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
        <EmptyState icon="nav.account" title={t('empty')} description={t('emptyBody')} />
      )}
      {state === 'ready' && items.length > 0 && (
        <Table caption={t('table.caption')}>
          <thead>
            <tr>
              <Th>{t('table.shortId')}</Th>
              <Th>{t('table.email')}</Th>
              <Th>{t('table.created')}</Th>
              <Th>{t('table.verification')}</Th>
              <Th className="text-right">{t('table.orgs')}</Th>
              <Th>{t('table.lastLogin')}</Th>
              <Th>{t('table.status')}</Th>
              <Th>
                <span className="sr-only">{t('table.actions')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <Tr key={u.userId}>
                <Td className="font-mono text-caption text-fg-muted">{u.shortId}</Td>
                <Td className="max-w-64 truncate">
                  <span title={u.userEmail}>{u.userEmail}</span>
                  {u.platformRole !== 'user' && (
                    <Badge tone="info" className="ml-2">
                      {t('staff')}
                    </Badge>
                  )}
                </Td>
                <Td className="whitespace-nowrap tabular-nums">{when(u.createdAt)}</Td>
                <Td>
                  <div className="flex flex-col items-start gap-0.5">
                    <Badge tone={verificationTone(u.verificationStatus)}>
                      {t(`verification.${u.verificationStatus}`)}
                    </Badge>
                    <span className="text-caption text-fg-subtle">
                      {u.emailVerified ? t('emailVerified') : t('emailUnverified')}
                    </span>
                  </div>
                </Td>
                <Td className="text-right tabular-nums">{u.orgCount}</Td>
                <Td className="whitespace-nowrap tabular-nums">{whenTime(u.lastLoginAt)}</Td>
                <Td>
                  <Badge tone={accountTone(u.accountStatus)}>
                    {t(`account.${u.accountStatus}`)}
                  </Badge>
                </Td>
                <Td className="text-right">
                  <Link
                    href={`/kullanicilar/${u.userId}`}
                    aria-label={t('table.detailFor', { id: u.shortId })}
                    className="rounded-sm text-body-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:focus-ring"
                  >
                    {t('table.detail')}
                  </Link>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {state === 'ready' && next && (
        <div>
          <Button
            variant="outline"
            loading={more}
            loadingLabel={t('loading')}
            onClick={() => void load(applied, next)}
          >
            {t('more')}
          </Button>
        </div>
      )}
      {stepUp.dialog}
    </PageContainer>
  );
}
