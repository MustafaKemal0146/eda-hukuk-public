// Ürün maketi: E.D.A. Hukuk arayüzünün (koyu tema) HTML/CSS kopyası. Sunucuda çizilir; hareketi
// `engine/` modülleri verir (sohbet demosu, belge stüdyosu, takvim). Veri örnektir: künye
// numaraları •••• ile gizlidir, kişi ve dosya bilgisi uydurmadır (uydurma künye yok). Maket yardımcı
// teknolojilere kapalıdır (`aria-hidden`); anlamı çevreleyen `role="img"` etiketi verir.
import type { IconName } from '@eda/ui';
import { Fragment, type ReactNode } from 'react';
import { Ic } from './ic.tsx';
import { fill, type Tx } from './text.ts';

type ChipStatus = 'none' | 'pending' | 'verified';

/** Künye çipi (source-chip.tsx + status-maps.ts kopyası). Durum `data-status` ile CSS'ten seçilir. */
export function Chip({
  status,
  label,
  meta,
  k,
  btn,
  typed,
}: {
  status: ChipStatus;
  label: ReactNode;
  meta?: string;
  k?: string;
  btn?: boolean;
  /** Künye Kilidi akışında harf harf yazılan etiket: `data-t` son metni taşır. */
  typed?: string;
}) {
  return (
    <span className={`e-chip${btn ? ' is-btn' : ''}`} data-status={status} data-k={k}>
      <Ic name="citation.no-status" className="st st-none" />
      <Ic name="citation.pending" className="st st-pending spin" />
      <Ic name="citation.verified" className="st st-verified" />
      <span className="cl" data-t={typed}>
        {label}
      </span>
      {meta ? <span className="meta">· {meta}</span> : null}
    </span>
  );
}

function RunOk({ className = '' }: { className?: string }) {
  return (
    <>
      <Ic name="status.loading" className={`ic-run spin ${className}`.trim()} />
      <Ic name="status.verified" className="ic-ok" />
    </>
  );
}

function Composer({ tx, variant }: { tx: Tx; variant: 'home' | 'bottom' }) {
  return (
    <div className={`c-composer c-composer-${variant}`}>
      <div className="c-ta">
        <span className="c-typed" />
        {variant === 'home' ? <span className="c-caret" /> : null}
        <span className="c-ph">{tx.s('mock.chat.placeholder')}</span>
      </div>
      <div className="c-tools">
        <span className="e-ib">
          <Ic name="action.attach" />
        </span>
        <span className="c-scope">
          <Ic name="nav.legislation" />
          <span className="trunc">
            <span className="lbl">{tx.s('mock.chat.scopeLabel')}</span>
            <b>{tx.s('mock.chat.scopeValue')}</b>
          </span>
          <Ic name="control.chevron-down" />
        </span>
        <span className="c-right">
          <span className="e-seg">
            <span className="on">{tx.s('mock.chat.fast')}</span>
            <span>{tx.s('mock.chat.deep')}</span>
          </span>
          <span className="c-send">
            <Ic name="action.send" className="up" />
            <Ic name="action.stop" className="stop" />
          </span>
        </span>
      </div>
    </div>
  );
}

type SourceCard = {
  ref: string;
  kind: string;
  chip: string;
  kn: string;
  meta: string;
  read: boolean;
  quote?: string[];
  short?: string;
};

function KindMark({ kind }: { kind: string }) {
  return (
    <svg className={`c-kind${kind === '§' ? ' law' : ''}`} viewBox="0 0 20 20" aria-hidden="true">
      <rect className="f" x=".5" y=".5" width="19" height="19" rx="5" />
      <rect className="s" x=".5" y=".5" width="19" height="19" rx="5" />
      <text x="10" y="10.5" textAnchor="middle" dominantBaseline="central">
        {kind}
      </text>
    </svg>
  );
}

function SourcesPanel({ tx }: { tx: Tx }) {
  const cards = tx.a<SourceCard>('mock.chat.sources.cards');
  return (
    <aside className="c-sources">
      <div className="c-src-head">
        <div>
          <h2>{tx.s('mock.chat.sources.title')}</h2>
          <p className="c-src-count">{tx.s('mock.chat.sources.none')}</p>
        </div>
        <span className="e-ib s7">
          <Ic name="action.close" />
        </span>
      </div>
      <div className="c-src-body">
        <div className="c-empty">
          <span className="box">
            <Ic name="nav.decisions" />
          </span>
          <h3>{tx.s('mock.chat.sources.emptyTitle')}</h3>
          <p>{tx.s('mock.chat.sources.emptyBody')}</p>
        </div>
        <ul className="c-src-list">
          {cards.map((c) => (
            <li key={c.ref} className="c-src" data-ref={c.ref}>
              <div className="c-src-top">
                <KindMark kind={c.kind} />
                <Chip status="verified" label={c.chip} />
              </div>
              <p className="kn">{c.kn}</p>
              <p className="mt">{c.meta}</p>
              <p className="rd">
                {c.read ? tx.s('mock.chat.sources.read') : tx.s('mock.chat.sources.onlyKunye')}
              </p>
              {c.quote ? (
                <div className="pas">
                  <p>{tx.s('mock.chat.sources.passage')}</p>
                  <blockquote>
                    {c.quote[0]}
                    {'\n\n'}
                    {c.quote[1]}
                    <mark>{c.quote[2]}</mark>
                    {c.quote[3]}
                    {'\n\n'}
                    {c.quote[4]}
                  </blockquote>
                </div>
              ) : null}
              {c.short ? (
                <div className="pas">
                  <blockquote className="short">{c.short}</blockquote>
                </div>
              ) : null}
              {c.kind === 'Y' ? (
                <span className="e-btn outline">{tx.s('mock.chat.sources.preview')}</span>
              ) : null}
              <span className="c-link">
                {tx.s('mock.chat.sources.open')}
                <Ic name="action.external" />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

type PipeRow = { label: string; cap?: string; det?: string };

function ChatScene({ tx }: { tx: Tx }) {
  const rows = tx.a<PipeRow>('mock.chat.rows');
  const starters = tx.a<string>('mock.chat.starters');
  const starterIcons: IconName[] = [
    'nav.documents',
    'nav.decisions',
    'nav.legislation',
    'nav.kunye-check',
  ];
  const pillars = tx.a<{ title: string; body: string }>('mock.chat.pillars');
  return (
    <div className="scene scene-chat">
      <div className="c-home">
        <div className="c-home-in">
          <div className="c-greet">
            <p>{tx.s('mock.chat.greetCap')}</p>
            <h1>{tx.s('mock.chat.greet')}</h1>
          </div>
          <div className="c-start">
            <Composer tx={tx} variant="home" />
            <ul className="c-starters">
              {starters.map((s, i) => (
                <li key={s}>
                  <Ic name={starterIcons[i] ?? 'nav.documents'} />
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <dl className="c-pillars">
            {pillars.map((p) => (
              <div key={p.title}>
                <dt>{p.title}</dt>
                <dd>{p.body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="c-disc">{tx.s('mock.chat.disclaimer')}</p>
      </div>

      <div className="c-conv">
        <div className="c-col">
          <div className="c-thread">
            <div className="c-thread-in">
              <div className="c-user">
                <div className="c-bubble">{tx.s('mock.chat.question')}</div>
                <div className="c-user-act" />
              </div>
              <article className="c-asst">
                <span className="c-av">§</span>
                <div className="c-body">
                  <div className="c-meta">
                    <b>{tx.s('mock.chat.author')}</b>
                    <time>{tx.s('mock.chat.time')}</time>
                    <span className="e-badge">
                      <Ic name="provider.region" />
                      <span className="trunc">{tx.s('mock.chat.badge')}</span>
                    </span>
                  </div>
                  <section className="c-pipe open" data-state="run">
                    <div className="c-pipe-head">
                      <RunOk />
                      <span className="lbl">{tx.s('mock.chat.pipeTitle')}</span>
                      <span className="mt">{tx.s('mock.chat.pipeMeta0')}</span>
                      <Ic name="control.chevron-up" className="chev chev-up" />
                      <Ic name="control.chevron-down" className="chev chev-down" />
                    </div>
                    <ol className="c-pipe-rows">
                      {rows.map((r, i) => (
                        <li key={r.label} className="c-row" data-r={i} data-st="run" hidden>
                          <span className="ico">
                            <RunOk />
                          </span>
                          <div className="rb">
                            <span>{r.label}</span>
                            {r.cap ? (
                              <span className="cap" hidden>
                                {r.cap}
                              </span>
                            ) : null}
                            {r.det ? (
                              <span className="det">
                                <span>{r.det}</span>
                              </span>
                            ) : null}
                          </div>
                          <span className="tm" />
                        </li>
                      ))}
                    </ol>
                  </section>
                  <ul className="c-notes" hidden>
                    <li>{tx.s('mock.chat.note')}</li>
                  </ul>
                  <div className="c-prose" />
                  <div className="c-acts" hidden>
                    <span className="e-btn ghost">
                      <Ic name="nav.decisions" />
                      <span>{tx.s('mock.chat.sourcesAction')}</span>
                    </span>
                    <span className="grp">
                      <span className="e-ib s7">
                        <Ic name="action.copy" />
                      </span>
                      <span className="e-ib s7">
                        <Ic name="action.regenerate" />
                      </span>
                      <span className="e-ib s7">
                        <Ic name="action.export" />
                      </span>
                    </span>
                  </div>
                </div>
              </article>
            </div>
          </div>
          <div className="c-bottom">
            <Composer tx={tx} variant="bottom" />
            <p className="c-disc">{tx.s('mock.chat.disclaimer')}</p>
          </div>
        </div>
        <SourcesPanel tx={tx} />
      </div>
      <div className="c-scrim" />
      <div className="fake-cursor">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 2l13 7.2-6 1.4L7 17z" className="cursor-shape" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

type PaperLine = {
  a?: string;
  h?: string;
  bold?: string;
  pad?: number;
  text?: string;
  parts?: ({ t: string } | { ref: string; full: string })[];
};

function StudioScene({ tx }: { tx: Tx }) {
  const lines = tx.a<PaperLine>('mock.studio.lines');
  const buttons = tx.a<string>('mock.studio.buttons');
  // Hizalama düğmeleri: sola, ortaya, sağa, iki yana (ikinci ve dördüncü çizginin uçları).
  const aligns: readonly [string, number, number, number, number][] = [
    ['left', 2, 9, 2, 7],
    ['center', 4.5, 11.5, 5.5, 10.5],
    ['right', 7, 14, 9, 14],
    ['justify', 2, 14, 2, 14],
  ];
  return (
    <div className="scene scene-studio">
      <header className="s-head">
        <span className="s-back">{tx.s('mock.studio.back')}</span>
        <span className="e-field s-title">
          <span className="trunc">{tx.s('mock.studio.title')}</span>
        </span>
        <span className="s-save">{tx.s('mock.studio.saved')}</span>
        <div className="s-actions">
          <span className="e-select zoom">
            <span className="e-field">
              <span>{tx.s('mock.studio.zoom')}</span>
            </span>
            <Ic name="control.chevrons-up-down" />
          </span>
          {buttons.map((b) => (
            <span key={b} className="e-btn outline">
              {b}
            </span>
          ))}
          <span className="e-btn primary">{tx.s('mock.studio.edit')}</span>
        </div>
      </header>
      <p className="s-notice">{tx.s('mock.studio.notice')}</p>
      <div className="s-tools">
        <span className="e-select w32">
          <span className="e-field">
            <span>{tx.s('mock.studio.style')}</span>
          </span>
          <Ic name="control.chevrons-up-down" />
        </span>
        <span className="s-sep" />
        <span className="s-fb">
          <b>B</b>
        </span>
        <span className="s-fb">
          <i>I</i>
        </span>
        <span className="s-fb">
          <u>U</u>
        </span>
        <span className="s-sep" />
        {aligns.map(([name, a1, a2, b1, b2]) => (
          <span key={name} className={`s-fb${name === 'justify' ? ' on' : ''}`}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <line x1="2" x2="14" y1="3" y2="3" />
                <line x1={a1} x2={a2} y1="6.4" y2="6.4" />
                <line x1="2" x2="14" y1="9.8" y2="9.8" />
                <line x1={b1} x2={b2} y1="13.2" y2="13.2" />
              </g>
            </svg>
          </span>
        ))}
        <span className="s-sep" />
        <span className="s-fb">•</span>
        <span className="s-fb">1.</span>
        <span className="s-sep" />
        <span className="s-fb">↶</span>
        <span className="s-fb off">↷</span>
        <span className="s-sep" />
        <span className="e-select w44">
          <span className="e-field">
            <span>{tx.s('mock.studio.font')}</span>
          </span>
          <Ic name="control.chevrons-up-down" />
        </span>
        <span className="e-select w20">
          <span className="e-field">
            <span>{tx.s('mock.studio.size')}</span>
          </span>
          <Ic name="control.chevrons-up-down" />
        </span>
        <span className="e-select w20">
          <span className="e-field">
            <span>{tx.s('mock.studio.spacing')}</span>
          </span>
          <Ic name="control.chevrons-up-down" />
        </span>
        <span className="s-sep" />
        <span className="e-btn ghost">{tx.s('mock.studio.addSection')}</span>
        <span className="e-select w48">
          <span className="e-field">
            <span>{tx.s('mock.studio.comments')}</span>
          </span>
          <Ic name="control.chevrons-up-down" />
        </span>
      </div>
      <div className="s-desk">
        <div className="s-paper-wrap">
          <div className="s-paper eda-paper" data-theme="light">
            {lines.map((l, i) => {
              const key = `${i}-${l.h ?? l.bold ?? l.text ?? ''}`;
              if (l.h) {
                return (
                  <h1 key={key} className="ln">
                    {l.h}
                  </h1>
                );
              }
              return (
                <p key={key} className="ln" data-align={l.a}>
                  {l.bold ? <b>{l.bold}</b> : null}
                  {l.pad ? ' '.repeat(l.pad) : null}
                  {l.parts
                    ? l.parts.map((p) =>
                        'ref' in p ? (
                          <span key={p.ref} className="ref">
                            <span className="k">[{p.ref}]</span>
                            <span className="full">{p.full}</span>
                          </span>
                        ) : (
                          <Fragment key={p.t}>{p.t}</Fragment>
                        ),
                      )
                    : l.text === ''
                      ? ' '
                      : l.text}
                </p>
              );
            })}
          </div>
        </div>
      </div>
      <footer className="s-foot">
        <span className="s-fill">{fill(tx.s('mock.studio.fills'), 0)}</span>
        <span>·</span>
        <span className="s-words">{fill(tx.s('mock.studio.words'), 0)}</span>
        <span>·</span>
        <span>{tx.s('mock.studio.pages')}</span>
        <span className="e-btn ghost">{tx.s('mock.studio.find')}</span>
      </footer>
    </div>
  );
}

type CalEvent = { d: number; kind: string; t: string };

/** Ekim 2026 ay tablosu hücreleri: 1 Ekim Perşembe; önceki/sonraki ay günleri soluk. */
export function calendarCells(): { n: number; out: boolean }[] {
  const cells: { n: number; out: boolean }[] = [];
  for (let p = 28; p <= 30; p++) cells.push({ n: p, out: true });
  for (let d = 1; d <= 31; d++) cells.push({ n: d, out: false });
  for (let x = 1; cells.length < 42; x++) cells.push({ n: x, out: true });
  return cells;
}

const TODAY = 9;

function CalendarScene({ tx }: { tx: Tx }) {
  const events = tx.a<CalEvent>('mock.cal.events');
  const long = tx.a<string>('mock.cal.daysLong');
  const short = tx.a<string>('mock.cal.daysShort');
  const views = tx.a<string>('mock.cal.views');
  const legend = tx.a<{ kind: string; label: string }>('mock.cal.legend');
  const cells = calendarCells();
  const rows = [0, 1, 2, 3, 4, 5];
  return (
    <div className="scene scene-deadline">
      <div className="k-page">
        <header className="k-head">
          <div>
            <p className="ey">{tx.s('mock.cal.eyebrow')}</p>
            <h1>{tx.s('mock.cal.month')}</h1>
          </div>
          <div className="k-ctrl">
            <div className="k-nav">
              <span className="e-ib">
                <Ic name="control.chevron-left" />
              </span>
              <span className="today">{tx.s('mock.cal.today')}</span>
              <span className="e-ib">
                <Ic name="control.chevron-right" />
              </span>
            </div>
            <span className="e-seg">
              {views.map((v, i) => (
                <span key={v} className={i === 0 ? 'on' : undefined}>
                  {v}
                </span>
              ))}
            </span>
            <span className="e-btn primary md">
              <Ic name="action.add" />
              <span>{tx.s('mock.cal.add')}</span>
            </span>
          </div>
        </header>
        <div className="k-grid">
          <div className="k-card k-tablecard">
            <table className="k-table">
              <thead>
                <tr>
                  {long.map((day, i) => (
                    <th key={day}>
                      <span className="lg">{day}</span>
                      <span className="sh">{short[i]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="k-body">
                {rows.map((r) => (
                  <tr key={`w${r}`}>
                    {cells.slice(r * 7, r * 7 + 7).map((cell, c) => {
                      const cls = [
                        cell.out ? 'out' : c >= 5 ? 'we' : '',
                        !cell.out && cell.n === TODAY ? 'today sel' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <td
                          key={`${cell.out ? 'o' : 'm'}${cell.n}`}
                          className={cls || undefined}
                          data-d={cell.out ? undefined : cell.n}
                        >
                          <span className="k-day">{cell.n}</span>
                          <div className="k-evs">
                            {cell.out
                              ? null
                              : events.map((e, i) =>
                                  e.d === cell.n ? (
                                    <span key={e.t} className="k-ev hid" data-e={i}>
                                      <span className={`dot d-${e.kind}`} />
                                      <span>{e.t}</span>
                                    </span>
                                  ) : null,
                                )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="k-side">
            <div className="k-card">
              <p className="cap k-sum-cap">{tx.s('mock.cal.sumCap')}</p>
              <p className="day k-sum-day">{tx.s('mock.cal.sumDay')}</p>
              <p className="empty k-sum-empty">{tx.s('mock.cal.sumEmpty')}</p>
              <ul className="rows k-sum-rows" hidden>
                <li className="k-row">
                  <div>
                    <span className="dot lg d-deadline" />
                    <div>
                      <b>{tx.s('mock.cal.rowTitle')}</b>
                      <p>{tx.s('mock.cal.rowSub')}</p>
                      <p className="nt">{tx.s('mock.cal.rowNote')}</p>
                    </div>
                  </div>
                  <div className="acts">
                    <span className="e-btn ghost">{tx.s('mock.cal.rowDone')}</span>
                    <span className="e-btn ghost">{tx.s('mock.cal.rowEdit')}</span>
                  </div>
                </li>
              </ul>
              <span className="e-btn outline add">
                <Ic name="action.add" />
                <span>{tx.s('mock.cal.addDay')}</span>
              </span>
            </div>
            <div className="k-card">
              <h2>{tx.s('mock.cal.critTitle')}</h2>
              <p className="crit-empty">{tx.s('mock.cal.critEmpty')}</p>
              <ul className="crit" hidden>
                <li>
                  <span>{tx.s('mock.cal.critDate')}</span> {tx.s('mock.cal.critText')}
                </li>
              </ul>
              <p className="note">{tx.s('mock.cal.critNote')}</p>
            </div>
            <div className="k-card">
              <h2>{tx.s('mock.cal.legendTitle')}</h2>
              <ul className="k-legend">
                {legend.map((l) => (
                  <li key={l.label}>
                    <span className={`dot lg d-${l.kind}`} />
                    {l.label}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ tx }: { tx: Tx }) {
  const recent = tx.a<string>('mock.side.recentItems');
  const item = (icon: IconName, label: string, go?: number) => (
    <li className={`e-navi${go === 0 ? ' on' : ''}`} data-go={go}>
      <Ic name={icon} />
      <span>{label}</span>
    </li>
  );
  return (
    <aside className="e-side">
      <div className="e-brand">{tx.s('mock.side.brand')}</div>
      <div className="e-side-top">
        <div className="e-newchat">
          <Ic name="nav.new-chat" />
          <span>{tx.s('mock.side.newChat')}</span>
        </div>
        <div className="e-navi">
          <Ic name="nav.search" />
          <span>{tx.s('mock.side.search')}</span>
          <kbd className="e-kbd">{tx.s('mock.side.kbd')}</kbd>
        </div>
      </div>
      <div className="e-side-scroll">
        <section>
          <h2 className="e-side-h">{tx.s('mock.side.work')}</h2>
          <ul className="e-side-list">
            {item('nav.chat', tx.s('mock.side.chats'), 0)}
            {item('action.regenerate', tx.s('mock.side.converter'))}
          </ul>
        </section>
        <section>
          <h2 className="e-side-h">{tx.s('mock.side.research')}</h2>
          <ul className="e-side-list">
            {item('nav.decisions', tx.s('mock.side.decisions'))}
            {item('nav.legislation', tx.s('mock.side.legislation'))}
          </ul>
        </section>
        <section>
          <h2 className="e-side-h">{tx.s('mock.side.office')}</h2>
          <ul className="e-side-list">
            {item('nav.files', tx.s('mock.side.files'))}
            {item('nav.documents', tx.s('mock.side.documents'), 1)}
            {item('nav.calendar', tx.s('mock.side.calendar'), 2)}
          </ul>
        </section>
        <section>
          <h2 className="e-side-h">{tx.s('mock.side.recent')}</h2>
          <ul className="e-side-list">
            <li className="e-recent new">
              <span>{tx.s('mock.chat.question')}</span>
            </li>
            {recent.map((r) => (
              <li key={r} className="e-recent">
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="e-side-foot">
        <ul className="e-side-list">
          {item('nav.settings', tx.s('mock.side.settings'))}
          {item('nav.support', tx.s('mock.side.support'))}
        </ul>
        <div className="e-account">
          <span className="e-avatar">{tx.s('mock.side.accountInitials')}</span>
          <span className="e-account-txt">
            <b>{tx.s('mock.side.accountName')}</b>
            <span>{tx.s('mock.side.accountMail')}</span>
          </span>
          <Ic name="control.chevron-up" />
        </div>
      </div>
    </aside>
  );
}

/** Tarayıcı penceresi içinde uygulama: üç sahne üst üste yığılır (sohbet, stüdyo, takvim). */
export function DeviceMock({ tx, host }: { tx: Tx; host: string }) {
  return (
    <div className="device" data-scene="0" aria-hidden="true">
      <div className="chrome">
        <div className="dots">
          <span />
          <span />
          <span />
        </div>
        <div className="chrome-url">
          <Ic name="control.locked" />
          <b>{host}</b>
          <span className="chrome-path">/sohbet</span>
        </div>
      </div>
      <div className="eda">
        <Sidebar tx={tx} />
        <div className="e-mainwrap">
          <div className="e-card">
            <header className="e-topbar">
              <span className="e-ib menu">
                <Ic name="nav.menu" />
              </span>
              <nav className="e-crumb">
                <ol>
                  <li className="sub">{tx.s('mock.top.workspace')}</li>
                  <li className="sub">/</li>
                  <li className="cur" data-c="0">
                    <Ic name="nav.chat" />
                    <span className="trunc">{tx.s('mock.side.chats')}</span>
                  </li>
                  <li className="cur" data-c="1">
                    <Ic name="nav.documents" />
                    <span className="trunc">{tx.s('mock.side.documents')}</span>
                  </li>
                  <li className="cur" data-c="2">
                    <Ic name="nav.calendar" />
                    <span className="trunc">{tx.s('mock.side.calendar')}</span>
                  </li>
                </ol>
              </nav>
              <div className="e-top-actions">
                <span className="e-ib">
                  <Ic name="theme.dark" />
                </span>
                <span className="e-notif">
                  <span className="e-ib">
                    <Ic name="nav.notifications" />
                  </span>
                  <span className="e-notif-n">1</span>
                </span>
              </div>
            </header>
            <div className="e-main">
              <ChatScene tx={tx} />
              <StudioScene tx={tx} />
              <CalendarScene tx={tx} />
            </div>
          </div>
        </div>
      </div>
      {/* Yanıt akışında üretilen künye çipleri bu şablondan çoğaltılır (simge ham yazılmaz). */}
      <span hidden data-chip-template="">
        <Chip status="none" btn label="" meta=" " />
      </span>
    </div>
  );
}
