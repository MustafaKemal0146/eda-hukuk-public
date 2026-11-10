'use client';
// Kaynak önizleme (#58): kararın tam metni sohbetten çıkmadan, bölüm bölüm okunur. Atıf yapılan pasaj
// yanıttaki cümleden deterministik olarak eşlenir (highlight.ts) ve görünüme ortalanır; metin düz
// metindir, vurgu yalnız `<mark>` ile dilimlenmiş dize parçalarından kurulur.
import { encodeLiveDecisionId } from '@eda/contracts/api';
import type { SourceItem } from '@eda/contracts/stream';
import { Button, ErrorState, IconButton, Skeleton } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getDecision, getDecisionSection, researchErrorOf } from '../../lib/research-api.ts';
import { paragraphsOf } from '../decisions/section-text.tsx';
import { findPassage, splitByRanges } from './highlight.ts';

type LoadedSection = { no: number; role: string; paragraphs: string[] };

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; sections: LoadedSection[]; unavailable: boolean }
  | { kind: 'error'; message: string | null };

const SECTION_CONCURRENCY = 2;

/** `bedesten:123` → canlı karar kimliği; çözülemeyen kimlik önizlenemez. */
export function previewIdOf(source: SourceItem): string | null {
  if (source.kind !== 'decision') return null;
  const i = source.sourceId.indexOf(':');
  const code = source.sourceId.slice(0, i);
  const documentId = source.sourceId.slice(i + 1);
  if (i < 0 || documentId === '') return null;
  if (code !== 'bedesten' && code !== 'anayasa' && code !== 'uyusmazlik') return null;
  return encodeLiveDecisionId(code, documentId);
}

function useDecisionSections(decisionId: string): { state: State; retry: () => void } {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const dto = await getDecision(decisionId);
        if (dto.textStatus !== 'full') {
          if (!cancelled) setState({ kind: 'ready', sections: [], unavailable: true });
          return;
        }
        const queue = [...dto.sections];
        const done = new Map<number, LoadedSection>();
        const worker = async () => {
          for (let s = queue.shift(); s && !cancelled; s = queue.shift()) {
            const sec = await getDecisionSection(decisionId, s.sectionNo);
            done.set(s.sectionNo, {
              no: sec.sectionNo,
              role: sec.role,
              paragraphs: paragraphsOf(sec.text).map((p) => p.replace(/\*\*/g, '')),
            });
          }
        };
        await Promise.all(Array.from({ length: SECTION_CONCURRENCY }, worker));
        if (!cancelled) {
          const sections = dto.sections.flatMap((s) => done.get(s.sectionNo) ?? []);
          setState({ kind: 'ready', sections, unavailable: false });
        }
      } catch (err) {
        if (!cancelled) setState({ kind: 'error', message: researchErrorOf(err).message ?? null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [decisionId, attempt]);
  return { state, retry: () => setAttempt((n) => n + 1) };
}

export function SourcePreview({
  source,
  decisionId,
  claim,
  onClose,
}: {
  source: SourceItem;
  decisionId: string;
  claim: string;
  onClose: () => void;
}) {
  const t = useTranslations('chat.sources');
  const ta = useTranslations('archive');
  const { state, retry } = useDecisionSections(decisionId);
  const markRef = useRef<HTMLElement>(null);

  // Pasaj, bölümler art arda eklenmiş tek metin üzerinde bulunur; her paragraf kendi aralığını alır.
  const view = useMemo(() => {
    if (state.kind !== 'ready') return null;
    const offsets: number[] = [];
    let full = '';
    for (const s of state.sections) {
      for (const p of s.paragraphs) {
        offsets.push(full.length);
        full += `${p}\n\n`;
      }
    }
    const passage = claim === '' ? null : findPassage(claim, full);
    return { offsets, passage };
  }, [state, claim]);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: 'center' });
  }, [view]);

  let paragraphIndex = 0;
  let firstMark = true;
  const roleLabel = (role: string) =>
    ta.has(`decision.role.${role}` as Parameters<typeof ta.has>[0])
      ? ta(`decision.role.${role}` as Parameters<typeof ta>[0])
      : role;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-title text-fg">{t('preview.title')}</h2>
          <p className="truncate text-caption text-fg-subtle">{source.shortKunye}</p>
        </div>
        <IconButton icon="action.close" label={t('preview.back')} onClick={onClose} />
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto p-4">
        {state.kind === 'loading' && (
          <div aria-busy="true" className="flex flex-col gap-3">
            <span className="sr-only">{t('preview.loading')}</span>
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {state.kind === 'error' && (
          <ErrorState
            as="h3"
            title={t('preview.errorTitle')}
            message={state.message ?? t('preview.errorBody')}
            onRetry={retry}
            labels={{
              retry: t('preview.retry'),
              retrying: t('preview.loading'),
              supportCode: '',
              copy: '',
              copied: '',
            }}
          />
        )}
        {state.kind === 'ready' && state.unavailable && (
          <p className="text-body-sm text-fg-muted">{t('preview.unavailable')}</p>
        )}
        {state.kind === 'ready' && view && (
          <div className="flex flex-col gap-5">
            {claim !== '' && (
              <p className="rounded-sm bg-surface-sunken px-3 py-2 text-caption text-fg-muted">
                {view.passage && view.passage.ranges.length > 0
                  ? t(view.passage.kind === 'quote' ? 'passage.quote' : 'passage.overlap')
                  : t('passage.none')}
              </p>
            )}
            {view.passage && view.passage.unmatchedQuotes.length > 0 && (
              <p
                role="alert"
                className="rounded-sm bg-warning-soft px-3 py-2 text-caption text-warning-on-soft"
              >
                {t('passage.notVerbatim')}
              </p>
            )}
            {state.sections.length > 1 && (
              <nav aria-label={t('preview.sections')} className="flex flex-wrap gap-1">
                {state.sections.map((s) => (
                  <Button
                    key={s.no}
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      document
                        .getElementById(`onizleme-b${s.no}`)
                        ?.scrollIntoView({ block: 'start' })
                    }
                  >
                    {roleLabel(s.role)}
                  </Button>
                ))}
              </nav>
            )}
            {state.sections.map((s) => (
              <section key={s.no} id={`onizleme-b${s.no}`} className="flex flex-col gap-2">
                <h3 className="text-body font-semibold text-fg">{roleLabel(s.role)}</h3>
                {s.paragraphs.map((p) => {
                  const start = view.offsets[paragraphIndex] ?? 0;
                  paragraphIndex += 1;
                  const ranges = (view.passage?.ranges ?? [])
                    .filter((r) => r.end > start && r.start < start + p.length)
                    .map((r) => ({
                      start: Math.max(0, r.start - start),
                      end: Math.min(p.length, r.end - start),
                    }));
                  return (
                    <p
                      key={`${s.no}-${start}`}
                      lang="tr"
                      className="whitespace-pre-line text-body-sm text-fg"
                    >
                      {splitByRanges(p, ranges).map((part, i) => {
                        if (!part.mark) return <span key={`${i}-t`}>{part.text}</span>;
                        const attach = firstMark;
                        firstMark = false;
                        return (
                          <mark
                            key={`${i}-m`}
                            {...(attach ? { ref: markRef } : {})}
                            className="rounded-sm bg-warning-soft box-decoration-clone text-fg underline decoration-warning decoration-2 underline-offset-2"
                          >
                            {part.text}
                          </mark>
                        );
                      })}
                    </p>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
