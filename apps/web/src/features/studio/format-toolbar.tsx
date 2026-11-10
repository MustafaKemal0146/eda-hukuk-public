'use client';
// Biçimlendirme araç çubuğu (Word benzeri): paragraf/başlık stili, kalın/italik/altı çizili, hizalama,
// listeler, geri al/yinele. Düğmeler seçimdeki durumu gösterir (`aria-pressed`). Hizalama paragraf ve
// başlıkların `align` özniteliğini yazar; iki yana yaslı ve rol varsayılanı paragraf başı girintilidir,
// sola/ortaya/sağa hizalı paragraf girintisizdir (paper.css; DOCX yazıcı aynı kuralı izler).
import { Select } from '@eda/ui';
import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export type BlockStyle = 'paragraph' | 'h1' | 'h2';
export type Align = 'left' | 'center' | 'right' | 'justify' | null;

export type FormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  bulletList: boolean;
  orderedList: boolean;
  style: BlockStyle;
  align: Align;
  canUndo: boolean;
  canRedo: boolean;
};

export const EMPTY_FORMAT: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  bulletList: false,
  orderedList: false,
  style: 'paragraph',
  align: null,
  canUndo: false,
  canRedo: false,
};

export function formatStateOf(editor: Editor): FormatState {
  const heading = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : 'paragraph';
  const attrs = editor.getAttributes(heading === 'paragraph' ? 'paragraph' : 'heading');
  const a = attrs.align;
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    style: heading,
    align: a === 'left' || a === 'center' || a === 'right' || a === 'justify' ? a : null,
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

export function sameFormat(a: FormatState, b: FormatState): boolean {
  return (Object.keys(a) as (keyof FormatState)[]).every((k) => a[k] === b[k]);
}

function setAlign(editor: Editor, align: Exclude<Align, null>): void {
  editor
    .chain()
    .focus()
    .updateAttributes('paragraph', { align })
    .updateAttributes('heading', { align })
    .run();
}

function setStyle(editor: Editor, style: BlockStyle): void {
  const chain = editor.chain().focus();
  if (style === 'paragraph') chain.setParagraph().run();
  else chain.setHeading({ level: style === 'h1' ? 1 : 2 }).run();
}

/** Hizalama simgesi: dört çizgi, uzunlukları hizaya göre. */
function AlignIcon({ align }: { align: Exclude<Align, null> }) {
  const lines: [number, number][] =
    align === 'left'
      ? [
          [2, 14],
          [2, 9],
          [2, 14],
          [2, 7],
        ]
      : align === 'right'
        ? [
            [2, 14],
            [7, 14],
            [2, 14],
            [9, 14],
          ]
        : align === 'center'
          ? [
              [2, 14],
              [4.5, 11.5],
              [2, 14],
              [5.5, 10.5],
            ]
          : [
              [2, 14],
              [2, 14],
              [2, 14],
              [2, 14],
            ];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {lines.map(([x1, x2], i) => (
        <line
          key={i}
          x1={x1}
          x2={x2}
          y1={3 + i * 3.4}
          y2={3 + i * 3.4}
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function Tool({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex size-8 items-center justify-center rounded-md text-body-sm transition-colors duration-fast focus-visible:focus-ring  disabled:cursor-not-allowed disabled:text-disabled-fg ${
        pressed ? 'bg-primary-soft text-fg' : 'text-fg-muted hover:bg-surface-sunken hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />;
}

export function FormatToolbar({
  editor,
  state,
  editable,
}: {
  editor: Editor | null;
  state: FormatState;
  editable: boolean;
}) {
  const t = useTranslations('studio.toolbar');
  const off = !editable || editor === null;
  const run = (fn: (e: Editor) => void) => () => editor && fn(editor);
  return (
    <>
      <Select
        aria-label={t('style')}
        size="sm"
        className="w-32"
        disabled={off}
        value={state.style}
        onChange={(e) => editor && setStyle(editor, e.target.value as BlockStyle)}
        options={[
          { value: 'paragraph', label: t('styleParagraph') },
          { value: 'h1', label: t('styleHeading1') },
          { value: 'h2', label: t('styleHeading2') },
        ]}
      />
      <Separator />
      <Tool
        label={t('bold')}
        pressed={state.bold}
        disabled={off}
        onClick={run((e) => e.chain().focus().toggleBold().run())}
      >
        <span className="font-bold">B</span>
      </Tool>
      <Tool
        label={t('italic')}
        pressed={state.italic}
        disabled={off}
        onClick={run((e) => e.chain().focus().toggleItalic().run())}
      >
        <span className="italic">I</span>
      </Tool>
      <Tool
        label={t('underline')}
        pressed={state.underline}
        disabled={off}
        onClick={run((e) => e.chain().focus().toggleUnderline().run())}
      >
        <span className="underline">U</span>
      </Tool>
      <Separator />
      {(['left', 'center', 'right', 'justify'] as const).map((a) => (
        <Tool
          key={a}
          label={t(`align.${a}`)}
          pressed={state.align === a}
          disabled={off}
          onClick={run((e) => setAlign(e, a))}
        >
          <AlignIcon align={a} />
        </Tool>
      ))}
      <Separator />
      <Tool
        label={t('bulletList')}
        pressed={state.bulletList}
        disabled={off}
        onClick={run((e) => e.chain().focus().toggleBulletList().run())}
      >
        •
      </Tool>
      <Tool
        label={t('orderedList')}
        pressed={state.orderedList}
        disabled={off}
        onClick={run((e) => e.chain().focus().toggleOrderedList().run())}
      >
        1.
      </Tool>
      <Separator />
      <Tool
        label={t('undo')}
        disabled={off || !state.canUndo}
        onClick={run((e) => e.chain().focus().undo().run())}
      >
        ↶
      </Tool>
      <Tool
        label={t('redo')}
        disabled={off || !state.canRedo}
        onClick={run((e) => e.chain().focus().redo().run())}
      >
        ↷
      </Tool>
    </>
  );
}
