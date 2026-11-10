'use client';
// Karar arama formu (053-04 §3.1, §3.6; 052 `SearchHero`): `role="search"`, etiketli çok satırlı alan
// (Enter gönderir, Shift+Enter satır; IME birleştirmesinde gönderilmez), kapsam (ortak `ScopePicker`),
// daire (yalnız Yargıtay/Danıştay), tarih aralığı. Gönderim `POST /decisions/search` → bellek
// önbelleği → `router.push('/karar-arsivi/ara/'+searchId)`. Sorgu URL'ye ve depoya yazılmaz.
import {
  ARCHIVE_CHAMBER_CODES,
  type CorpusFiltersValue,
  type DecisionSearchRequestValue,
} from '@eda/contracts/api';
import type { ScopeItemId } from '@eda/contracts/scope';
import { scopeFromRequest, scopeToRequest } from '@eda/contracts/scope';
import { COURT_TYPES, type CourtType } from '@eda/contracts/tools';
import { Button, DateField, NoticeBanner, Select, Textarea } from '@eda/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { researchErrorOf, searchDecisions } from '../../lib/research-api.ts';
import { ScopePicker } from '../scope/scope-picker.tsx';
import { rememberResults } from './search-cache.ts';
import { serpHref } from './url-state.ts';

const QUERY_MAX = 20000;

type ChamberGroup = keyof typeof ARCHIVE_CHAMBER_CODES;

/** Daire süzgeci yalnız kapsam tek başına Yargıtay (KYB dahil) veya Danıştay iken (041 §5.2). */
export function chamberGroupOf(courtTypes: readonly string[] | null): ChamberGroup | null {
  if (courtTypes === null || courtTypes.length === 0) return null;
  if (courtTypes.every((c) => c === 'yargitay' || c === 'kyb')) return 'yargitay';
  if (courtTypes.every((c) => c === 'danistay')) return 'danistay';
  return null;
}

/** Kapsam seçimi + daire + tarih → `CorpusFilters`; yalnız mevzuat seçiliyse mahkeme kısıtı yok. */
export function buildFilters(
  scope: readonly ScopeItemId[] | null,
  chamber: string,
  dateFrom: string,
  dateTo: string,
): CorpusFiltersValue {
  const courtTypes = scopeToRequest(scope).courtTypes;
  const types = courtTypes !== null && courtTypes.length > 0 ? courtTypes : null;
  const group = chamberGroupOf(types);
  const chamberOk =
    group !== null &&
    chamber !== '' &&
    (ARCHIVE_CHAMBER_CODES[group] as readonly string[]).includes(chamber);
  return {
    courtTypes: types,
    chamberCodes: chamberOk ? [chamber] : null,
    dateFrom: dateFrom === '' ? null : dateFrom,
    dateTo: dateTo === '' ? null : dateTo,
  };
}

export function useChamberLabel(): (code: string) => string {
  const t = useTranslations('archive.chamberName');
  return (code) => {
    const m = /^([HCD])(\d+)$/.exec(code);
    return m ? t(m[1] ?? 'H', { n: Number(m[2]) }) : t(code);
  };
}

export function SearchForm({
  initial,
  compact = false,
}: {
  initial?: DecisionSearchRequestValue;
  compact?: boolean;
}) {
  const t = useTranslations('archive');
  const router = useRouter();
  const chamberLabel = useChamberLabel();
  const ids = {
    query: useId(),
    hint: useId(),
    from: useId(),
    to: useId(),
    chamber: useId(),
    chamberHint: useId(),
  };
  const [query, setQuery] = useState(initial?.query ?? '');
  const [scope, setScope] = useState<ScopeItemId[] | null>(() =>
    initial?.filters.courtTypes
      ? scopeFromRequest({
          sources: [],
          courtTypes: initial.filters.courtTypes.filter((c): c is CourtType =>
            (COURT_TYPES as readonly string[]).includes(c),
          ),
        })
      : null,
  );
  const [chamber, setChamber] = useState(initial?.filters.chamberCodes?.[0] ?? '');
  const [dateFrom, setDateFrom] = useState(initial?.filters.dateFrom ?? '');
  const [dateTo, setDateTo] = useState(initial?.filters.dateTo ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const courtTypes = scopeToRequest(scope).courtTypes;
  const group = chamberGroupOf(courtTypes);
  const trimmed = query.trim();
  const canSubmit = trimmed.length >= 2 && !pending;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const dto = await searchDecisions({
        query: trimmed,
        filters: buildFilters(scope, chamber, dateFrom, dateTo),
      });
      rememberResults(dto);
      router.push(serpHref(dto.searchId, 1, 'relevance'));
    } catch (err) {
      const info = researchErrorOf(err);
      setError(
        info.code === 'VALIDATION_FAILED'
          ? t('errors.validation')
          : info.code === 'CLIENT_NETWORK'
            ? t('errors.network')
            : (info.message ?? t('errors.generic')),
      );
      setPending(false);
    }
  }

  const chamberOptions = [
    { value: '', label: t('chamberAll') },
    ...(group
      ? ARCHIVE_CHAMBER_CODES[group].map((c) => ({ value: c, label: chamberLabel(c) }))
      : []),
  ];

  return (
    <search className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.query} className="text-body-sm font-medium text-fg">
            {t('queryLabel')}
          </label>
          <Textarea
            id={ids.query}
            value={query}
            maxLength={QUERY_MAX}
            rows={compact ? 2 : 3}
            autoGrow
            maxRows={8}
            aria-describedby={ids.hint}
            placeholder={t('queryPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <p id={ids.hint} className="text-caption text-fg-subtle">
            {t('queryHint')}
            {query.length >= QUERY_MAX * 0.8 && (
              <span className="ml-2 tabular-nums">
                {t('queryCounter', { count: query.length, max: QUERY_MAX })}
              </span>
            )}
          </p>
        </div>
        <fieldset className="flex flex-wrap items-end gap-3">
          <legend className="sr-only">{t('filtersLabel')}</legend>
          <div className="flex flex-col gap-1">
            <span className="text-caption text-fg-muted">{t('scopeLabel')}</span>
            <ScopePicker
              value={scope}
              onChange={(next) => {
                setScope(next);
                if (chamberGroupOf(scopeToRequest(next).courtTypes) !== group) setChamber('');
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.chamber} className="text-caption text-fg-muted">
              {t('chamber')}
            </label>
            <Select
              id={ids.chamber}
              size="sm"
              value={group ? chamber : ''}
              disabled={group === null}
              aria-describedby={group === null ? ids.chamberHint : undefined}
              onChange={(e) => setChamber(e.target.value)}
              options={chamberOptions}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.from} className="text-caption text-fg-muted">
              {t('dateFrom')}
            </label>
            <DateField
              id={ids.from}
              size="sm"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.to} className="text-caption text-fg-muted">
              {t('dateTo')}
            </label>
            <DateField
              id={ids.to}
              size="sm"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            size={compact ? 'md' : 'lg'}
            leadingIcon="nav.search"
            disabled={!canSubmit}
            loading={pending}
            loadingLabel={t('submitting')}
            className="ml-auto"
          >
            {compact ? t('results.research') : t('submit')}
          </Button>
        </fieldset>
        {group === null && (
          <p id={ids.chamberHint} className="text-caption text-fg-subtle">
            {t('chamberHint')}
          </p>
        )}
      </form>
      {error && (
        <NoticeBanner tone="danger" role="alert">
          {error}
        </NoticeBanner>
      )}
    </search>
  );
}
