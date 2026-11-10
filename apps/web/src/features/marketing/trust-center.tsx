// Güven Merkezi (053-12 §6): TBB tedarikçi soruları, veri yolu, alt işleyenler, önlemler, Y-92.
// Metin `legal.pages.trust` kataloğundadır; sağlayıcı adları yalnız burada ve KVKK aktarım
// tablosunda yer alır (Y-125). Sayfa taslaktır: hukuk onayı bekliyor.
import { LEGAL_VERSIONS } from '@eda/contracts/legal-versions';
import { getTranslations } from 'next-intl/server';
import { LegalTableView } from './legal-document.tsx';
import { fillLegalTable, type LegalTable } from './legal-model.ts';
import { fillConfig } from './placeholders.ts';
import type { Translator } from './translator.ts';
import { TrustDiagram } from './trust-diagram.tsx';

type Pair = { title: string; body: string };
type Question = { id: string; q: string; a: string };
type TrustSection = keyof typeof SECTION_IDS;

const SECTION_IDS = {
  summary: 'ozet',
  questions: 'tedarikci-sorulari',
  path: 'veri-yolu',
  subProcessors: 'alt-isleyenler',
  measures: 'guvenlik-onlemleri',
  access: 'erisim-ve-mesleki-sir',
  retention: 'silme-ve-saklama',
  mapping: 'mesleki-kurallar',
  contact: 'iletisim',
} as const;

const ORDER = Object.keys(SECTION_IDS) as TrustSection[];

export async function TrustCenter() {
  return <TrustCenterView t={await getTranslations('legal')} />;
}

export function TrustCenterView({ t }: { t: Translator }) {
  const p = 'pages.trust';
  const f = (key: string): string => fillConfig(String(t.raw(`${p}.${key}`)));
  const cards = (t.raw(`${p}.cards`) as Pair[]).map((c) => ({
    title: c.title,
    body: fillConfig(c.body),
  }));
  const questions = (t.raw(`${p}.questions`) as Question[]).map((x) => ({
    ...x,
    a: fillConfig(x.a),
  }));
  const measures = (t.raw(`${p}.measures`) as Pair[]).map((m) => ({
    title: m.title,
    body: fillConfig(m.body),
  }));
  const sub = fillLegalTable({
    caption: String(t.raw(`${p}.subProcessors.caption`)),
    head: t.raw(`${p}.subProcessors.head`) as string[],
    rows: t.raw(`${p}.subProcessors.rows`) as string[][],
  });
  const subNotes = t.raw(`${p}.subProcessors.notes`) as string[];
  const retention = fillLegalTable(t.raw(`${p}.retention`) as LegalTable);
  const mapping = fillLegalTable(t.raw(`${p}.mapping`) as LegalTable);
  const region = (caption: string) => t('doc.tableRegion', { caption });
  const h2 = 'scroll-mt-6 font-display text-heading-lg text-fg';
  const link = 'text-primary underline underline-offset-4 focus-visible:focus-ring';
  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-display text-fg">{t(`${p}.title`)}</h1>
        <p className="text-body text-fg-muted">{t(`${p}.intro`)}</p>
        <p className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-body-sm text-fg">
          {t('draftNotice')}
        </p>
        <p className="text-body-sm text-fg-subtle">
          {t('doc.version', {
            version: LEGAL_VERSIONS.privacyPolicyVersion,
            date: '{{YURURLUK_TARIHI}}',
          })}
        </p>
      </header>

      <nav aria-label={t('doc.toc')} className="rounded-lg border border-border p-4">
        <p className="text-label text-fg">{t('doc.toc')}</p>
        <ol className="mt-2 flex flex-col gap-1 text-body-sm">
          {ORDER.map((k) => (
            <li key={k}>
              <a href={`#${SECTION_IDS[k]}`} className={link}>
                {t(`${p}.sections.${k}`)}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section aria-labelledby={SECTION_IDS.summary} className="flex flex-col gap-4">
        <h2 id={SECTION_IDS.summary} className={h2}>
          {t(`${p}.sections.summary`)}
        </h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {cards.map((c) => (
            <li key={c.title} className="rounded-lg border border-border bg-surface p-4">
              <h3 className="text-title text-fg">{c.title}</h3>
              <p className="mt-1 text-body-sm text-fg-muted">{c.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={SECTION_IDS.questions} className="flex flex-col gap-3">
        <h2 id={SECTION_IDS.questions} className={h2}>
          {t(`${p}.sections.questions`)}
        </h2>
        {questions.map((x) => (
          <details
            key={x.id}
            id={x.id}
            className="scroll-mt-6 rounded-lg border border-border bg-surface"
          >
            <summary className="cursor-pointer px-4 py-3 text-title text-fg focus-visible:focus-ring">
              {x.q}
            </summary>
            <p className="border-t border-border px-4 py-3 text-body text-fg-muted">{x.a}</p>
          </details>
        ))}
      </section>

      <section aria-labelledby={SECTION_IDS.path} className="flex flex-col gap-4">
        <h2 id={SECTION_IDS.path} className={h2}>
          {t(`${p}.sections.path`)}
        </h2>
        <TrustDiagram
          labels={{
            title: t(`${p}.diagram.title`),
            user: t(`${p}.diagram.user`),
            server: t(`${p}.diagram.server`),
            gate: t(`${p}.diagram.gate`),
            tls: t(`${p}.diagram.tls`),
            publicProvider: t(`${p}.diagram.publicProvider`),
            euProvider: t(`${p}.diagram.euProvider`),
            off: t(`${p}.diagram.off`),
          }}
        />
        <p className="text-body text-fg-muted">{t(`${p}.pathText`)}</p>
      </section>

      <section aria-labelledby={SECTION_IDS.subProcessors} className="flex flex-col gap-4">
        <h2 id={SECTION_IDS.subProcessors} className={h2}>
          {t(`${p}.sections.subProcessors`)}
        </h2>
        <LegalTableView table={sub} regionLabel={region(sub.caption)} />
        <ul className="flex list-disc flex-col gap-1 pl-6 text-body-sm text-fg-subtle">
          {subNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={SECTION_IDS.measures} className="flex flex-col gap-4">
        <h2 id={SECTION_IDS.measures} className={h2}>
          {t(`${p}.sections.measures`)}
        </h2>
        <dl className="flex flex-col gap-3">
          {measures.map((m) => (
            <div key={m.title} className="rounded-lg border border-border bg-surface p-4">
              <dt className="text-title text-fg">{m.title}</dt>
              <dd className="mt-1 text-body-sm text-fg-muted">{m.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby={SECTION_IDS.access} className="flex flex-col gap-3">
        <h2 id={SECTION_IDS.access} className={h2}>
          {t(`${p}.sections.access`)}
        </h2>
        <p className="text-body text-fg">{t('mandatory.y92')}</p>
        {(t.raw(`${p}.access.paragraphs`) as string[]).map((x) => (
          <p key={x} className="text-body text-fg-muted">
            {x}
          </p>
        ))}
      </section>

      <section aria-labelledby={SECTION_IDS.retention} className="flex flex-col gap-3">
        <h2 id={SECTION_IDS.retention} className={h2}>
          {t(`${p}.sections.retention`)}
        </h2>
        <LegalTableView table={retention} regionLabel={region(retention.caption)} />
        <p className="text-body-sm text-fg-subtle">{f('retention.note')}</p>
      </section>

      <section aria-labelledby={SECTION_IDS.mapping} className="flex flex-col gap-3">
        <h2 id={SECTION_IDS.mapping} className={h2}>
          {t(`${p}.sections.mapping`)}
        </h2>
        <LegalTableView table={mapping} regionLabel={region(mapping.caption)} />
        <p className="text-body-sm text-fg-subtle">{f('mapping.note')}</p>
      </section>

      <section aria-labelledby={SECTION_IDS.contact} className="flex flex-col gap-3">
        <h2 id={SECTION_IDS.contact} className={h2}>
          {t(`${p}.sections.contact`)}
        </h2>
        <p className="text-body text-fg-muted">{f('contact.body')}</p>
        <ul className="flex flex-col gap-1 text-body-sm">
          <li>
            <a href="/kullanim-kosullari#veri-isleme-sozlesmesi" className={link}>
              {t(`${p}.contact.dpaLink`)}
            </a>
          </li>
          <li>
            <a href="/kvkk-aydinlatma" className={link}>
              {t(`${p}.contact.kvkkLink`)}
            </a>
          </li>
        </ul>
        <p className="text-body-sm text-fg-subtle">{f('contact.updated')}</p>
      </section>
    </article>
  );
}
