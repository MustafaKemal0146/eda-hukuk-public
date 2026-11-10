// Sahne: ilk ekran (başlık, giriş, düğmeler), ürün maketi ve kaydırmayla ilerleyen anlatı bölümleri.
// Sunucuda çizilir; sabitleme, ölçekleme ve sahne geçişlerini `engine/stage.ts` yapar (yalnız hareket
// azaltılmamış ve betik açıkken). Aksi hâlde aynı işaretleme statik düzende akar.
import type { ReactNode } from 'react';
import { DeviceMock } from './device-mock.tsx';
import { Emph, PageIc } from './ic.tsx';
import type { Tx } from './text.ts';

type Step = { title: string; body: string };

function Chapter({
  index,
  id,
  eyebrow,
  title,
  children,
}: {
  index: number;
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="mk-chapter" data-ch={index} id={id}>
      <p className="mk-eyebrow">{eyebrow}</p>
      <h2 className="mk-h2">
        <Emph text={title} />
      </h2>
      {children}
    </article>
  );
}

function Ticks({ items }: { items: readonly string[] }) {
  return (
    <ul className="mk-ticks">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

export function Stage({ tx, appUrl, host }: { tx: Tx; appUrl: string; host: string }) {
  const steps = tx.a<Step>('stage.how.steps');
  const progress = tx.a<string>('stage.progress');
  return (
    <section className="mk-theatre" id="urun" aria-label={tx.s('stage.label')}>
      <div className="mk-theatre-sticky">
        <div className="mk-grid-bg" aria-hidden="true">
          <div className="mk-grid-glow" />
        </div>
        <div className="mk-warm-light" aria-hidden="true" />
        <div className="mk-hero-copy">
          <p className="mk-eyebrow">{tx.s('hero.eyebrow')}</p>
          <h1 className="mk-hero-title">
            <Emph text={tx.s('hero.title')} />
          </h1>
          <p className="mk-hero-intro">{tx.s('hero.intro')}</p>
          <div className="mk-hero-row">
            <div className="mk-hero-actions">
              <a className="mk-btn mk-btn-gold mk-magnetic" href={`${appUrl}/giris`}>
                <span>{tx.s('hero.signIn')}</span>
                <PageIc name="action.forward" />
              </a>
              <a className="mk-btn mk-btn-ghost mk-magnetic" href={`${appUrl}/kayit`}>
                <span>{tx.s('hero.signUp')}</span>
              </a>
            </div>
            <p className="mk-hero-note">{tx.s('hero.note')}</p>
          </div>
        </div>

        <div className="mk-device-wrap">
          <div className="mk-device-tilt" role="img" aria-label={tx.s('stage.deviceLabel')}>
            <DeviceMock tx={tx} host={host} />
          </div>
          <button className="mk-replay" type="button" aria-label={tx.s('stage.replayLabel')}>
            <PageIc name="action.forward" />
            {tx.s('stage.replay')}
          </button>
        </div>

        <div className="mk-story">
          <Chapter
            index={0}
            id="nasil-calisir"
            eyebrow={tx.s('stage.how.eyebrow')}
            title={tx.s('stage.how.title')}
          >
            <ol className="mk-steps">
              {steps.map((s, i) => (
                <li key={s.title} className={`mk-step${i === 0 ? ' is-on' : ''}`}>
                  <span className="mk-step-n">{i + 1}</span>
                  <div>
                    <b>{s.title}</b>
                    <p className="mk-step-body">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Chapter>
          <Chapter
            index={1}
            id="dilekce-studyosu"
            eyebrow={tx.s('stage.studio.eyebrow')}
            title={tx.s('stage.studio.title')}
          >
            <p className="mk-lead">{tx.s('stage.studio.lead')}</p>
            <Ticks items={tx.a<string>('stage.studio.ticks')} />
          </Chapter>
          <Chapter
            index={2}
            id="sureler"
            eyebrow={tx.s('stage.deadlines.eyebrow')}
            title={tx.s('stage.deadlines.title')}
          >
            <p className="mk-lead">{tx.s('stage.deadlines.lead')}</p>
            <Ticks items={tx.a<string>('stage.deadlines.ticks')} />
          </Chapter>
        </div>

        <div className="mk-story-progress" aria-hidden="true">
          {progress.map((label, i) => (
            <span key={label} data-p={i} className={i === 0 ? 'on' : undefined}>
              {label}
            </span>
          ))}
        </div>
        <div className="mk-scroll-hint" aria-hidden="true">
          <span />
          {tx.s('stage.scrollHint')}
        </div>
      </div>
    </section>
  );
}
