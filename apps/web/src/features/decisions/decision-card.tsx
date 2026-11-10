'use client';
// Sonuç kartı (053-04 §4.4 `SerpResultCard`): `article` + `h3` bağlantı; kaynak rozeti metinle, künye
// sunucudan (mono), alaka yüzdesiz (canlıda puan yok → çizilmez), eylem adları künyeyi içerir.
// Snippet düz metindir (HTML enjeksiyonu yok). İç içe etkileşimli öğe yoktur.
import type { DecisionHitDtoValue } from '@eda/contracts/api';
import { Badge, Button } from '@eda/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CopyButton, formatIsoDate, OfficialLink } from '../../lib/research-ui.tsx';
import { decisionHref } from './url-state.ts';

export function DecisionCard({ hit }: { hit: DecisionHitDtoValue }) {
  const t = useTranslations('archive');
  const href = decisionHref(hit.decisionId);
  const date = formatIsoDate(hit.decisionDate);
  const retrieved = formatIsoDate(hit.retrievedAt);
  const sourceLabel = t.has(`source.${hit.source}`) ? t(`source.${hit.source}`) : hit.source;
  return (
    <article
      className={
        hit.origin === 'live'
          ? 'flex flex-col gap-2 border-l-2 border-primary py-3 pl-4'
          : 'flex flex-col gap-2 py-3'
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
        <Badge tone={hit.origin === 'live' ? 'primary' : 'neutral'}>
          {hit.origin === 'live' ? t('card.live', { source: sourceLabel }) : t('card.local')}
        </Badge>
        {hit.relevance !== null && (
          <Badge tone="neutral">{t(`card.relevance.${hit.relevance}`)}</Badge>
        )}
        {hit.hasDissent && <Badge tone="neutral">{t('decision.role.karsi_oy')}</Badge>}
        {retrieved && <span className="ml-auto">{t('card.retrieved', { date: retrieved })}</span>}
      </div>
      <p className="font-mono text-caption text-fg">{hit.shortKunye}</p>
      <h3 className="text-body font-semibold">
        <Link
          href={href}
          className="text-primary underline-offset-2 hover:underline focus-visible:focus-ring"
        >
          {hit.title ?? hit.shortKunye}
        </Link>
      </h3>
      <p className="text-body-sm text-fg-muted">
        {date && <span className="tabular-nums">{date}</span>}
        {date && ' — '}
        {hit.snippet ?? t('card.noSnippet')}
      </p>
      <div className="flex flex-wrap items-start gap-2">
        <Button
          size="sm"
          variant="outline"
          render={<Link href={href} />}
          aria-label={t('card.openLabel', { kunye: hit.shortKunye })}
        >
          {t('card.open')}
        </Button>
        <CopyButton
          size="sm"
          variant="ghost"
          leadingIcon="action.copy"
          text={hit.shortKunye}
          aria-label={t('card.copyLabel', { kunye: hit.shortKunye })}
          copiedLabel={t('decision.copied')}
          announceText={t('card.copied', { kunye: hit.shortKunye })}
          failedLabel={t('card.copyFailed')}
        >
          {t('card.copy')}
        </CopyButton>
        <OfficialLink href={hit.url} label={t('card.portalLabel', { kunye: hit.shortKunye })}>
          {t('card.portal')}
        </OfficialLink>
      </div>
    </article>
  );
}
