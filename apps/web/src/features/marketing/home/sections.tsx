// Ana sayfanın sahne altı bölümleri (sunucu bileşenleri): özellikler, Künye Kilidi zinciri ve dışa
// aktarım kapısı, kaynaklar, kimler için, veri ve güvenlik, ilke, SSS, kapanış. Etkileşimi
// `engine/` modülleri verir (zincir oynatma, kapı anahtarı, tarama çizgisi, görünürlük, imleç ışığı).
import type { IconName } from '@eda/ui';
import type { ReactNode } from 'react';
import { Chip } from './device-mock.tsx';
import { Emph, Ic, PageIc } from './ic.tsx';
import type { Tx } from './text.ts';

type Item = { title: string; body: string };

function Head({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mk-sec-head mk-reveal">
      <p className="mk-eyebrow">{eyebrow}</p>
      <h2 className="mk-h2 mk-pre" id={id}>
        <Emph text={title} />
      </h2>
      {lead ? <p className="mk-lead">{lead}</p> : null}
      {children}
    </div>
  );
}

function CardIcon({ name }: { name: IconName }) {
  return (
    <div className="mk-card-ic">
      <PageIc name={name} />
    </div>
  );
}

function Features({ tx }: { tx: Tx }) {
  const items = tx.a<Item>('features.items');
  const icons: IconName[] = ['control.check', 'status.secure', 'nav.calendar', 'nav.documents'];
  return (
    <section className="mk-sec mk-features" aria-labelledby="f-title">
      <div className="mk-wrap">
        <Head id="f-title" eyebrow={tx.s('features.eyebrow')} title={tx.s('features.title')} />
        <div className="mk-bento">
          {items.map((it, i) => (
            <article key={it.title} className="mk-card mk-glow mk-reveal">
              <CardIcon name={icons[i] ?? 'control.check'} />
              <h3>{it.title}</h3>
              <p>{it.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Wire() {
  return (
    <div className="mk-wire run" aria-hidden="true">
      <i />
    </div>
  );
}

function Kunye({ tx }: { tx: Tx }) {
  const items = tx.a<Item>('kunye.items');
  return (
    <section className="mk-sec mk-kunye" id="kunye-kilidi" aria-labelledby="k-title">
      <div className="mk-wrap">
        <Head
          id="k-title"
          eyebrow={tx.s('kunye.eyebrow')}
          title={tx.s('kunye.title')}
          lead={tx.s('kunye.lead')}
        />

        <figure className="mk-chain mk-reveal" aria-label={tx.s('kunye.chain.label')}>
          <div className="mk-chain-top">
            <span className="mk-chain-tag">{tx.s('kunye.chain.tag')}</span>
            <button className="mk-chain-replay" type="button">
              {tx.s('kunye.chain.replay')}
            </button>
          </div>
          <div className="mk-chain-row">
            <div className="mk-node n1 lit">
              <p className="mk-node-k">{tx.s('kunye.chain.n1.k')}</p>
              <div className="mk-node-vis">
                <span className="mk-big-k">[K1]</span>
              </div>
              <p className="mk-node-b">{tx.s('kunye.chain.n1.b')}</p>
            </div>
            <Wire />
            <div className="mk-node n2 lit">
              <p className="mk-node-k">{tx.s('kunye.chain.n2.k')}</p>
              <div className="mk-node-vis">
                <div className="eda-ui mini-src">
                  <div className="c-src">
                    <div className="c-src-top">
                      <svg className="c-kind" viewBox="0 0 20 20" aria-hidden="true">
                        <rect className="f" x=".5" y=".5" width="19" height="19" rx="5" />
                        <rect className="s" x=".5" y=".5" width="19" height="19" rx="5" />
                        <text x="10" y="10.5" textAnchor="middle" dominantBaseline="central">
                          Y
                        </text>
                      </svg>
                      <Chip
                        status="none"
                        label={tx.s('kunye.chain.n2.chip')}
                        typed={tx.s('kunye.chain.n2.chip')}
                      />
                    </div>
                    <p className="kn" data-t={tx.s('kunye.chain.n2.kn')}>
                      {tx.s('kunye.chain.n2.kn')}
                    </p>
                    <p className="mt" data-t={tx.s('kunye.chain.n2.meta')}>
                      {tx.s('kunye.chain.n2.meta')}
                    </p>
                  </div>
                </div>
              </div>
              <p className="mk-node-b">{tx.s('kunye.chain.n2.b')}</p>
            </div>
            <Wire />
            <div className="mk-node n3 lit">
              <p className="mk-node-k">{tx.s('kunye.chain.n3.k')}</p>
              <div className="mk-node-vis">
                <div className="stamp eda-ui ok">
                  <Chip
                    status="verified"
                    label={tx.s('kunye.chain.n3.chip')}
                    meta={tx.s('kunye.chain.n3.chipMeta').replace(/^·\s*/, '')}
                  />
                  <p className="stamp-l">
                    <span className="stamp-wait">{tx.s('kunye.chain.n3.wait')}</span>
                    <span className="stamp-ok">{tx.s('kunye.chain.n3.ok')}</span>
                  </p>
                </div>
              </div>
              <p className="mk-node-b">{tx.s('kunye.chain.n3.b')}</p>
            </div>
          </div>
          <p className="mk-chain-foot">
            <PageIc name="control.locked" />
            {tx.s('kunye.chain.foot')}
          </p>
        </figure>

        <div className="mk-kunye-grid">
          <div className="mk-kunye-items">
            {items.map((it) => (
              <article key={it.title} className="mk-kitem mk-reveal">
                <h3>{it.title}</h3>
                <p>{it.body}</p>
              </article>
            ))}
          </div>

          <div className="mk-gate mk-card mk-glow mk-reveal" data-state="pending">
            <p className="mk-gd-tag">{tx.s('kunye.gate.tag')}</p>
            <div className="mk-gd-rows eda-ui">
              <div className="mk-gd-row">
                <Chip status="verified" label={tx.s('kunye.gate.k1.chip')} />
                <span className="mk-gd-st ok">{tx.s('kunye.gate.k1.st')}</span>
              </div>
              <div className="mk-gd-row k2">
                <Chip status="pending" label={tx.s('kunye.gate.k2.chip')} />
                <span className="mk-gd-st wait">{tx.s('kunye.gate.k2.wait')}</span>
                <span className="mk-gd-st ok alt">{tx.s('kunye.gate.k2.ok')}</span>
              </div>
            </div>
            <div className="mk-gd-export eda-ui">
              <span className="e-btn outline mk-gd-btn">
                <Ic name="action.export" />
                <span>{tx.s('kunye.gate.export')}</span>
              </span>
              <p className="mk-gd-msg wait" role="status">
                {tx.s('kunye.gate.msgWait')}
              </p>
              <p className="mk-gd-msg ok" role="status">
                {tx.s('kunye.gate.msgOk')}
              </p>
            </div>
            <label className="mk-switch">
              <input type="checkbox" className="mk-gd-toggle" />
              <span className="mk-sw" aria-hidden="true" />
              <span>{tx.s('kunye.gate.switch')}</span>
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}

function Sources({ tx }: { tx: Tx }) {
  const items = tx.a<{ k: string; b: string }>('sources.items');
  return (
    <section className="mk-sec mk-sources" id="kaynaklar" aria-labelledby="s-title">
      <div className="mk-wrap mk-sources-in">
        <Head
          id="s-title"
          eyebrow={tx.s('sources.eyebrow')}
          title={tx.s('sources.title')}
          lead={tx.s('sources.lead')}
        >
          <p className="mk-aside-note">{tx.s('sources.aside')}</p>
        </Head>
        <ul className="mk-src-grid mk-reveal">
          {items.map((s) => (
            <li key={s.b} className="mk-src mk-glow">
              <span className="mk-src-k">
                {s.k}
                <span className="scanned">{tx.s('sources.scanned')}</span>
              </span>
              <b>{s.b}</b>
              <span className="mk-src-scan" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Audience({ tx }: { tx: Tx }) {
  const items = tx.a<{ k: string; title: string; body: string }>('audience.items');
  return (
    <section className="mk-sec mk-audience" id="kimler" aria-labelledby="a-title">
      <div className="mk-wrap">
        <Head id="a-title" eyebrow={tx.s('audience.eyebrow')} title={tx.s('audience.title')} />
        <div className="mk-aud-grid">
          {items.map((it) => (
            <article key={it.title} className="mk-card mk-glow mk-reveal">
              <p className="mk-aud-k">{it.k}</p>
              <h3>{it.title}</h3>
              <p>{it.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Security({ tx }: { tx: Tx }) {
  const flow = tx.a<{ k: string; v: string }>('security.flow');
  const items = tx.a<Item>('security.items');
  const icons: IconName[] = ['status.secure', 'security.gate', 'provider.region'];
  return (
    <section className="mk-sec mk-security" id="guvenlik" aria-labelledby="g-title">
      <div className="mk-wrap">
        <Head
          id="g-title"
          eyebrow={tx.s('security.eyebrow')}
          title={tx.s('security.title')}
          lead={tx.s('security.lead')}
        />
        <figure className="mk-flow mk-reveal" aria-label={tx.s('security.flowLabel')}>
          <div className="mk-flow-track" aria-hidden="true">
            <i className="mk-flow-light" />
          </div>
          {flow.map((f, i) => (
            <div key={f.k} className="mk-fnode">
              <span className="mk-fn-k">{f.k}</span>
              {i === 0 ? <span className="mk-token raw">{f.v}</span> : null}
              {i === 1 ? <span className="mk-token masked">{f.v}</span> : null}
              {i === 2 ? (
                <span className="mk-token gate-t">
                  <PageIc name="security.gate" /> {f.v}
                </span>
              ) : null}
              {i === 3 ? (
                <span className="mk-token loc">
                  <PageIc name="provider.region" /> {f.v}
                </span>
              ) : null}
            </div>
          ))}
        </figure>
        <div className="mk-sec-grid3">
          {items.map((it, i) => (
            <article key={it.title} className="mk-card mk-glow mk-reveal">
              <CardIcon name={icons[i] ?? 'status.secure'} />
              <h3>{it.title}</h3>
              <p>{it.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Principle({ tx }: { tx: Tx }) {
  return (
    <section className="mk-sec mk-principle" aria-labelledby="p-title">
      <div className="mk-wrap mk-principle-in mk-reveal">
        <p className="mk-eyebrow">{tx.s('principle.eyebrow')}</p>
        <h2 className="mk-principle-title mk-pre" id="p-title">
          <Emph text={tx.s('principle.title')} />
        </h2>
        <p className="mk-lead">{tx.s('principle.lead')}</p>
      </div>
    </section>
  );
}

function Faq({ tx }: { tx: Tx }) {
  const items = tx.a<{ q: string; a: string }>('faq.items');
  return (
    <section className="mk-sec mk-faq" id="sss" aria-labelledby="q-title">
      <div className="mk-wrap mk-faq-in">
        <Head id="q-title" eyebrow={tx.s('faq.eyebrow')} title={tx.s('faq.title')} />
        <div className="mk-faq-list mk-reveal">
          {items.map((it) => (
            <details key={it.q}>
              <summary>
                {it.q}
                <span className="mk-pm" aria-hidden="true" />
              </summary>
              <p>{it.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing({ tx, appUrl }: { tx: Tx; appUrl: string }) {
  return (
    <section className="mk-sec mk-closing" aria-labelledby="c-title">
      <div className="mk-wrap">
        <div className="mk-closing-card mk-reveal">
          <div className="mk-closing-light" aria-hidden="true" />
          <p className="mk-eyebrow">{tx.s('closing.eyebrow')}</p>
          <h2 className="mk-closing-title mk-pre" id="c-title">
            <Emph text={tx.s('closing.title')} />
          </h2>
          <p className="mk-lead">{tx.s('closing.lead')}</p>
          <div className="mk-hero-actions">
            <a className="mk-btn mk-btn-gold mk-magnetic" href={`${appUrl}/giris`}>
              <span>{tx.s('hero.signIn')}</span>
              <PageIc name="action.forward" />
            </a>
            <a className="mk-btn mk-btn-ghost mk-magnetic" href={`${appUrl}/kayit`}>
              <span>{tx.s('hero.signUp')}</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Sections({ tx, appUrl }: { tx: Tx; appUrl: string }) {
  return (
    <>
      <Features tx={tx} />
      <Kunye tx={tx} />
      <Sources tx={tx} />
      <Audience tx={tx} />
      <Security tx={tx} />
      <Principle tx={tx} />
      <Faq tx={tx} />
      <Closing tx={tx} appUrl={appUrl} />
    </>
  );
}
