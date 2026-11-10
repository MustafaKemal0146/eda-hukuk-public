'use client';
// Karar sayfası (053-04 §5): başlıkta sunucu künyesi (h1), köken ve erişim tarihi, eylemler (künye
// kopyala, resmî portalda aç), rol etiketli bölüm gezintisi ve bölüm metinleri. Bölümler en çok
// `ui.decisionSectionFetchConcurrency` (2; 053-04 §5) eşzamanlı istekle sırayla yüklenir; api tek
// `get_decision` yanıtını önbellekten verir. `bolum` URL parametresi ilgili bölüme kaydırır.
import type { DecisionDtoValue, SectionDtoValue } from '@eda/contracts/api';
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
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDecision,
  getDecisionSection,
  researchErrorOf,
  type SourceErrorInfo,
} from '../../lib/research-api.ts';
import { CopyButton, formatIsoDate, OfficialLink } from '../../lib/research-ui.tsx';
import { SectionText } from './section-text.tsx';
import { sectionFromParams } from './url-state.ts';

/** 053-04 §5.3: mahkeme görüşü olmayan roller rozet taşır. */
const NOT_COURT_OPINION = new Set(['istem', 'taraf_iddiasi', 'karsi_oy', 'tetkik_hakimi']);
const SECTION_CONCURRENCY = 2;

type SectionState =
  | { status: 'loading' }
  | { status: 'ready'; section: SectionDtoValue }
  | { status: 'error' };

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; dto: DecisionDtoValue }
  | { kind: 'error'; info: SourceErrorInfo };

function useSections(dto: DecisionDtoValue | null) {
  const [sections, setSections] = useState<ReadonlyMap<number, SectionState>>(new Map());
  const fetchOne = useCallback(async (decisionId: string, no: number) => {
    setSections((m) => new Map(m).set(no, { status: 'loading' }));
    try {
      const section = await getDecisionSection(decisionId, no);
      setSections((m) => new Map(m).set(no, { status: 'ready', section }));
    } catch {
      setSections((m) => new Map(m).set(no, { status: 'error' }));
    }
  }, []);
  useEffect(() => {
    if (dto === null || dto.textStatus !== 'full') return;
    let cancelled = false;
    const queue = dto.sections.map((s) => s.sectionNo);
    const worker = async () => {
      for (let no = queue.shift(); no !== undefined && !cancelled; no = queue.shift()) {
        await fetchOne(dto.decisionId, no);
      }
    };
    void Promise.all(Array.from({ length: SECTION_CONCURRENCY }, worker));
    return () => {
      cancelled = true;
    };
  }, [dto, fetchOne]);
  return { sections, retry: fetchOne };
}

export function DecisionView({ decisionId }: { decisionId: string }) {
  const t = useTranslations('archive');
  const router = useRouter();
  const params = useSearchParams();
  const wantedSection = sectionFromParams(params);
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const scrolled = useRef(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', dto: await getDecision(decisionId) });
    } catch (err) {
      setState({ kind: 'error', info: researchErrorOf(err) });
    }
  }, [decisionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dto = state.kind === 'ready' ? state.dto : null;
  const { sections, retry } = useSections(dto);

  // Derin bağlantı: `bolum` bölümü yüklendiğinde bir kez kaydırılır.
  useEffect(() => {
    if (scrolled.current || wantedSection === null) return;
    if (sections.get(wantedSection)?.status !== 'ready') return;
    scrolled.current = true;
    document.getElementById(`b${wantedSection}`)?.scrollIntoView({ block: 'start' });
  }, [sections, wantedSection]);

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
          <span className="sr-only">{t('decision.sectionLoading')}</span>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (state.kind === 'error') {
    const code = state.info.code;
    const notFound =
      code === 'SOURCE_DOCUMENT_NOT_FOUND' || code === 'VALIDATION_RESOURCE_NOT_FOUND';
    return (
      <PageContainer width="doc">
        {notFound ? (
          <EmptyState
            icon="nav.decisions"
            title={t('decision.notFoundTitle')}
            description={t('decision.notFoundBody')}
            actions={
              <Button render={<Link href="/karar-arsivi" />}>{t('results.newSearch')}</Button>
            }
          />
        ) : (
          <ErrorState
            title={t('decision.loadError')}
            message={
              code === 'SOURCE_BUSY'
                ? t('decision.busy', { sec: state.info.retryAfterSec ?? 30 })
                : code === 'SOURCE_UNAVAILABLE'
                  ? t('decision.unavailable')
                  : (state.info.message ?? undefined)
            }
            {...(state.info.requestId ? { requestId: state.info.requestId } : {})}
            onRetry={() => void load()}
            labels={stateLabels}
          />
        )}
      </PageContainer>
    );
  }

  const d = state.dto;
  const sourceLabel = t.has(`source.${d.source}`) ? t(`source.${d.source}`) : d.source;
  const retrieved = formatIsoDate(d.retrievedAt);
  const date = formatIsoDate(d.decisionDate);
  const meta: [string, string | null][] = [
    [t('decision.court'), d.court || null],
    [t('decision.chamberLabel'), d.chamber],
    [t('decision.esasNo'), d.esasNo],
    [t('decision.kararNo'), d.kararNo],
    [t('decision.date'), date],
  ];

  return (
    <PageContainer width="doc">
      <Breadcrumb
        label={t('decision.breadcrumb')}
        items={[
          { label: t('title'), render: <Link href="/karar-arsivi" /> },
          { label: d.shortKunye },
        ]}
      />
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
          <Badge tone="primary">{t('decision.live', { source: sourceLabel })}</Badge>
          {retrieved && <span>{t('decision.retrieved', { date: retrieved })}</span>}
        </div>
        <h1 className="font-mono text-heading-md text-fg">{d.shortKunye}</h1>
        {d.title && <p className="text-body text-fg-muted">{d.title}</p>}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-body-sm">
          {meta
            .filter(([, v]) => v !== null && v !== '')
            .map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="text-fg-muted">{k}</dt>
                <dd className="text-fg tabular-nums">{v}</dd>
              </div>
            ))}
        </dl>
        <div className="flex flex-wrap items-start gap-2">
          <CopyButton
            size="sm"
            variant="outline"
            leadingIcon="action.copy"
            text={d.fullKunye}
            copiedLabel={t('decision.copied')}
            failedLabel={t('decision.copyFailed')}
          >
            {t('decision.copyFull')}
          </CopyButton>
          <CopyButton
            size="sm"
            variant="ghost"
            leadingIcon="action.copy"
            text={d.shortKunye}
            copiedLabel={t('decision.copied')}
            failedLabel={t('decision.copyFailed')}
          >
            {t('decision.copyShort')}
          </CopyButton>
          <OfficialLink href={d.url}>{t('decision.portal')}</OfficialLink>
          <Button size="sm" variant="ghost" aria-disabled title={t('decision.discussLocked')}>
            {t('decision.discuss')}
          </Button>
        </div>
        <p className="text-caption text-fg-subtle">{t('decision.discussLocked')}</p>
        {d.warnings.includes('metadata_partial') && (
          <NoticeBanner tone="warning">{t('decision.metadataPartial')}</NoticeBanner>
        )}
        {d.warnings.includes('truncated_max_chars') && (
          <NoticeBanner tone="info">{t('decision.truncated')}</NoticeBanner>
        )}
      </header>

      {d.textStatus === 'unavailable' ? (
        <NoticeBanner tone="warning">{t('decision.textUnavailable')}</NoticeBanner>
      ) : (
        <div className="grid gap-8 lg:grid-cols-4">
          <nav aria-label={t('decision.sectionsNav')} className="lg:sticky lg:top-4 lg:self-start">
            <ol className="flex flex-col gap-1 text-body-sm">
              {d.sections.map((s) => (
                <li key={s.sectionNo}>
                  <a
                    href={`#b${s.sectionNo}`}
                    onClick={() => router.replace(`?bolum=${s.sectionNo}`, { scroll: false })}
                    className="block rounded-sm px-2 py-1 text-fg-muted hover:bg-surface-sunken hover:text-fg focus-visible:focus-ring"
                  >
                    {s.sectionNo}. {t(`decision.role.${s.role}`)}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="flex min-w-0 flex-col gap-8 lg:col-span-3">
            {d.sections.map((s) => {
              const st = sections.get(s.sectionNo);
              return (
                <section
                  key={s.sectionNo}
                  id={`b${s.sectionNo}`}
                  aria-labelledby={`b${s.sectionNo}-h`}
                  aria-busy={st?.status !== 'ready' || undefined}
                  className="flex scroll-mt-4 flex-col gap-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id={`b${s.sectionNo}-h`} className="text-title text-fg">
                      {t('decision.sectionHeading', {
                        n: s.sectionNo,
                        role: t(`decision.role.${s.role}`),
                      })}
                    </h2>
                    {NOT_COURT_OPINION.has(s.role) && (
                      <Badge tone="warning">{t('decision.notCourtOpinion')}</Badge>
                    )}
                  </div>
                  {st?.status === 'ready' ? (
                    <SectionText markdown={st.section.text} idPrefix={`b${s.sectionNo}`} />
                  ) : st?.status === 'error' ? (
                    <NoticeBanner
                      tone="danger"
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void retry(d.decisionId, s.sectionNo)}
                        >
                          {t('states.retry')}
                        </Button>
                      }
                    >
                      {t('decision.sectionError')}
                    </NoticeBanner>
                  ) : (
                    <Skeleton className="h-24 w-full" />
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
