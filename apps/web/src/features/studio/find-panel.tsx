'use client';
// Bul/değiştir paneli (Ctrl+F): küçük, araç çubuğunun altında; eşleşme sayısı, önceki/sonraki,
// değiştir ve tümünü değiştir. Görsel kısım saf bileşendir (`FindPanel`); editör bağı `useFindReplace`.
import { Button, IconButton, Input } from '@eda/ui';
import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  findMatches,
  nextRangeAfter,
  prevRangeBefore,
  type Range,
  replaceAll,
  replaceRange,
  selectRange,
  setFindHighlight,
} from './find-replace.ts';

export type FindModel = {
  query: string;
  replacement: string;
  matches: readonly Range[];
  /** Geçerli eşleşmenin dizini; yoksa -1. */
  current: number;
};

export type FindActions = {
  setQuery: (q: string) => void;
  setReplacement: (r: string) => void;
  next: () => void;
  prev: () => void;
  replace: () => void;
  replaceAllMatches: () => void;
};

/** Editöre bağlı bul/değiştir durumu. Panel kapalıyken vurgular temizlenir; her işlemde yeniden aranır. */
export function useFindReplace(editor: Editor | null, open: boolean): FindModel & FindActions {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matches, setMatches] = useState<readonly Range[]>([]);
  const [current, setCurrent] = useState(-1);
  const currentRef = useRef(current);
  currentRef.current = current;

  const search = useCallback((e: Editor, q: string, keepIndex: number): void => {
    const found = findMatches(e.state.doc, q);
    const cursor = e.state.selection.from;
    let idx = -1;
    if (found.length > 0) {
      idx = keepIndex >= 0 && keepIndex < found.length ? keepIndex : -1;
      if (idx === -1) {
        const nextMatch = nextRangeAfter(found, cursor - 1);
        idx = nextMatch ? found.indexOf(nextMatch) : 0;
      }
    }
    setMatches(found);
    setCurrent(idx);
    setFindHighlight(e, { ranges: found, current: idx });
  }, []);

  useEffect(() => {
    if (!editor) return;
    if (!open) {
      setFindHighlight(editor, null);
      return;
    }
    search(editor, query, -1);
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) search(editor, query, currentRef.current);
    };
    editor.on('transaction', onTx);
    return () => {
      editor.off('transaction', onTx);
    };
  }, [editor, open, query, search]);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (!editor || matches.length === 0) return;
      const cur = matches[current];
      const cursor = cur ? cur.from : editor.state.selection.from - 1;
      const target = dir === 1 ? nextRangeAfter(matches, cursor) : prevRangeBefore(matches, cursor);
      if (!target) return;
      const idx = matches.indexOf(target);
      setCurrent(idx);
      setFindHighlight(editor, { ranges: matches, current: idx });
      selectRange(editor, target);
    },
    [editor, matches, current],
  );

  const replace = useCallback(() => {
    if (!editor?.isEditable) return;
    const target = matches[current] ?? matches[0];
    if (!target) return;
    replaceRange(editor, target, replacement);
    // Yeniden arama `transaction` dinleyicisinden gelir; imleç değişen yerin sonundadır.
  }, [editor, matches, current, replacement]);

  const replaceAllMatches = useCallback(() => {
    if (!editor?.isEditable) return;
    replaceAll(editor, matches, replacement);
  }, [editor, matches, replacement]);

  return {
    query,
    replacement,
    matches,
    current,
    setQuery,
    setReplacement,
    next: () => go(1),
    prev: () => go(-1),
    replace,
    replaceAllMatches,
  };
}

export function FindPanel({
  model,
  editable,
  onClose,
  inputRef,
}: {
  model: FindModel & FindActions;
  editable: boolean;
  onClose: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const t = useTranslations('studio.find');
  const total = model.matches.length;
  const countText =
    model.query === ''
      ? ''
      : total === 0
        ? t('none')
        : t('count', { current: Math.max(0, model.current) + 1, total });
  return (
    <section
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-sunken px-4 py-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === 'Enter' && e.target === inputRef?.current) {
          e.preventDefault();
          if (e.shiftKey) model.prev();
          else model.next();
        }
      }}
    >
      <Input
        ref={inputRef}
        size="sm"
        type="search"
        aria-label={t('query')}
        placeholder={t('query')}
        value={model.query}
        onChange={(e) => model.setQuery(e.target.value)}
        className="w-56"
      />
      <span role="status" aria-live="polite" className="min-w-16 text-caption text-fg-muted">
        {countText}
      </span>
      <IconButton
        size="sm"
        variant="outline"
        icon="control.chevron-up"
        label={t('prev')}
        disabled={total === 0}
        onClick={model.prev}
      />
      <IconButton
        size="sm"
        variant="outline"
        icon="control.chevron-down"
        label={t('next')}
        disabled={total === 0}
        onClick={model.next}
      />
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      <Input
        size="sm"
        aria-label={t('replacement')}
        placeholder={t('replacement')}
        value={model.replacement}
        onChange={(e) => model.setReplacement(e.target.value)}
        disabled={!editable}
        className="w-56"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!editable || total === 0}
        onClick={model.replace}
      >
        {t('replace')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!editable || total === 0}
        onClick={model.replaceAllMatches}
      >
        {t('replaceAll')}
      </Button>
      <IconButton
        size="sm"
        icon="action.close"
        label={t('close')}
        className="ml-auto"
        onClick={onClose}
      />
    </section>
  );
}
