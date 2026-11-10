'use client';
// Madde sayfası (053-05 §5): h1 "KISA AD m. N — başlık", köken + erişim, mülga işareti (metin + rozet;
// yalnız renk değil), düz metin paragraflar (HTML/markdown yorumlanmaz), önceki/sonraki gezinme,
// kopyalama, resmî kaynak ve "Bu maddeye atıf yapan kararları ara" (POST /decisions/search; sorgu
// yalnız "KISA AD m. N"). `tarih` geçerliyse `asOf` olarak iletilir; MVP'de tarih seçici yoktur.
import { type ArticleDtoValue, articleCitation, lawTypeFromUrl } from '@eda/contracts/api';
import {
  Badge,
  Breadcrumb,
  Button,
  EmptyState,
  ErrorState,
  NoticeBanner,
  PageContainer,
  Skeleton,
} from '@eda/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import {
  getArticle,
  researchErrorOf,
  type SourceErrorInfo,
  searchDecisions,
} from '../../lib/research-api.ts';
import { CopyButton, formatIsoDate, OfficialLink } from '../../lib/research-ui.tsx';
import { legislationErrorKey } from './errors.ts';
import { articleHref, lawHref } from './omnibox.ts';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; article: ArticleDtoValue }
  | { kind: 'error'; info: SourceErrorInfo };

/** `tarih` parametresi yalnız geçerli bir takvim günüyse (`YYYY-MM-DD`). */
export function asOfFromParam(raw: string | null): { asOf: string | null; invalid: boolean } {
  if (raw === null) return { asOf: null, invalid: false };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return { asOf: null, invalid: true };
  const d = new Date(`${raw}T00:00:00Z`);
  const ok = !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
  return ok ? { asOf: raw, invalid: false } : { asOf: null, invalid: true };
}

/** "TBK m. 352 — başlık\nmetin\n\nKaynak: …" (053-05 §5.3); erişim tarihi yoksa son satır çıkar. */
export function articleCopyText(
  a: ArticleDtoValue,
  sourceLine: string | null,
  repealedLabel: string,
): string {
  const head = `${a.status === 'repealed' ? `(${repealedLabel}) ` : ''}${articleCitation(a.shortName, a.lawNo, a.articleNo)}${a.title ? ` — ${a.title}` : ''}`;
  return sourceLine ? `${head}\n${a.text}\n\n${sourceLine}` : `${head}\n${a.text}`;
}

export function ArticleView({ lawNo, articleNo }: { lawNo: string; articleNo: string }) {
  const t = useTranslations('legislation');
  const router = useRouter();
  const params = useSearchParams();
  const type = lawTypeFromUrl(params.get('tur'));
  const { asOf, invalid: invalidDate } = asOfFromParam(params.get('tarih'));
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionError, setDecisionError] = useState<SourceErrorInfo | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', article: await getArticle(lawNo, articleNo, { type, asOf }) });
    } catch (err) {
      setState({ kind: 'error', info: researchErrorOf(err) });
    }
  }, [lawNo, articleNo, type, asOf]);

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
          <Skeleton className="h-48 w-full" />
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
            title={t('article.notFoundTitle')}
            description={t('article.notFoundBody')}
            actions={
              <Button render={<Link href={lawHref(lawNo, type)} />}>{t('law.searchInLaw')}</Button>
            }
          />
        ) : (
          <ErrorState
            title={t('article.loadError')}
            message={t(`errors.${key}`, { sec: state.info.retryAfterSec ?? 30 })}
            {...(state.info.requestId ? { requestId: state.info.requestId } : {})}
            onRetry={() => void load()}
            labels={stateLabels}
          />
        )}
      </PageContainer>
    );
  }

  const a = state.article;
  const citation = articleCitation(a.shortName, a.lawNo, a.articleNo);
  const retrieved = formatIsoDate(a.retrievedAt);
  const host = a.sourceUrl ? new URL(a.sourceUrl).hostname.replace(/^www\./, '') : null;
  const sourceLine = retrieved && host ? t('article.textSource', { host, date: retrieved }) : null;
  const neighbour = (no: string | null, rel: 'prev' | 'next') =>
    no === null ? null : (
      <Link
        href={articleHref(a.lawNo, no, a.lawType)}
        rel={rel}
        className="inline-flex min-h-control-sm items-center gap-1 rounded-md px-2 text-body-sm text-primary hover:underline focus-visible:focus-ring pointer-coarse:min-h-11"
      >
        {t(`article.${rel}`, { label: articleCitation(a.shortName, a.lawNo, no) })}
      </Link>
    );

  async function searchCiting() {
    setDecisionPending(true);
    setDecisionError(null);
    try {
      const dto = await searchDecisions({
        query: citation,
        filters: { courtTypes: null, chamberCodes: null, dateFrom: null, dateTo: null },
      });
      router.push(`/karar-arsivi/ara/${encodeURIComponent(dto.searchId)}`);
    } catch (err) {
      setDecisionError(researchErrorOf(err));
      setDecisionPending(false);
    }
  }

  return (
    <PageContainer width="doc">
      <Breadcrumb
        label={t('law.breadcrumb')}
        items={[
          { label: t('title'), render: <Link href="/mevzuat" /> },
          { label: a.lawTitle, render: <Link href={lawHref(a.lawNo, a.lawType)} /> },
          { label: citation },
        ]}
      />
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
          {a.status === 'repealed' && <Badge tone="warning">{t('article.repealed')}</Badge>}
          <Badge tone="primary">{t('live')}</Badge>
          {retrieved && <span>{t('retrieved', { date: retrieved })}</span>}
        </div>
        <h1 className="font-display text-heading-lg text-fg">
          <span className="font-mono">{citation}</span>
          {a.title && <span> — {a.title}</span>}
        </h1>
        <p className="text-body-sm text-fg-muted">{a.lawTitle}</p>
        {a.status === 'repealed' && (
          <NoticeBanner tone="warning">{t('article.repealedBand')}</NoticeBanner>
        )}
        {invalidDate && <NoticeBanner tone="warning">{t('article.invalidDate')}</NoticeBanner>}
        {a.asOfUnverified && (
          <NoticeBanner tone="warning">{t('article.asOfUnverified')}</NoticeBanner>
        )}
      </header>

      <section aria-labelledby="madde-metni" className="flex flex-col gap-3">
        <h2 id="madde-metni" className="sr-only">
          {t('article.textHeading')}
        </h2>
        <div lang="tr" className="flex max-w-prose flex-col gap-3 text-body text-fg">
          {a.text
            .split('\n')
            .filter((line) => line.trim() !== '')
            .map((line, i) => (
              <p key={i}>{line}</p>
            ))}
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-2">
        <CopyButton
          size="sm"
          variant="outline"
          leadingIcon="action.copy"
          text={citation}
          copiedLabel={t('article.copied')}
          failedLabel={t('article.copyFailed')}
        >
          {t('article.copyCitation')}
        </CopyButton>
        <CopyButton
          size="sm"
          variant="ghost"
          leadingIcon="action.copy"
          text={articleCopyText(a, sourceLine, t('article.repealed'))}
          copiedLabel={t('article.copied')}
          failedLabel={t('article.copyFailed')}
        >
          {t('article.copyText')}
        </CopyButton>
        <OfficialLink href={a.sourceUrl}>{t('sourceLink')}</OfficialLink>
        <Button
          size="sm"
          variant="outline"
          leadingIcon="nav.decisions"
          loading={decisionPending}
          loadingLabel={t('article.searchDecisionsBusy')}
          onClick={() => void searchCiting()}
        >
          {t('article.searchDecisions')}
        </Button>
      </div>
      {decisionError && (
        <NoticeBanner tone="danger" role="alert">
          {decisionError.message ?? t('errors.generic')}
        </NoticeBanner>
      )}

      {(a.prevArticleNo || a.nextArticleNo) && (
        <nav aria-label={t('article.nav')} className="flex flex-wrap justify-between gap-2">
          <span>{neighbour(a.prevArticleNo, 'prev')}</span>
          <span>{neighbour(a.nextArticleNo, 'next')}</span>
        </nav>
      )}

      <NoticeBanner tone="neutral">{t('article.mvpNote')}</NoticeBanner>
      <p className="text-caption text-fg-subtle">{t('disclaimer')}</p>
    </PageContainer>
  );
}
