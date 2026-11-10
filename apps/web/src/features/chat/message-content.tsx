'use client';
// Asistan metni (052 §5.1 MessageContent; 053-02 §5.3 streamdown sertleştirmesi): ham HTML ve görsel
// KAPALI (ham HTML eklentisi yok, `skipHtml`, `img` yasak), bağlantı yalnız izinli resmî alan adlarında
// tıklanır, başlıklar h3'e iner, `[K#]` kısa künye çipine döner. Akışta yarım etiket ham kalır.
import type { KunyeStatus } from '@eda/contracts/enums';
import type { SourceItem } from '@eda/contracts/stream';
import { SourceChip } from '@eda/ui';
import { createContext, type ReactNode, useContext } from 'react';
import { type Components, defaultRehypePlugins, Streamdown } from 'streamdown';
import { safeHref } from '../../lib/safe-link.ts';
import {
  CITE_TAG,
  hideToolNames,
  protectPartialCitation,
  refsFromProps,
  rehypeCitations,
} from './citations.ts';
import { rehypePlaceholders } from './documents.ts';
import type { ChipLabel, ChipSourceInfo, CitationReason } from './use-chip-label.ts';

export type CitationContextValue = {
  sources: ReadonlyMap<string, SourceItem>;
  statuses: ReadonlyMap<string, KunyeStatus>;
  /** Durumun nedeni (ör. `quote_mismatch`); etikete yansır, görünüm durumdan gelir. */
  reasons?: ReadonlyMap<string, CitationReason>;
  onActivate?: (ref: string) => void;
  labels: {
    /** Erişilebilir ad: "Kaynak: {künye} ({portal}, erişim {tarih}). Durum: {etiket}." */
    chip: ChipLabel;
    unresolved: string;
    /** Çipte görünen portal + erişim tarihi metni; verilmezse çip yalnız künyeyi gösterir. */
    meta?: (source: ChipSourceInfo) => string;
  };
};

const CitationContext = createContext<CitationContextValue | null>(null);

function CiteChips(props: Record<string, unknown>) {
  const ctx = useContext(CitationContext);
  const refs = refsFromProps(props);
  if (!ctx) return <>{`[${refs.join(', ')}]`}</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {refs.map((ref) => {
        const source = ctx.sources.get(ref);
        if (!source) {
          return <SourceChip key={ref} shortKunye="?" label={ctx.labels.unresolved} />;
        }
        const status = ctx.statuses.get(ref);
        const onActivate = ctx.onActivate;
        const meta = ctx.labels.meta?.(source);
        return (
          <SourceChip
            key={ref}
            shortKunye={source.shortKunye}
            {...(status ? { status } : {})}
            {...(meta ? { meta } : {})}
            label={ctx.labels.chip(source.shortKunye, status, source, ctx.reasons?.get(ref))}
            {...(onActivate ? { onActivate: () => onActivate(ref) } : {})}
          />
        );
      })}
    </span>
  );
}

function SafeLink({ href, children }: { href?: string | undefined; children?: ReactNode }) {
  const safe = safeHref(href);
  if (safe) {
    return (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        className="text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:focus-ring"
      >
        {children}
      </a>
    );
  }
  return <span>{children}</span>;
}

const COMPONENTS: Components = {
  a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
  img: () => null,
  h1: ({ children }) => <h3 className="text-title font-semibold text-fg">{children}</h3>,
  h2: ({ children }) => <h3 className="text-title font-semibold text-fg">{children}</h3>,
  h3: ({ children }) => <h3 className="text-title font-semibold text-fg">{children}</h3>,
  h4: ({ children }) => <h4 className="text-body font-semibold text-fg">{children}</h4>,
  h5: ({ children }) => <h5 className="text-body font-semibold text-fg">{children}</h5>,
  h6: ({ children }) => <h5 className="text-body font-semibold text-fg">{children}</h5>,
  p: ({ children }) => <p>{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-6">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border-strong pl-4 text-fg-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border" />,
  // Yalnız `[[Doldurulacak: ...]]` işaretleri (rehypePlaceholders) `mark` üretir.
  mark: ({ children }) => (
    <mark className="rounded-sm bg-warning-soft px-0.5 text-warning-on-soft">{children}</mark>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md border border-border bg-surface-sunken p-3 font-mono text-code [&_code]:border-0 [&_code]:bg-transparent [&_code]:px-0">
      {children}
    </pre>
  ),
  code: ({ children }) => <code className="font-mono">{children}</code>,
  inlineCode: ({ children }) => (
    <code className="rounded-sm border border-border bg-surface-sunken px-1 font-mono text-code">
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-body-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-sunken">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-border px-3 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-border px-3 py-2 align-top">{children}</td>,
  [CITE_TAG]: CiteChips,
};

/**
 * Kâğıt görünümü (051 §4.9, `.eda-paper`): yazı tipi, boyut ve girinti kâğıt sınıfından gelir;
 * başlıklar gövde boyutunda kalın, paragraf girintili. Sohbet bileşenlerinin boyut sınıfları yoktur.
 */
const PAPER_COMPONENTS: Components = {
  ...COMPONENTS,
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h3>{children}</h3>,
  h4: ({ children }) => <h4>{children}</h4>,
  h5: ({ children }) => <h5>{children}</h5>,
  h6: ({ children }) => <h5>{children}</h5>,
  p: ({ children }) => <p>{children}</p>,
  strong: ({ children }) => <strong>{children}</strong>,
  ul: ({ children }) => <ul>{children}</ul>,
  ol: ({ children }) => <ol>{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
  table: ({ children }) => <table>{children}</table>,
  th: ({ children }) => <th>{children}</th>,
  td: ({ children }) => <td>{children}</td>,
};

const REHYPE_PLUGINS = [
  // Yalnız temizleyici; varsayılan `raw` (ham HTML) ve izin-her-şey `harden` bilerek çıkarıldı.
  ...(defaultRehypePlugins.sanitize ? [defaultRehypePlugins.sanitize] : []),
  rehypeCitations,
  rehypePlaceholders,
];

export function MessageContent({
  text,
  streaming,
  citations,
  variant = 'chat',
}: {
  text: string;
  streaming: boolean;
  citations: CitationContextValue;
  /** `paper`: belge paneli (kâğıt sınıfı tipografiyi verir). */
  variant?: 'chat' | 'paper';
}) {
  const paper = variant === 'paper';
  return (
    <CitationContext.Provider value={citations}>
      <div className={paper ? 'min-w-0' : 'min-w-0 text-prose text-fg'}>
        <Streamdown
          mode={streaming ? 'streaming' : 'static'}
          isAnimating={streaming}
          parseIncompleteMarkdown={streaming}
          skipHtml
          disallowedElements={['img']}
          rehypePlugins={REHYPE_PLUGINS}
          components={paper ? PAPER_COMPONENTS : COMPONENTS}
          controls={false}
          linkSafety={{ enabled: false }}
          lineNumbers={false}
          className={paper ? undefined : 'space-y-3'}
        >
          {streaming ? protectPartialCitation(hideToolNames(text)) : hideToolNames(text)}
        </Streamdown>
      </div>
    </CitationContext.Provider>
  );
}
