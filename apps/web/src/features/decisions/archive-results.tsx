'use client';
// Sonuç sayfası (053-04 §4): yeniden arama formu, canlı arama bandı (otomatik ASLA; yerel korpus yokken
// birincil eylem), kaynak başı durum, sonuç listesi, sıralama (`siralama`, yeni kayıt üretmez)
// ve sayfalama (`sayfa`). Kapsam dışı ya da ulaşılamayan kaynak "sonuç yok" diye gösterilmez.
import { ARCHIVE_POOL_MAX, type SearchResultsDtoValue, type SearchSort } from '@eda/contracts/api';
import { scopeFromRequest } from '@eda/contracts/scope';
import { COURT_TYPES, type CourtType } from '@eda/contracts/tools';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  NoticeBanner,
  PageContainer,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  useAnnounce,
} from '@eda/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSearchPage,
  requestLiveSearch,
  researchErrorOf,
  type SourceErrorInfo,
} from '../../lib/research-api.ts';
import { formatIsoDate } from '../../lib/research-ui.tsx';
import { DecisionCard } from './decision-card.tsx';
import { liveBannerOf, liveErrorKey, sourceStatusKey } from './live-ui.ts';
import { cachedResults, forgetSearch, rememberResults } from './search-cache.ts';
import { SearchForm, useChamberLabel } from './search-form.tsx';
import {
  pageFromParams,
  SORT_PARAM,
  type SortParam,
  serpHref,
  sortFromParams,
  sortParamOf,
} from './url-state.ts';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; dto: SearchResultsDtoValue }
  | { kind: 'error'; info: SourceErrorInfo };

export function ArchiveResults({ searchId }: { searchId: string }) {
  const t = useTranslations('archive');
  const tScope = useTranslations('scope');
  const router = useRouter();
  const params = useSearchParams();
  const announce = useAnnounce();
  const chamberLabel = useChamberLabel();
  const page = pageFromParams(params);
  const sort = sortFromParams(params);
  const [state, setState] = useState<LoadState>(() => {
    const hit = cachedResults(searchId, page, sort);
    return hit ? { kind: 'ready', dto: hit } : { kind: 'loading' };
  });
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<SourceErrorInfo | null>(null);
  const [cooldown, setCooldown] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastPage = useRef<number | null>(null);

  const load = useCallback(async () => {
    const hit = cachedResults(searchId, page, sort);
    if (hit) {
      setState({ kind: 'ready', dto: hit });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const dto = await getSearchPage(searchId, { page, sort });
      rememberResults(dto);
      setState({ kind: 'ready', dto });
    } catch (err) {
      setState({ kind: 'error', info: researchErrorOf(err) });
    }
  }, [searchId, page, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  // Sayfa değişiminde odak sonuç başlığına, tek polite duyuru (053-04 §4.8); ilk yüklemede değil.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    const shown = state.dto.pagination.page;
    const previous = lastPage.current;
    lastPage.current = shown;
    if (previous === null || previous === shown) return;
    headingRef.current?.focus();
    announce(t('results.pageLoaded', { page: shown }));
  }, [state, announce, t]);

  const go = (nextPage: number, nextSort: SearchSort, replace = false) => {
    const href = serpHref(searchId, nextPage, nextSort);
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  };

  async function runLive(more: boolean) {
    if (state.kind !== 'ready') return;
    const before = state.dto.pagination.total;
    setLiveBusy(true);
    setLiveError(null);
    try {
      const dto = await requestLiveSearch(searchId, more);
      forgetSearch(searchId);
      rememberResults(dto);
      announce(t('live.done', { n: Math.max(0, dto.pagination.total - before) }));
      if (page === 1 && sort === 'relevance') setState({ kind: 'ready', dto });
      else go(1, sort);
    } catch (err) {
      const info = researchErrorOf(err);
      setLiveError(info);
      if (info.retryAfterSec !== null && liveErrorKey(info.code) !== 'unavailable') {
        setCooldown(true);
        setTimeout(() => setCooldown(false), info.retryAfterSec * 1000);
      }
      // Kaynak durumu sunucuda güncellendi; kart listesi bozulmadan yeniden okunur.
      forgetSearch(searchId);
      void load();
    } finally {
      setLiveBusy(false);
    }
  }

  const stateLabels = {
    retry: t('states.retry'),
    retrying: t('states.retrying'),
    supportCode: t('states.supportCode'),
    copy: t('states.copy'),
    copied: t('states.copied'),
  };

  if (state.kind === 'error') {
    const expired = state.info.code === 'VALIDATION_RESOURCE_NOT_FOUND';
    return (
      <PageContainer width="content">
        <PageHeader title={t('title')} />
        {expired ? (
          <EmptyState
            icon="nav.decisions"
            title={t('results.expiredTitle')}
            description={t('results.expiredBody')}
            actions={
              <Button render={<Link href="/karar-arsivi" />}>{t('results.newSearch')}</Button>
            }
          />
        ) : (
          <ErrorState
            title={t('results.loadError')}
            message={state.info.message ?? undefined}
            {...(state.info.requestId ? { requestId: state.info.requestId } : {})}
            onRetry={() => void load()}
            labels={stateLabels}
          />
        )}
      </PageContainer>
    );
  }

  if (state.kind === 'loading') {
    return (
      <PageContainer width="content">
        <PageHeader title={t('title')} />
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">{t('results.loading')}</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </PageContainer>
    );
  }

  const dto = state.dto;
  const banner = liveBannerOf(dto);
  const { pagination } = dto;
  const errKey = liveError ? liveErrorKey(liveError.code) : null;
  const sec = liveError?.retryAfterSec ?? 30;
  const scopeIds =
    dto.filters.courtTypes === null
      ? null
      : scopeFromRequest({
          sources: [],
          courtTypes: dto.filters.courtTypes.filter((c): c is CourtType =>
            (COURT_TYPES as readonly string[]).includes(c),
          ),
        });
  const scopeText =
    scopeIds === null || scopeIds.length === 0
      ? t('results.scopeAll')
      : t('results.scopeSome', {
          list: scopeIds.map((id) => tScope(`items.${id}.label`)).join(', '),
        });
  const chamber = dto.filters.chamberCodes?.[0];
  const anySourceResponded = dto.live.sources.some(
    (s) => s.status === 'done' || s.status === 'stale',
  );

  return (
    <PageContainer width="content">
      <PageHeader title={t('title')}>
        <SearchForm
          key={dto.searchId}
          compact
          initial={{ query: dto.query, filters: dto.filters }}
        />
      </PageHeader>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-muted">
        <span>{scopeText}</span>
        {chamber && <span>{t('results.chamberSel', { name: chamberLabel(chamber) })}</span>}
        {(dto.filters.dateFrom || dto.filters.dateTo) && (
          <span>
            {t('results.dateRange', {
              from: formatIsoDate(dto.filters.dateFrom) ?? t('results.dateOpen'),
              to: formatIsoDate(dto.filters.dateTo) ?? t('results.dateOpen'),
            })}
          </span>
        )}
      </p>

      <section aria-labelledby="canli-arama" aria-busy={liveBusy || undefined}>
        <Card className="flex flex-col gap-3 p-5">
          <h2 id="canli-arama" className="text-title text-fg">
            {t('live.title')}
          </h2>
          {banner.kind === 'none' && (
            <NoticeBanner tone="neutral">{t('live.noLiveSource')}</NoticeBanner>
          )}
          {banner.kind === 'blocked_pii' && (
            <NoticeBanner tone="warning">{t('live.pii')}</NoticeBanner>
          )}
          {banner.kind === 'cta' && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-body-sm text-fg-muted">
                {dto.liveReasons.map((r) => (
                  <p key={r}>{t(`live.reason.${r}`)}</p>
                ))}
                <p>{t('live.ctaBody')}</p>
              </div>
              <Button
                variant={banner.primary ? 'primary' : 'outline'}
                size="lg"
                leadingIcon="nav.search"
                loading={liveBusy}
                loadingLabel={t('live.loading')}
                aria-disabled={cooldown || undefined}
                onClick={() => {
                  if (!cooldown) void runLive(false);
                }}
              >
                {t('live.button')}
              </Button>
            </div>
          )}
          {dto.live.status === 'stale' && dto.live.staleAsOf && (
            <NoticeBanner tone="info">
              {t('live.stale', { date: formatIsoDate(dto.live.staleAsOf) ?? '' })}
            </NoticeBanner>
          )}
          {dto.live.sources.length > 0 && (
            <div>
              <h3 className="text-body-sm font-medium text-fg">{t('live.sourcesTitle')}</h3>
              <ul className="mt-1 flex flex-col gap-1 text-body-sm">
                {dto.live.sources.map((s) => {
                  const key = sourceStatusKey(s);
                  return (
                    <li key={s.source} className="flex flex-wrap gap-x-2">
                      <span className="font-medium text-fg">{t(`source.${s.source}`)}:</span>
                      <span className="text-fg-muted">
                        {t(`live.sourceStatus.${key}`, { n: s.resultCount })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {banner.kind === 'done' && dto.live.hasMore && (
            <div>
              <Button
                variant="outline"
                loading={liveBusy}
                loadingLabel={t('live.loading')}
                aria-disabled={cooldown || undefined}
                onClick={() => {
                  if (!cooldown) void runLive(true);
                }}
              >
                {t('live.more')}
              </Button>
            </div>
          )}
          {errKey && (
            <NoticeBanner tone={errKey === 'pii' ? 'warning' : 'danger'} role="alert">
              {t(`live.${errKey}`, { sec })}
            </NoticeBanner>
          )}
        </Card>
      </section>

      <section aria-labelledby="sonuclar" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <h2 id="sonuclar" ref={headingRef} tabIndex={-1} className="text-title text-fg">
            {t('results.pageHeading', { page: pagination.page })}
          </h2>
          <div className="flex items-center gap-3">
            {pagination.total > 0 && (
              <span className="text-caption text-fg-subtle">
                {t('results.count', { total: pagination.total })}
              </span>
            )}
            <span className="flex items-center gap-2 text-caption text-fg-muted">
              <label htmlFor="siralama">{t('results.sortLabel')}</label>
              <Select
                id="siralama"
                size="sm"
                value={sortParamOf(sort)}
                onChange={(e) => go(1, SORT_PARAM[e.target.value as SortParam], true)}
                options={(Object.keys(SORT_PARAM) as SortParam[]).map((k) => ({
                  value: k,
                  label: t(`results.sort.${k}`),
                }))}
              />
            </span>
          </div>
        </div>

        {!dto.live.requested && dto.items.length === 0 && (
          <NoticeBanner tone="info">{t('results.localEmpty')}</NoticeBanner>
        )}
        {dto.live.requested && pagination.total === 0 && anySourceResponded && (
          <EmptyState
            icon="nav.decisions"
            as="h3"
            title={t('results.emptyTitle')}
            description={t('results.emptyBody')}
          />
        )}

        {dto.items.length > 0 && (
          <ol className="flex flex-col divide-y divide-border">
            {dto.items.map((hit) => (
              <li key={hit.decisionId}>
                <DecisionCard hit={hit} />
              </li>
            ))}
          </ol>
        )}

        {pagination.pageCount > 1 && (
          <div className="flex flex-col items-center gap-2">
            <Pagination
              mode="prev-next"
              hasPrevious={pagination.page > 1}
              hasNext={pagination.page < pagination.pageCount}
              onPrevious={() => go(pagination.page - 1, sort)}
              onNext={() => go(pagination.page + 1, sort)}
              labels={{
                nav: t('results.pagesNav'),
                previous: t('results.previous'),
                next: t('results.next'),
                loading: t('results.loading'),
              }}
              className="w-full"
            />
            <span className="text-caption text-fg-subtle tabular-nums">
              {t('results.pageOf', { page: pagination.page, count: pagination.pageCount })}
            </span>
          </div>
        )}
        {pagination.total >= ARCHIVE_POOL_MAX && (
          <p className="text-caption text-fg-subtle">
            {t('results.poolNote', { max: ARCHIVE_POOL_MAX })}
          </p>
        )}
        {dto.live.requested && (
          <p className="text-caption text-fg-subtle">{t('results.coverageNote')}</p>
        )}
      </section>
    </PageContainer>
  );
}
