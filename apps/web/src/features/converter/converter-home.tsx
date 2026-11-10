'use client';
// Dönüştürücü (UYAP .udf <-> Word .docx, ikisi de -> PDF). Tüm işlem tarayıcıdadır: dosya sunucuya
// gönderilmez, günlüğe/izlemeye girmez. Okuyucular `udf-codec.ts` ve `docx-reader.ts`; yazıcılar
// `udf-codec.ts` ve `studio/docx-writer.ts`; PDF, yazdırma iletişim kutusundan "PDF olarak kaydet".
import { Badge, Button, Card, NoticeBanner, PageContainer, PageHeader } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useCssVar } from '../../lib/use-css-var.ts';
import { fileSlug, printPdf } from '../chat/document-export.ts';
import type { Block, Run } from '../studio/doc-convert.ts';
import { downloadDocx } from '../studio/docx-writer.ts';
import { blocksToHtml } from './blocks-html.ts';
import { readDocx } from './docx-reader.ts';
import { buildUdfBytes, type Converted, type ConvertNote, readUdf } from './udf-codec.ts';
import { ZipError, zipNames } from './zip-reader.ts';

const MAX_BYTES = 20 * 1024 * 1024;
const PAPER_PX = 793.7;
const UDF_MIME = 'application/octet-stream';

type Kind = 'udf' | 'docx';
type Loaded = { name: string; kind: Kind; blocks: Block[]; notes: ConvertNote[] };
type Failure = 'unsupportedType' | 'oldDoc' | 'tooLarge' | 'unreadable' | 'empty';

function download(bytes: Uint8Array, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function load(file: File): Promise<Loaded> {
  if (/\.doc$/i.test(file.name)) throw new ConverterError('oldDoc');
  if (!/\.(udf|docx)$/i.test(file.name)) {
    throw new ConverterError('unsupportedType');
  }
  if (file.size > MAX_BYTES) throw new ConverterError('tooLarge');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let names: string[];
  try {
    names = zipNames(bytes);
  } catch {
    throw new ConverterError('unreadable');
  }
  let kind: Kind;
  if (names.includes('content.xml')) kind = 'udf';
  else if (names.includes('word/document.xml')) kind = 'docx';
  else throw new ConverterError('unreadable');
  let result: Converted;
  try {
    result = kind === 'udf' ? await readUdf(bytes) : await readDocx(bytes);
  } catch (err) {
    throw new ConverterError(
      err instanceof ZipError && err.message === 'too-large' ? 'tooLarge' : 'unreadable',
    );
  }
  if (result.blocks.length === 0) throw new ConverterError('empty');
  return { name: file.name, kind, blocks: result.blocks, notes: result.notes };
}

class ConverterError extends Error {
  readonly reason: Failure;
  constructor(reason: Failure) {
    super(reason);
    this.reason = reason;
  }
}

function RunView({ run }: { run: Run }): ReactNode {
  let node: ReactNode = run.text;
  if (run.marks.includes('underline')) node = <u>{node}</u>;
  if (run.marks.includes('italic')) node = <em>{node}</em>;
  if (run.marks.includes('bold')) node = <strong>{node}</strong>;
  return node;
}

const ALIGN_CLASS = {
  left: 'indent-0 text-left',
  center: 'indent-0 text-center',
  right: 'indent-0 text-right',
} as const;

function Preview({ blocks }: { blocks: readonly Block[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.6);
  useCssVar(paper, '--eda-zoom', String(zoom));
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

  const items: ReactNode[] = [];
  let group: { ordered: boolean; rows: Block[] } | null = null;
  const flush = () => {
    if (!group) return;
    const rows = group.rows.map((b, i) => (
      <li key={`${items.length}-${i}`}>
        {b.runs.map((r, j) => (
          <RunView key={`${j}-${r.text}`} run={r} />
        ))}
      </li>
    ));
    items.push(
      group.ordered ? (
        <ol key={`l${items.length}`}>{rows}</ol>
      ) : (
        <ul key={`l${items.length}`}>{rows}</ul>
      ),
    );
    group = null;
  };
  blocks.forEach((b, i) => {
    if (b.kind === 'li') {
      if (group && group.ordered !== b.ordered) flush();
      group ??= { ordered: b.ordered, rows: [] };
      group.rows.push(b);
      return;
    }
    flush();
    const inner =
      b.runs.length === 0 ? ' ' : b.runs.map((r, j) => <RunView key={`${j}-${r.text}`} run={r} />);
    if (b.kind === 'h') items.push(<h3 key={i}>{inner}</h3>);
    else {
      const align =
        b.align === 'center' || b.align === 'right' || b.align === 'left' ? b.align : undefined;
      items.push(
        <p key={i} className={align ? ALIGN_CLASS[align] : undefined}>
          {inner}
        </p>,
      );
    }
  });
  flush();

  return (
    <div ref={wrap} className="min-w-0 rounded-md bg-surface-sunken p-3">
      <div ref={paper} className="eda-paper mx-auto" data-theme="light">
        {items}
      </div>
    </div>
  );
}

export function ConverterHome() {
  const t = useTranslations('converter');
  const input = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [done, setDone] = useState<'docx' | 'udf' | 'pdf' | null>(null);

  const open = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFailure(null);
    setDone(null);
    try {
      setLoaded(await load(file));
    } catch (err) {
      setLoaded(null);
      setFailure(err instanceof ConverterError ? err.reason : 'unreadable');
    } finally {
      setBusy(false);
    }
  }, []);

  const base = loaded ? fileSlug(loaded.name.replace(/\.[^.]+$/, '')) : 'belge';
  const reset = () => {
    setLoaded(null);
    setFailure(null);
    setDone(null);
    if (input.current) input.current.value = '';
  };

  const words = loaded
    ? loaded.blocks.reduce(
        (n, b) => n + b.runs.reduce((m, r) => m + r.text.split(/\s+/).filter(Boolean).length, 0),
        0,
      )
    : 0;

  return (
    <PageContainer width="content">
      <PageHeader
        title={t('title')}
        description={t('intro')}
        actions={
          <Badge tone="success" icon="status.verified" size="md">
            {t('local')}
          </Badge>
        }
      />
      <input
        ref={input}
        type="file"
        accept=".udf,.docx"
        className="sr-only"
        aria-label={t('drop.choose')}
        tabIndex={-1}
        onChange={(e) => void open(e.target.files?.[0])}
      />
      {failure && (
        <NoticeBanner tone="danger" role="alert">
          {t(`error.${failure}`)}
        </NoticeBanner>
      )}
      {!loaded && (
        <Card
          className={`flex flex-col items-center gap-3 border-dashed px-6 py-12 text-center ${over ? 'bg-primary-soft' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void open(e.dataTransfer.files[0]);
          }}
        >
          <h2 className="text-title text-fg">{t('drop.title')}</h2>
          <p className="max-w-prose text-body-sm text-fg-muted">{t('drop.hint')}</p>
          <Button
            leadingIcon="action.attach"
            loading={busy}
            loadingLabel={t('reading')}
            onClick={() => input.current?.click()}
          >
            {t('drop.choose')}
          </Button>
          <ul className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-1 text-caption text-fg-subtle">
            <li>{t('routes.udfWord')}</li>
            <li>{t('routes.udfPdf')}</li>
            <li>{t('routes.wordUdf')}</li>
            <li>{t('routes.wordPdf')}</li>
          </ul>
        </Card>
      )}
      {loaded && (
        <div className="grid gap-6 lg:grid-cols-main-panel">
          <Preview blocks={loaded.blocks} />
          <aside className="flex flex-col gap-4">
            <Card className="flex flex-col gap-3 p-5">
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-fg">{loaded.name}</p>
                <p className="text-caption text-fg-subtle">
                  {t(`kind.${loaded.kind}`)} ·{' '}
                  {t('stats', { paragraphs: loaded.blocks.length, words })}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {loaded.kind === 'udf' ? (
                  <Button
                    leadingIcon="action.export"
                    onClick={() => {
                      downloadDocx('', loaded.blocks, base);
                      setDone('docx');
                    }}
                  >
                    {t('to.docx')}
                  </Button>
                ) : (
                  <Button
                    leadingIcon="action.export"
                    onClick={() => {
                      download(buildUdfBytes('', loaded.blocks), `${base}.udf`, UDF_MIME);
                      setDone('udf');
                    }}
                  >
                    {t('to.udf')}
                  </Button>
                )}
                <Button
                  variant="outline"
                  leadingIcon="action.export"
                  onClick={() => {
                    printPdf(base, blocksToHtml(loaded.blocks));
                    setDone('pdf');
                  }}
                >
                  {t('to.pdf')}
                </Button>
                <Button variant="ghost" onClick={reset}>
                  {t('another')}
                </Button>
              </div>
              {done === 'pdf' && <p className="text-caption text-fg-muted">{t('pdfHint')}</p>}
            </Card>
            {loaded.kind === 'docx' && (
              <NoticeBanner tone="warning" role="note" title={t('udfUnverifiedTitle')}>
                {t('udfUnverified')}
              </NoticeBanner>
            )}
            {loaded.notes.length > 0 && (
              <NoticeBanner tone="info" role="note" title={t('notesTitle')}>
                <ul className="list-disc pl-5">
                  {loaded.notes.map((n) => (
                    <li key={n}>{t(`notes.${n}`)}</li>
                  ))}
                </ul>
              </NoticeBanner>
            )}
          </aside>
        </div>
      )}
    </PageContainer>
  );
}
