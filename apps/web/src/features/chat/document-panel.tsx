'use client';
// Belge paneli: sohbetteki belge kartının metni sağda A4 kâğıt görünümünde okunur (Claude "artifact" /
// ChatGPT "canvas" kalıbı). Kâğıt (`.eda-paper`, 051 §4.9) panel genişliğine sığacak şekilde
// yakınlaştırılır; metin akarken canlı güncellenir; Word (.doc) olarak indirilir veya PDF'e yazdırılır.
import { Button, IconButton } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCssVar } from '../../lib/use-css-var.ts';
import { markdownToBlocks, separateLines } from '../studio/doc-convert.ts';
import { downloadDocx } from '../studio/docx-writer.ts';
import { fileSlug, paperHtml, printPdf } from './document-export.ts';
import type { DocumentBlock } from './documents.ts';
import { type CitationContextValue, MessageContent } from './message-content.tsx';

/** 210 mm, CSS px (96 dpi). */
const PAPER_PX = 793.7;

export function DocumentPanel({
  block,
  streaming,
  citations,
  onClose,
  onCopy,
  onOpenStudio,
  onApplyToDocument,
  studioBusy = false,
  studioError = false,
  embedded = false,
}: {
  block: DocumentBlock;
  streaming: boolean;
  citations: CitationContextValue;
  onClose: () => void;
  onCopy: () => void;
  /** Belgeyi kalıcı belge olarak oluşturup stüdyoda açar. */
  onOpenStudio?: () => void;
  /** Stüdyodan başlatılan düzenleme sohbetinde: yanıtı kaynak belgeye yazar. */
  onApplyToDocument?: () => void;
  studioBusy?: boolean;
  studioError?: boolean;
  /** Sheet içinde: başlık ve kapat Sheet'te olduğundan yalnız indirme satırı ve kâğıt çizilir. */
  embedded?: boolean;
}) {
  const t = useTranslations('chat.document');
  const wrap = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.7);
  useCssVar(paper, '--eda-zoom', String(zoom));
  const live = streaming && !block.complete;
  const title = block.title || t('untitled');

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) setZoom(Math.min(1, width / PAPER_PX));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const html = useCallback(() => (paper.current ? paperHtml(paper.current) : ''), []);

  const toolbar = (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        leadingIcon="action.export"
        disabled={live}
        onClick={() => downloadDocx(title, markdownToBlocks(block.body), fileSlug(title))}
      >
        {t('downloadWord')}
      </Button>
      <Button size="sm" variant="outline" disabled={live} onClick={() => printPdf(title, html())}>
        {t('downloadPdf')}
      </Button>
      {onApplyToDocument && (
        <Button
          size="sm"
          variant="primary"
          disabled={live}
          loading={studioBusy}
          loadingLabel={t('openingStudio')}
          onClick={onApplyToDocument}
        >
          {t('applyToDocument')}
        </Button>
      )}
      {onOpenStudio && (
        <Button
          size="sm"
          variant={onApplyToDocument ? 'outline' : 'primary'}
          disabled={live}
          loading={studioBusy}
          loadingLabel={t('openingStudio')}
          onClick={onOpenStudio}
        >
          {t('openStudio')}
        </Button>
      )}
      {studioError && (
        <p role="alert" className="w-full text-caption text-danger">
          {t('studioError')}
        </p>
      )}
    </div>
  );

  const sheet = (
    <div ref={wrap} className="relative min-w-0">
      <div ref={paper} className="eda-paper mx-auto" data-theme="light">
        <h3 className="text-center">{title}</h3>
        <MessageContent
          text={separateLines(block.body)}
          streaming={live}
          citations={citations}
          variant="paper"
        />
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="flex flex-col gap-3">
        {toolbar}
        {sheet}
      </div>
    );
  }
  return (
    <section aria-label={t('panelLabel')} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-title text-fg">{title}</h2>
          <p className="text-caption text-fg-subtle">{live ? t('streaming') : t('draftNote')}</p>
        </div>
        <IconButton icon="action.copy" label={t('copy')} onClick={onCopy} />
        <IconButton icon="action.close" label={t('close')} onClick={onClose} />
      </div>
      <div className="flex shrink-0 border-b border-border px-4 py-2">{toolbar}</div>
      <div className="relative min-h-0 flex-1 overflow-y-auto bg-surface-sunken p-4">{sheet}</div>
    </section>
  );
}
