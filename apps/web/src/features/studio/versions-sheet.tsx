'use client';
// Sürümler (053-03 §7; 054 §8): liste, adlandır/kaydet, geri yükle (AlertDialog) ve taslakla fark.
// Otomatik kayıt sürüm oluşturmaz; `session_end` ve elle kayıt sürüm açar.
import type { DocumentVersionDtoValue } from '@eda/contracts/api/documents';
import type { VersionDiffResponseDto } from '@eda/contracts/document-io';
import { AlertDialog, Button, EmptyState, Field, Input, Sheet, Skeleton } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { documentsApi } from './documents-api.ts';

const DATE = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Istanbul',
});

type Section = { content?: unknown[] };

/** Düğüm ağacından düz metin (fark görünümü yalnız okunur). */
function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === 'string') return n.text;
  const inner = (n.content ?? []).map(textOf);
  return n.type === 'paragraph' || n.type === 'heading' ? `${inner.join('')}\n` : inner.join('');
}

export function VersionsSheet({
  open,
  onOpenChange,
  documentId,
  disabled,
  beforeCreate,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  disabled: boolean;
  /** Sürüm kaydından önce bekleyen taslağın sunucuya yazılması. */
  beforeCreate: () => Promise<void>;
  onRestored: () => void;
}) {
  const t = useTranslations('studio.versions');
  const tr = useTranslations('studio.roles');
  const [items, setItems] = useState<DocumentVersionDtoValue[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ no: number; data: VersionDiffResponseDto } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await documentsApi.documents.listVersions(documentId, { limit: 50 });
      setItems(r.items);
      setError(false);
    } catch {
      setError(true);
    }
  }, [documentId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      await beforeCreate();
      await documentsApi.documents.createVersion(
        documentId,
        name.trim() ? { name: name.trim() } : {},
      );
      setName('');
      setNotice(t('saved'));
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function compare(v: DocumentVersionDtoValue) {
    try {
      await beforeCreate();
      const data = await documentsApi.documents.diff(documentId, { from: v.id, to: 'draft' });
      setDiff({ no: v.versionNo, data });
    } catch {
      setError(true);
    }
  }

  async function restore() {
    const id = restoreId;
    setRestoreId(null);
    if (!id) return;
    setBusy(true);
    try {
      await beforeCreate();
      await documentsApi.documents.restoreVersion(documentId, id);
      setNotice(t('restoreDone'));
      onRestored();
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('note')}
      labels={{ close: t('title') }}
    >
      <div className="flex flex-col gap-4 p-3">
        <div className="flex flex-col gap-2">
          <Field label={t('nameLabel')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Button
            type="button"
            size="sm"
            loading={busy}
            disabled={disabled}
            onClick={() => void save()}
          >
            {t('save')}
          </Button>
          {notice && (
            <p role="status" className="text-body-sm text-fg-muted">
              {notice}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-body-sm text-danger">
            {t('empty')}
          </p>
        )}
        {items === null && !error && <Skeleton className="h-16 w-full" />}
        {items?.length === 0 && <EmptyState icon="nav.documents" title={t('empty')} />}
        <ul className="flex flex-col gap-2">
          {items?.map((v) => (
            <li key={v.id} className="rounded-md border border-border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-body-sm font-medium text-fg">
                  {v.name ?? t('versionNo', { no: v.versionNo })}
                </span>
                <span className="text-caption text-fg-subtle tabular-nums">
                  {DATE.format(new Date(v.createdAt))}
                </span>
              </div>
              <p className="text-caption text-fg-muted">
                {t('versionNo', { no: v.versionNo })} · {t('sourceLabel')}:{' '}
                {t(`sources.${v.source}`)}
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void compare(v)}>
                  {t('compare')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => setRestoreId(v.id)}
                >
                  {t('restore')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {diff && (
          <section
            aria-label={t('compare')}
            className="flex flex-col gap-2 border-t border-border pt-3"
          >
            <h3 className="text-body-sm font-semibold text-fg">
              {t('versionNo', { no: diff.no })} → {t('title')}
            </h3>
            {diff.data.blocks.length === 0 ? (
              <p className="text-body-sm text-fg-muted">{t('noDiff')}</p>
            ) : (
              diff.data.blocks.map((b) => (
                <article
                  key={`${b.blockId}-${b.change}`}
                  className="rounded-md border border-border p-2"
                >
                  <p className="text-caption font-medium text-fg-muted">
                    {t(b.change)} · {tr(b.role)}
                  </p>
                  {b.before && (
                    <p className="whitespace-pre-line rounded-sm bg-danger-soft p-2 text-body-sm text-danger-on-soft">
                      {textOf(b.before as Section)}
                    </p>
                  )}
                  {b.after && (
                    <p className="mt-1 whitespace-pre-line rounded-sm bg-success-soft p-2 text-body-sm text-success-on-soft">
                      {textOf(b.after as Section)}
                    </p>
                  )}
                </article>
              ))
            )}
          </section>
        )}
      </div>
      <AlertDialog
        open={restoreId !== null}
        onOpenChange={(o) => !o && setRestoreId(null)}
        title={t('restoreTitle')}
        description={t('restoreBody')}
        cancelLabel={t('title')}
        destructiveLabel={t('restore')}
        tone="primary"
        onConfirm={() => void restore()}
      />
    </Sheet>
  );
}
