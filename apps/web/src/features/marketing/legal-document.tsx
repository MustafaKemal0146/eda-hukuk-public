// Yasal belge çizimi (053-12 §2.3 `LegalDocument`): tek h1, h2 bölümler, içindekiler, kaydırılabilir
// tablolar, taslak bandı. Sunucuda çizilir; betik gerektirmez. Metinler çağırandan gelir.
import type { ReactNode } from 'react';
import type { LegalSection, LegalTable } from './legal-model.ts';

export type LegalDocumentProps = {
  title: string;
  intro: string;
  /** "TASLAK – hukuk onayı bekliyor" bandı. */
  draftNotice: string;
  /** "Sürüm … · Yürürlük …" satırı. */
  versionLine: string;
  tocLabel: string;
  sections: LegalSection[];
  /** Bölüm başlıklarını 1., 2. ... diye numaralandırır. */
  numbered?: boolean;
  tableLabel: (caption: string) => string;
  /** Bölümlerin altına eklenecek ek içerik. */
  footer?: ReactNode;
};

export function LegalTableView({ table, regionLabel }: { table: LegalTable; regionLabel: string }) {
  return (
    // Dar ekranda yatay kaydırma kabı: klavyeyle odaklanabilir, adı vardır (WCAG 1.4.10, 2.1.1).
    <section
      aria-label={regionLabel}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: kaydırılabilir bölge klavyeyle erişilebilir olmalıdır.
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-border focus-visible:focus-ring"
    >
      <table className="w-full border-collapse text-left text-body-sm text-fg">
        <caption className="px-3 py-2 text-left text-caption font-medium text-fg-muted">
          {table.caption}
        </caption>
        <thead className="bg-surface-sunken">
          <tr>
            {table.head.map((h) => (
              <th key={h} scope="col" className="border-b border-border px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.join('|')} className="border-b border-border last:border-b-0">
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={cell} scope="row" className="px-3 py-2 align-top font-medium">
                    {cell}
                  </th>
                ) : (
                  <td key={cell} className="px-3 py-2 align-top text-fg-muted">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function LegalSectionView({
  section,
  index,
  numbered,
  tableLabel,
}: {
  section: LegalSection;
  index: number;
  numbered: boolean;
  tableLabel: (caption: string) => string;
}) {
  const heading = numbered && !section.unnumbered ? `${index}. ${section.title}` : section.title;
  return (
    <section aria-labelledby={`b-${section.id}`} className="flex flex-col gap-3">
      <h2 id={`b-${section.id}`} className="scroll-mt-6 font-display text-heading-lg text-fg">
        {heading}
      </h2>
      {section.paragraphs?.map((p) => (
        <p key={p} className="text-body text-fg-muted">
          {p}
        </p>
      ))}
      {section.list && (
        <ul className="flex list-disc flex-col gap-2 pl-6 text-body text-fg-muted">
          {section.list.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {section.table && (
        <LegalTableView table={section.table} regionLabel={tableLabel(section.table.caption)} />
      )}
      {section.note && <p className="text-body-sm text-fg-subtle">{section.note}</p>}
      {section.links && (
        <ul className="flex flex-col gap-1 text-body-sm">
          {section.links.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="text-primary underline underline-offset-4 focus-visible:focus-ring"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LegalDocument({
  title,
  intro,
  draftNotice,
  versionLine,
  tocLabel,
  sections,
  numbered = true,
  tableLabel,
  footer,
}: LegalDocumentProps) {
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-display text-fg">{title}</h1>
        <p className="text-body text-fg-muted">{intro}</p>
        <p className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-body-sm text-fg">
          {draftNotice}
        </p>
        <p className="text-body-sm text-fg-subtle">{versionLine}</p>
      </header>
      <nav aria-label={tocLabel} className="rounded-lg border border-border p-4">
        <p className="text-label text-fg">{tocLabel}</p>
        <ol className="mt-2 flex flex-col gap-1 text-body-sm">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#b-${s.id}`}
                className="text-primary underline underline-offset-4 focus-visible:focus-ring"
              >
                {numbered && !s.unnumbered ? `${i + 1}. ${s.title}` : s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map((s, i) => (
        <LegalSectionView
          key={s.id}
          section={s}
          index={i + 1}
          numbered={numbered}
          tableLabel={tableLabel}
        />
      ))}
      {footer}
      <p className="border-t border-border pt-4 text-body-sm text-fg-subtle">{versionLine}</p>
    </article>
  );
}
