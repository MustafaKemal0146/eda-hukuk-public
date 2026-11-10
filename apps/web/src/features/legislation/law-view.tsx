'use client';
// Kanun sayfası (053-05 §4): başlık + künye satırı (yalnız dolu alanlar), köken ve erişim, resmî kaynak
// bağlantısı, "Madde numarasına git" ve "Bu kanunda ara". Canlı kökende madde dizini hazır değildir
// (`articleCount = 0`; P15 canlı yedek kuralı); dizin yerine not gösterilir.
import {
  type LawDtoValue,
  type LegislationSearchResultsDtoValue,
  lawTypeFromUrl,
} from '@eda/contracts/api';
import {
  Badge,
  Breadcrumb,
  Button,
  EmptyState,
  ErrorState,
  Input,
  NoticeBanner,
  PageContainer,
  SectionHeader,
  Skeleton,
} from '@eda/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react';
import {
  getLaw,
  researchErrorOf,
  type SourceErrorInfo,
  searchLegislation,
} from '../../lib/research-api.ts';
import { formatIsoDate, OfficialLink } from '../../lib/research-ui.tsx';
import { legislationErrorKey } from './errors.ts';
import { HitList } from './hit-list.tsx';
import { articleHref, articleUrlFromInput } from './omnibox.ts';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; law: LawDtoValue }
  | { kind: 'error'; info: SourceErrorInfo };

export function LawView({ lawNo }: { lawNo: string }) {
  const t = useTranslations('legislation');
  const router = useRouter();
  const params = useSearchParams();
  const type = lawTypeFromUrl(params.get('tur'));
  const ids = { goto: useId(), gotoErr: useId(), search: useId() };
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [gotoValue, setGotoValue] = useState('');
  const [gotoError, setGotoError] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<LegislationSearchResultsDtoValue | null>(null);
  const [searchError, setSearchError] = useState<SourceErrorInfo | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', law: await getLaw(lawNo, type) });
    } catch (err) {
      setState({ kind: 'error', info: researchErrorOf(err) });
    }
  }, [lawNo, type]);

  useEffect(() => {
    void load();
  }, [load]);

  const stateLabels = {
    retry: t('states.retry'),
    retrying: t('states.retrying'),
    supportCode: t('states.supportCode'),
    copy: t('states.copy'),
    copied: t('states.copied'),
  };

  if (state.kind === 'loading') {
    return (
      <PageContainer width="doc">
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      </PageContainer>
    );
  }
  if (state.kind === 'error') {
    const key = legislationErrorKey(state.info);
    return (
      <PageContainer width="doc">
        {key === 'notFound' ? (
          <EmptyState
            icon="nav.legislation"
            title={t('law.notFoundTitle')}
            description={t('law.notFoundBody')}
            actions={<Button render={<Link href="/mevzuat" />}>{t('title')}</Button>}
          />
        ) : (
          <ErrorState
            title={t('law.loadError')}
            message={t(`errors.${key}`, { sec: state.info.retryAfterSec ?? 30 })}
            {...(state.info.requestId ? { requestId: state.info.requestId } : {})}
            onRetry={() => void load()}
            labels={stateLabels}
          />
        )}
      </PageContainer>
    );
  }

  const law = state.law;
  const retrieved = formatIsoDate(law.retrievedAt);
  const lawType = law.lawType;

  function onGoto(e: FormEvent) {
    e.preventDefault();
    const url = articleUrlFromInput(gotoValue);
    if (url === null) {
      setGotoError(true);
      return;
    }
    setGotoError(false);
    router.push(articleHref(law.lawNo, url, lawType));
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    const text = query.trim();
    if (text.length < 2 || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      setHits(
        await searchLegislation({
          query: text,
          lawNo: law.lawNo,
          lawType: null,
          includeRepealed: false,
        }),
      );
    } catch (err) {
      setHits(null);
      setSearchError(researchErrorOf(err));
    } finally {
      setSearching(false);
    }
  }

  const searchErrKey = searchError ? legislationErrorKey(searchError) : null;

  return (
    <PageContainer width="doc">
      <Breadcrumb
        label={t('law.breadcrumb')}
        items={[{ label: t('title'), render: <Link href="/mevzuat" /> }, { label: law.title }]}
      />
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
          <Badge tone="primary">{t('live')}</Badge>
          {law.status === 'repealed' && <Badge tone="warning">{t('article.repealed')}</Badge>}
          {retrieved && <span>{t('retrieved', { date: retrieved })}</span>}
        </div>
        <h1 className="font-display text-heading-lg text-fg">
          {law.title}
          {law.shortName && <span className="text-fg-muted"> ({law.shortName})</span>}
        </h1>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-body-sm">
          <div className="flex gap-2">
            <dt className="text-fg-muted">{t('law.lawNo')}</dt>
            <dd className="tabular-nums text-fg">{law.lawNo}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted">{t('law.type')}</dt>
            <dd className="text-fg">{t(`types.${law.lawType}`)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted">{t('law.lastAmended')}</dt>
            <dd className="text-fg">
              {formatIsoDate(law.lastAmendedDate) ?? t('law.lastAmendedMissing')}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <OfficialLink href={law.sourceUrl}>{t('sourceLink')}</OfficialLink>
          <Button
            size="sm"
            variant="outline"
            render={<Link href={articleHref(law.lawNo, '1', lawType)} />}
          >
            {t('law.firstArticle')}
          </Button>
        </div>
        {law.origin === 'live' && <NoticeBanner tone="info">{t('law.liveBand')}</NoticeBanner>}
      </header>

      <section aria-labelledby="madde-git" className="flex flex-col gap-2">
        <SectionHeader id="madde-git" title={t('law.gotoLabel')} />
        <form onSubmit={onGoto} className="flex flex-wrap items-start gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.goto} className="sr-only">
              {t('law.gotoLabel')}
            </label>
            <Input
              id={ids.goto}
              value={gotoValue}
              maxLength={20}
              placeholder={t('law.gotoPlaceholder')}
              aria-invalid={gotoError || undefined}
              aria-describedby={gotoError ? ids.gotoErr : undefined}
              onChange={(e) => setGotoValue(e.target.value)}
            />
            {gotoError && (
              <p id={ids.gotoErr} className="text-caption text-danger">
                {t('law.gotoInvalid')}
              </p>
            )}
          </div>
          <Button type="submit" variant="outline">
            {t('law.goto')}
          </Button>
        </form>
      </section>

      <section aria-labelledby="kanunda-ara" className="flex flex-col gap-3">
        <SectionHeader id="kanunda-ara" title={t('law.searchInLaw')} />
        <search>
          <form onSubmit={onSearch} className="flex flex-wrap gap-2">
            <label htmlFor={ids.search} className="sr-only">
              {t('law.searchInLaw')}
            </label>
            <Input
              id={ids.search}
              type="search"
              value={query}
              maxLength={500}
              placeholder={t('law.searchInLawPlaceholder')}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-64 flex-1"
            />
            <Button
              type="submit"
              disabled={query.trim().length < 2}
              loading={searching}
              loadingLabel={t('searching')}
            >
              {t('search')}
            </Button>
          </form>
        </search>
        {searchErrKey && (
          <NoticeBanner tone="danger" role="alert">
            {t(`errors.${searchErrKey === 'notFound' ? 'generic' : searchErrKey}`, {
              sec: searchError?.retryAfterSec ?? 30,
            })}
          </NoticeBanner>
        )}
        {hits && hits.items.length > 0 && <HitList items={hits.items} />}
        {hits?.empty && <NoticeBanner tone="neutral">{t('hits.empty')}</NoticeBanner>}
        <p className="text-caption text-fg-subtle">{t('law.indexNote')}</p>
      </section>

      <p className="text-caption text-fg-subtle">{t('disclaimer')}</p>
    </PageContainer>
  );
}
