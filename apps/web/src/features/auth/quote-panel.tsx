'use client';
// Alıntı karuseli (053-01 §11): durdurulabilir, odak/üzerine gelme otomatik ilerlemeyi durdurur,
// azaltılmış harekette otomatik ilerleme yok. Portre yoksa monogram.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { IconButton } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { VISIBLE_QUOTES } from './quotes.ts';

const ROTATE_MS = CONFIG_DEFAULTS['ui.quoteRotateMs'];

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  return (
    parts.length > 1 ? `${parts[0]?.[0]}${parts.at(-1)?.[0]}` : (parts[0]?.slice(0, 2) ?? '')
  ).toLocaleUpperCase('tr-TR');
}

export function QuotePanel() {
  const t = useTranslations('auth.quotes');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hold, setHold] = useState(false);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
  }, []);
  useEffect(() => {
    if (!playing || hold) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % VISIBLE_QUOTES.length),
      ROTATE_MS,
    );
    return () => window.clearInterval(id);
  }, [playing, hold]);
  const quote = VISIBLE_QUOTES[index];
  if (quote === undefined) return null;
  return (
    <section
      data-theme="dark"
      aria-roledescription="carousel"
      aria-label={t('label')}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
      className="relative m-2 hidden flex-col justify-between overflow-hidden rounded-xl bg-bg p-12 text-fg lg:flex xl:p-16"
    >
      {/* Arka plan: ince dikey çizgiler; yalnız süs (aria-hidden). Gradyan yok (051). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={`l${i}`} className="h-full flex-1 border-l border-border" />
        ))}
      </div>
      <p className="relative text-caption text-fg-subtle">{t('eyebrow')}</p>
      <figure
        aria-roledescription="slide"
        aria-live={playing ? 'off' : 'polite'}
        aria-label={t('slide', { current: index + 1, total: VISIBLE_QUOTES.length })}
        className="relative flex max-w-xl flex-col gap-8"
      >
        {/* Büyük tırnak işareti SVG metni: yazı boyutu sunum özniteliğidir; `style=""` nonce'lu CSP'ye takılır. */}
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 112 56"
          className="h-14 w-28 overflow-visible"
        >
          <text x="0" y="90" fontSize="112" className="fill-primary font-display">
            “
          </text>
        </svg>
        <blockquote key={quote.id} className="font-display text-heading-lg text-fg xl:text-display">
          {quote.text}
        </blockquote>
        <figcaption className="flex items-center gap-4">
          {broken.has(quote.id) ? (
            <span className="inline-flex size-12 items-center justify-center rounded-full border border-border bg-surface-raised text-body-sm font-medium text-fg">
              {initials(quote.author)}
            </span>
          ) : (
            <img
              src={quote.portrait}
              alt=""
              width={48}
              height={48}
              loading="lazy"
              onError={() => setBroken((s) => new Set(s).add(quote.id))}
              title={quote.portraitCredit}
              className="size-12 shrink-0 rounded-full border border-border-strong object-cover"
            />
          )}
          <span>
            <span className="block text-body-sm font-medium text-fg">{quote.author}</span>
            <span className="block text-caption text-fg-muted">
              {quote.role} ({quote.years})
            </span>
            <span className="mt-0.5 block text-caption text-fg-subtle">
              {t('source')}: {quote.work}
              {quote.verification === 'paraphrase' && ` · ${t('paraphrase')}`}
            </span>
          </span>
        </figcaption>
      </figure>
      <div className="relative flex items-center gap-4 border-t border-border pt-6">
        <IconButton
          icon={playing ? 'action.pause' : 'action.play'}
          label={playing ? t('pause') : t('play')}
          aria-pressed={!playing}
          size="sm"
          variant="outline"
          onClick={() => setPlaying((p) => !p)}
        />
        <div className="flex gap-2">
          {VISIBLE_QUOTES.map((q, i) => (
            <button
              key={q.id}
              type="button"
              aria-label={t('slide', { current: i + 1, total: VISIBLE_QUOTES.length })}
              aria-current={i === index}
              onClick={() => {
                setIndex(i);
                setPlaying(false);
              }}
              className={`h-1 rounded-full transition-all duration-base focus-visible:focus-ring ${
                i === index ? 'w-8 bg-primary' : 'w-2 bg-border-strong'
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
