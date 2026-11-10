'use client';
// Madde arama sonuçları (053-05 §3.3 `LegislationHitList`): en çok 5 öğe, kaynak rozeti metinle,
// yüzde yok, "Mülga" rozeti metinle; snippet düz metin (HTML enjeksiyonu yok).
import { articleCitation, type LegislationHitDtoValue } from '@eda/contracts/api';
import { Badge } from '@eda/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { articleHref, lawHref } from './omnibox.ts';

export function HitList({ items }: { items: readonly LegislationHitDtoValue[] }) {
  const t = useTranslations('legislation');
  return (
    <ol className="flex flex-col divide-y divide-border">
      {items.map((h) => {
        const label =
          h.articleNo === null ? null : articleCitation(h.shortName, h.lawNo, h.articleNo);
        const href =
          h.articleNo === null
            ? lawHref(h.lawNo, h.lawType)
            : articleHref(h.lawNo, h.articleNo, h.lawType);
        return (
          <li key={`${h.lawNo}:${h.articleNo ?? ''}`} className="flex flex-col gap-1.5 py-3">
            <div className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
              <Badge tone="primary">{t('live')}</Badge>
              <Badge tone="neutral">{t(`types.${h.lawType}`)}</Badge>
              {h.status === 'repealed' && <Badge tone="warning">{t('article.repealed')}</Badge>}
            </div>
            <h3 className="text-body font-semibold">
              <Link
                href={href}
                aria-label={
                  label
                    ? t('hits.openArticle', { label })
                    : t('hits.openLaw', { title: h.lawTitle })
                }
                className="text-primary underline-offset-2 hover:underline focus-visible:focus-ring"
              >
                {label ? (
                  <>
                    <span className="font-mono">{label}</span>
                    {h.articleTitle && <span> — {h.articleTitle}</span>}
                  </>
                ) : (
                  h.lawTitle
                )}
              </Link>
            </h3>
            <p className="text-caption text-fg-subtle">
              {label ? h.lawTitle : `${t('hits.lawLevel')} · ${h.lawNo}`}
            </p>
            {h.snippet && <p className="text-body-sm text-fg-muted">{h.snippet}</p>}
          </li>
        );
      })}
    </ol>
  );
}
