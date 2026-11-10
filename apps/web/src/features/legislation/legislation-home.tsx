'use client';
// Mevzuat başlangıç ekranı (053-05 §3): tek satır arama kutusu (madde atfı / kanun numarası doğrudan
// açılır, diğer metin maddelerde aranır), tür süzgeci (`tur`, kanonik `law_type`), sık kullanılan
// kanunlar ve madde sonuçları. Kanun kataloğu (`GET /legislation/laws`) korpus ister.
// Arama sorgusu URL'ye, depoya ve önbellek anahtarına yazılmaz.
import {
  LAW_TYPE_URL,
  type LegislationSearchResultsDtoValue,
  lawTypeFromUrl,
} from '@eda/contracts/api';
import { LAW_TYPES, type LawType } from '@eda/contracts/enums';
import {
  Button,
  Chip,
  Icon,
  Input,
  NoticeBanner,
  PageContainer,
  PageHeader,
  SectionHeader,
  useAnnounce,
} from '@eda/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import {
  researchErrorOf,
  type SourceErrorInfo,
  searchLegislation,
} from '../../lib/research-api.ts';
import { legislationErrorKey } from './errors.ts';
import { featuredLaws } from './featured-laws.ts';
import { HitList } from './hit-list.tsx';
import { articleHref, classifyOmnibox, lawHref } from './omnibox.ts';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LegislationHome() {
  const t = useTranslations('legislation');
  const router = useRouter();
  const params = useSearchParams();
  const announce = useAnnounce();
  const id = useId();
  const hintId = useId();
  const type = lawTypeFromUrl(params.get('tur'));
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<LegislationSearchResultsDtoValue | null>(null);
  const [error, setError] = useState<SourceErrorInfo | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = query.trim();
    if (text.length < 2 || pending) return;
    const c = classifyOmnibox(text, todayIso());
    if (c.kind === 'article') {
      router.push(articleHref(c.lawNo, c.articleNo, type));
      return;
    }
    if (c.kind === 'law') {
      router.push(lawHref(c.lawNo, type));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const dto = await searchLegislation({
        query: text,
        lawNo: null,
        lawType: type,
        includeRepealed: false,
      });
      setResult(dto);
      announce(dto.empty ? t('hits.empty') : t('hits.found', { n: dto.items.length }));
    } catch (err) {
      setResult(null);
      setError(researchErrorOf(err));
    } finally {
      setPending(false);
    }
  }

  const setType = (next: LawType | null) => {
    const href = next === null ? '/mevzuat' : `/mevzuat?tur=${LAW_TYPE_URL[next]}`;
    router.replace(href, { scroll: false });
  };

  const errKey = error ? legislationErrorKey(error) : null;

  return (
    <PageContainer width="content">
      <PageHeader title={t('title')} description={t('intro')}>
        <search>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label htmlFor={id} className="text-body-sm font-medium text-fg">
              {t('searchLabel')}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Icon
                  icon="nav.search"
                  size="sm"
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle"
                />
                <Input
                  id={id}
                  type="search"
                  size="lg"
                  value={query}
                  maxLength={500}
                  aria-describedby={hintId}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="pl-8"
                />
              </div>
              {query !== '' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={() => {
                    setQuery('');
                    setResult(null);
                    setError(null);
                  }}
                >
                  {t('clear')}
                </Button>
              )}
              <Button
                type="submit"
                size="lg"
                disabled={query.trim().length < 2}
                loading={pending}
                loadingLabel={t('searching')}
              >
                {t('search')}
              </Button>
            </div>
            <p id={hintId} className="text-caption text-fg-subtle">
              {t('searchHint')}
            </p>
            <fieldset className="flex flex-wrap items-center gap-1.5">
              <legend className="mr-2 inline text-caption text-fg-muted">{t('typeLabel')}</legend>
              {[null, ...LAW_TYPES].map((k) => (
                <label
                  key={k ?? 'all'}
                  className="inline-flex h-7 cursor-pointer items-center rounded-full border border-border px-3 text-body-sm text-fg-muted transition-colors duration-fast hover:text-fg has-checked:border-primary has-checked:bg-primary has-checked:text-on-primary has-focus-visible:focus-ring pointer-coarse:min-h-11"
                >
                  <input
                    type="radio"
                    name="tur"
                    checked={type === k}
                    onChange={() => setType(k)}
                    className="sr-only"
                  />
                  {t(`types.${k ?? 'all'}`)}
                </label>
              ))}
            </fieldset>
          </form>
        </search>
      </PageHeader>

      <section aria-labelledby="sik-kanunlar" className="flex flex-col gap-3">
        <SectionHeader id="sik-kanunlar" title={t('featuredTitle')} />
        <ul className="flex flex-wrap gap-2">
          {featuredLaws().map((law) => (
            <li key={law.lawNo}>
              <Link
                href={lawHref(law.lawNo)}
                className="inline-flex min-h-control-sm items-center rounded-full focus-visible:focus-ring pointer-coarse:min-h-11"
              >
                <Chip>
                  {law.abbr
                    ? t('featuredChip', { abbr: law.abbr, no: law.lawNo })
                    : t('lawNoLabel', { no: law.lawNo })}
                </Chip>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {(result || errKey) && (
        <section aria-labelledby="madde-sonuclari" className="flex flex-col gap-3">
          <SectionHeader id="madde-sonuclari" title={t('hits.title')} />
          {errKey && (
            <NoticeBanner tone="danger" role="alert">
              {t(`errors.${errKey === 'notFound' ? 'generic' : errKey}`, {
                sec: error?.retryAfterSec ?? 30,
              })}
            </NoticeBanner>
          )}
          {result && result.items.length > 0 && (
            <>
              <p className="text-caption text-fg-subtle">{t('hits.note')}</p>
              <HitList items={result.items} />
            </>
          )}
          {result?.empty && <NoticeBanner tone="neutral">{t('hits.empty')}</NoticeBanner>}
        </section>
      )}

      <p className="text-caption text-fg-subtle">{t('disclaimer')}</p>
    </PageContainer>
  );
}
