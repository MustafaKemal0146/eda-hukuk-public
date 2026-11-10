'use client';
// Belge stüdyosu (053-03): başlık, kaydetme durumu, araç çubuğu, A4 yüzeyi ve sürümler.
// Kapsam bu dilimde: otomatik kayıt (3 sn / 15 sn), çakışma paneli, sürümler, A4 yakınlaştırma.
// IndexedDB yerel taslağı, sekme kilidi ve dışa aktarma sonraki dilimlerdedir.
import type { DocumentDtoValue } from '@eda/contracts/api/documents';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { SECTION_ROLES, type SectionRole } from '@eda/contracts/enums';
import { DEFAULT_DOC_LAYOUT, type DocLayout } from '@eda/editor/schema';
import {
  AlertDialog,
  Button,
  Dialog,
  ErrorState,
  IconButton,
  Input,
  NoticeBanner,
  Popover,
  Select,
  Skeleton,
  Tabs,
} from '@eda/ui';
import type { Editor } from '@tiptap/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createConversation } from '../../lib/conversations.ts';
import { useCssVar } from '../../lib/use-css-var.ts';
import { ALIAS_BY_MODE } from '../chat/chat-request.ts';
import { ConversationScreen } from '../chat/conversation-screen.tsx';
import { fileSlug, printPdf } from '../chat/document-export.ts';
import { setPendingFirstMessage } from '../chat/pending-message.ts';
import { useMediaQuery } from '../chat/use-media-query.ts';
import { AutosaveController, type SaveResult, type SaveState } from './autosave.ts';
import { docText, type EditTarget, rememberEditTarget } from './chat-bridge.ts';
import { docToBlocks } from './doc-convert.ts';
import { ApiClientError, authRedirectFor, documentsApi } from './documents-api.ts';
import { downloadDocx } from './docx-writer.ts';
import { buildEditPrompt } from './edit-request.ts';
import { EditRequestForm } from './edit-request-form.tsx';
import { FindPanel, useFindReplace } from './find-panel.tsx';
import { findPlaceholders, nextRangeAfter, selectRange } from './find-replace.ts';
import {
  EMPTY_FORMAT,
  type FormatState,
  FormatToolbar,
  formatStateOf,
  sameFormat,
} from './format-toolbar.tsx';
import { editorLayout, layoutCssVars, pdfCssOf, setDocLayout, wordCount } from './page-layout.ts';
import { LayoutControls } from './page-layout.tsx';
import { type BalloonPosition, SelectionBalloon } from './selection-balloon.tsx';
import { type SelectionTarget, selectionTargetOf } from './selection-target.ts';
import { readStudioChat, type StudioView, visibleViews, writeStudioChat } from './studio-chat.ts';
import {
  addSectionAfterCurrent,
  applyBlockRevs,
  currentSectionRole,
  type DocJson,
  StudioEditor,
  setCurrentSectionRole,
} from './studio-editor.tsx';
import { readFocusPref, studioShortcutOf, writeFocusPref } from './studio-prefs.ts';
import { VersionsSheet } from './versions-sheet.tsx';

const PAPER_PX = 794;
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ZOOMS = ['0.75', '0.9', '1', 'fit'] as const;
/** Seçili metnin kısa özeti (tek satır, en çok 80 karakter). */
const excerptOf = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
};
type Zoom = (typeof ZOOMS)[number];

type Load =
  | { state: 'loading' }
  | { state: 'ready'; doc: DocumentDtoValue }
  | { state: 'missing' }
  | { state: 'error' };

/** Yan sohbet paneli durumu; belge yeniden yüklenince kaybolmasın diye stüdyo kökünde tutulur. */
export type ChatPanelState = { conversationId: string | null; open: boolean };

export function DocumentStudio({ documentId }: { documentId: string }) {
  const t = useTranslations('studio');
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [chat, setChatState] = useState<ChatPanelState>({ conversationId: null, open: false });
  useEffect(() => {
    const known = readStudioChat(documentId);
    if (known) setChatState({ conversationId: known, open: false });
  }, [documentId]);
  const setChat = useCallback(
    (next: ChatPanelState) => {
      setChatState(next);
      writeStudioChat(documentId, next.conversationId);
    },
    [documentId],
  );

  const fetchDoc = useCallback(async () => {
    setLoad({ state: 'loading' });
    try {
      setLoad({ state: 'ready', doc: await documentsApi.documents.get(documentId) });
    } catch (err) {
      const to = authRedirectFor(err, `/belgeler/${documentId}`);
      if (to) router.replace(to);
      else if (err instanceof ApiClientError && err.status === 404) setLoad({ state: 'missing' });
      else setLoad({ state: 'error' });
    }
  }, [documentId, router]);

  useEffect(() => {
    void fetchDoc();
  }, [fetchDoc]);

  if (load.state === 'loading') {
    return (
      <div aria-busy="true" className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (load.state === 'missing') {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorState
          title={t('notFoundTitle')}
          message={t('notFoundBody')}
          labels={{
            retry: t('retry'),
            retrying: t('loading'),
            supportCode: '',
            copy: '',
            copied: '',
          }}
        />
        <Button variant="ghost" render={<Link href="/belgeler" />}>
          {t('back')}
        </Button>
      </div>
    );
  }
  if (load.state === 'error') {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorState
          title={t('loadError')}
          onRetry={() => void fetchDoc()}
          labels={{
            retry: t('retry'),
            retrying: t('loading'),
            supportCode: '',
            copy: '',
            copied: '',
          }}
        />
      </div>
    );
  }
  return (
    <StudioSession
      key={load.doc.id}
      initial={load.doc}
      reload={fetchDoc}
      chat={chat}
      onChat={setChat}
    />
  );
}

function StudioSession({
  initial,
  reload,
  chat,
  onChat,
}: {
  initial: DocumentDtoValue;
  reload: () => Promise<void>;
  chat: ChatPanelState;
  onChat: (next: ChatPanelState) => void;
}) {
  const t = useTranslations('studio');
  const tr = useTranslations('studio.roles');
  const tl = useTranslations('legal');
  const router = useRouter();
  const editorRef = useRef<Editor | null>(null);
  const revRef = useRef(initial.draftRev);
  const seqRef = useRef(0);
  const [title, setTitle] = useState(initial.title);
  const [saveState, setSaveState] = useState<SaveState>('clean');
  const [role, setRole] = useState<SectionRole | null>(null);
  const [editorInst, setEditorInst] = useState<Editor | null>(null);
  const [fmt, setFmt] = useState<FormatState>(EMPTY_FORMAT);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [fitZoom, setFitZoom] = useState(1);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  useCssVar(paperRef, '--eda-zoom', String(zoom === 'fit' ? fitZoom : Number(zoom)));

  // Sayfa düzeni belgenin kök özniteliklerinde yaşar; kâğıt CSS değişkenleri ondan türetilir.
  const [layout, setLayout] = useState<DocLayout>(DEFAULT_DOC_LAYOUT);
  const [words, setWords] = useState(0);
  const [pages, setPages] = useState(1);
  const cssVars = layoutCssVars(layout);
  useCssVar(paperRef, '--eda-paper-font', cssVars['--eda-paper-font']);
  useCssVar(paperRef, '--eda-paper-font-size', cssVars['--eda-paper-font-size']);
  useCssVar(paperRef, '--eda-paper-line-height', cssVars['--eda-paper-line-height']);

  // Odak modu: kabuk (kenar menü, üst çubuk) stüdyonun sabit katmanıyla örtülür; tercih hatırlanır.
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    setFocus(readFocusPref());
  }, []);
  const setFocusMode = useCallback((on: boolean) => {
    setFocus(on);
    writeFocusPref(on);
  }, []);

  // Durum matrisi sunucudadır (DOC_LOCKED); burada yalnız bariz kilitler önceden gösterilir.
  const lockedReason =
    initial.generationStatus !== 'idle'
      ? t('status.generationInProgress')
      : initial.status === 'archived'
        ? t('status.archived')
        : null;
  const editable = lockedReason === null;

  const save = useCallback(
    async (reason: 'autosave' | 'manual' | 'flush' | 'keepalive'): Promise<SaveResult> => {
      const editor = editorRef.current;
      if (!editor) return { kind: 'ok' };
      seqRef.current += 1;
      try {
        const r = await documentsApi.documents.saveDraft(initial.id, {
          baseVersion: revRef.current,
          draft: editor.getJSON() as never,
          clientSeq: seqRef.current,
          reason,
        });
        revRef.current = r.draftRev;
        applyBlockRevs(editor, r.blockRevs);
        return { kind: 'ok' };
      } catch (err) {
        if (err instanceof ApiClientError) {
          const to = authRedirectFor(err, `/belgeler/${initial.id}`);
          if (to) {
            router.replace(to);
            return { kind: 'fatal' };
          }
          if (err.status === 409) return { kind: 'conflict' };
          if (err.status >= 500) return { kind: 'network' };
          return { kind: 'fatal' };
        }
        return { kind: 'network' };
      }
    },
    [initial.id, router],
  );

  const controller = useMemo(
    () =>
      new AutosaveController({
        debounceMs: CONFIG_DEFAULTS['editor.autosaveDebounceMs'],
        maxWaitMs: CONFIG_DEFAULTS['editor.autosaveMaxWaitMs'],
        retryMax: CONFIG_DEFAULTS['editor.autosaveRetryMax'],
        save,
        onState: setSaveState,
      }),
    [save],
  );

  useEffect(() => () => controller.dispose(), [controller]);

  // Kapanış/arka plan: bekleyen taslak gönderilir; kaydedilmemişse tarayıcı onayı istenir.
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (controller.hasUnsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') void controller.flush('flush');
    };
    window.addEventListener('beforeunload', onBefore);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onBefore);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [controller]);

  // Seçili kısım: balon konumu + hedef; balona basınca istek kutusu (Dialog) açılır.
  const [balloon, setBalloon] = useState<(BalloonPosition & { target: SelectionTarget }) | null>(
    null,
  );
  const [selection, setSelection] = useState<{
    target: SelectionTarget;
    role: SectionRole | null;
  } | null>(null);

  // Bul/değiştir (Ctrl+F) ve doldurulacak alan sayacı.
  const [findOpen, setFindOpen] = useState(false);
  const findInputRef = useRef<HTMLInputElement>(null);
  const find = useFindReplace(editorInst, findOpen);
  const [placeholderCount, setPlaceholderCount] = useState(0);
  const openFind = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => findInputRef.current?.select());
  }, []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    editorRef.current?.commands.focus();
  }, []);
  function jumpToPlaceholder() {
    const editor = editorRef.current;
    if (!editor) return;
    const target = nextRangeAfter(findPlaceholders(editor.state.doc), editor.state.selection.from);
    if (target) selectRange(editor, target);
  }

  // Kısayollar: Ctrl+S kaydeder (tarayıcı "sayfayı kaydet" engellenir), Ctrl+F bul, Ctrl+Shift+F
  // odak modu; Esc önce bul panelini kapatır, sonra odak modundan çıkar.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const findOpenRef = useRef(findOpen);
  findOpenRef.current = findOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = studioShortcutOf(e);
      if (s === 'save') {
        e.preventDefault();
        void controller.flush('manual');
      } else if (s === 'focus') {
        e.preventDefault();
        setFocusMode(!focusRef.current);
      } else if (s === 'find') {
        e.preventDefault();
        openFind();
      } else if (s === 'escape') {
        if (findOpenRef.current) closeFind();
        else if (focusRef.current) setFocusMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, setFocusMode, openFind, closeFind]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      if (w > 0) setFitZoom(Math.min(1, w / PAPER_PX));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onReady = useCallback((e: Editor) => {
    editorRef.current = e;
    setEditorInst(e);
    const sync = () => {
      setRole(currentSectionRole(e));
      const next = formatStateOf(e);
      setFmt((prev) => (sameFormat(prev, next) ? prev : next));
      const { from, to, empty } = e.state.selection;
      const target = empty || !e.isEditable ? null : selectionTargetOf(e.state.doc, from, to);
      const box = wrap.current?.getBoundingClientRect();
      if (!target || !box) {
        setBalloon(null);
      } else {
        const c = e.view.coordsAtPos(to);
        setBalloon({ x: c.left - box.left, y: c.bottom - box.top + 8, target });
      }
    };
    const count = () => {
      setPlaceholderCount(findPlaceholders(e.state.doc).length);
      setWords(wordCount(e.getText({ blockSeparator: ' ' })));
      const next = editorLayout(e);
      setLayout((prev) =>
        prev.fontFamily === next.fontFamily &&
        prev.fontSizePt === next.fontSizePt &&
        prev.lineHeight === next.lineHeight
          ? prev
          : next,
      );
    };
    e.on('selectionUpdate', sync);
    e.on('transaction', sync);
    e.on('update', count);
    sync();
    count();
  }, []);

  const onChange = useCallback(() => controller.markDirty(), [controller]);

  async function renameTitle() {
    const next = title.trim();
    if (next === '' || next === initial.title) {
      setTitle(initial.title);
      return;
    }
    try {
      await documentsApi.documents.patch(initial.id, { title: next });
    } catch {
      setTitle(initial.title);
    }
  }

  async function resolveReload() {
    controller.reset();
    await reload();
  }

  async function resolveKeepLocal() {
    const editor = editorRef.current;
    if (!editor) return;
    const local = editor.getJSON();
    try {
      const server = await documentsApi.documents.get(initial.id);
      await documentsApi.documents.createVersion(initial.id, { name: t('conflict.title') });
      const r = await documentsApi.documents.saveDraft(initial.id, {
        baseVersion: server.draftRev,
        draft: local as never,
        clientSeq: seqRef.current + 1,
        reason: 'manual',
      });
      revRef.current = r.draftRev;
      applyBlockRevs(editor, r.blockRevs);
      controller.reset();
      controller.markSaved();
    } catch {
      // Çözüm başarısızsa panel açık kalır; yerel metin kopyalanabilir.
    }
  }

  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState(false);

  /** Belgeyi sohbet hattına taşır (kapı ve maskeleme orada çalışır); yanıt "Belgeye uygula" ile döner. */
  const [requestOpen, setRequestOpen] = useState(false);

  // Yan sohbet paneli: geniş ekranda belgenin sağında, dar ekranda üstte sekme; odak modunda da açılır.
  const wide = useMediaQuery('(min-width: 80rem)');
  const [view, setView] = useState<StudioView>('document');
  const views = visibleViews({ wide, chatOpen: chat.open && chat.conversationId !== null, view });
  const [chatOpening, setChatOpening] = useState(false);
  async function toggleChat() {
    if (chat.open) {
      onChat({ ...chat, open: false });
      return;
    }
    if (chat.conversationId) {
      setView('chat');
      onChat({ ...chat, open: true });
      return;
    }
    setChatOpening(true);
    setChatError(false);
    try {
      const id = await createConversation();
      rememberEditTarget(id, { kind: 'document', documentId: initial.id });
      setView('chat');
      onChat({ conversationId: id, open: true });
    } catch {
      setChatError(true);
    } finally {
      setChatOpening(false);
    }
  }

  /**
   * Belgeyi (veya yalnız seçili kısmı) sohbet hattına taşır; yanıt "Belgeye uygula" ile döner.
   * Seçim hedefinde bölüm türü bağlam olarak eklenir; yanıt yalnız o aralığın yerine yazılır.
   */
  async function editInChat(request: string, sel: typeof selection = null) {
    const editor = editorRef.current;
    if (!editor) return;
    setChatBusy(true);
    setChatError(false);
    try {
      await controller.flush('manual');
      const text = sel
        ? buildEditPrompt({
            prompt: t('export.selectionPrompt'),
            request,
            title: t('export.selectionContext', {
              section: sel.role ? tr(sel.role) : tr('generic'),
            }),
            body: sel.target.text,
          })
        : buildEditPrompt({
            prompt: t('export.chatPrompt'),
            request,
            title,
            body: docText(editor.getJSON()),
          });
      if (text.length > CONFIG_DEFAULTS['chat.maxUserMessageChars']) {
        setChatError(true);
        return;
      }
      const target: EditTarget = sel
        ? { kind: 'selection', documentId: initial.id, ...sel.target }
        : { kind: 'document', documentId: initial.id };
      const id = await createConversation();
      rememberEditTarget(id, target);
      setPendingFirstMessage(id, { text, alias: ALIAS_BY_MODE.fast });
      setRequestOpen(false);
      setSelection(null);
      setView('chat');
      onChat({ conversationId: id, open: true });
    } catch {
      setChatError(true);
    } finally {
      setChatBusy(false);
    }
  }

  async function deleteDocument() {
    setDeleting(true);
    setDeleteFailed(false);
    try {
      controller.dispose();
      await documentsApi.documents.remove(initial.id);
      router.push('/belgeler');
    } catch {
      setDeleteFailed(true);
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  function exportDocx() {
    const editor = editorRef.current;
    if (editor) downloadDocx(title, docToBlocks(editor.getJSON()), fileSlug(title), layout);
  }

  function exportPdf() {
    const editor = editorRef.current;
    if (editor) {
      printPdf(
        title,
        `<h3 class="baslik">${escapeHtml(title)}</h3>${editor.getHTML()}`,
        pdfCssOf(layout),
      );
    }
  }

  async function copyLocal() {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      await navigator.clipboard.writeText(editor.getText({ blockSeparator: '\n\n' }));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const roleOptions = SECTION_ROLES.map((r) => ({ value: r, label: tr(r) }));
  const initialDoc = initial.draft as unknown as DocJson;

  return (
    <div
      data-focus-mode={focus ? '' : undefined}
      className={
        focus ? 'fixed inset-0 z-overlay flex flex-col bg-surface' : 'flex h-full min-h-0 flex-col'
      }
    >
      {views.tabs && (
        <Tabs
          value={view}
          onValueChange={setView}
          label={t('chat.viewsLabel')}
          className="px-4"
          items={[
            { value: 'document', label: t('chat.tabDocument') },
            { value: 'chat', label: t('chat.tabChat') },
          ]}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <div className={views.document ? 'flex min-w-0 flex-1 flex-col' : 'hidden'}>
          <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
            <Link
              href="/belgeler"
              className="text-body-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:focus-ring"
            >
              {t('back')}
            </Link>
            <Input
              aria-label={t('titleLabel')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void renameTitle()}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="min-w-0 max-w-md flex-1 font-medium"
              size="sm"
              maxLength={200}
            />
            <p
              role="status"
              className={`text-caption ${saveState === 'conflict' || saveState === 'error' ? 'text-danger' : 'text-fg-subtle'}`}
            >
              {t(`save.${saveState}`)}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Select
                aria-label={t('zoom.label')}
                size="sm"
                value={zoom}
                onChange={(e) => setZoom(e.target.value as Zoom)}
                options={[
                  { value: '0.75', label: '75%' },
                  { value: '0.9', label: '90%' },
                  { value: '1', label: '100%' },
                  { value: 'fit', label: t('zoom.fit') },
                ]}
              />
              <Button
                size="sm"
                variant="outline"
                aria-pressed={focus}
                aria-keyshortcuts="Control+Shift+F"
                title={t('focus.hint')}
                onClick={() => setFocusMode(!focus)}
              >
                {focus ? t('focus.exit') : t('focus.enter')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setVersionsOpen(true)}>
                {t('versions.button')}
              </Button>
              <Button size="sm" variant="outline" onClick={exportDocx}>
                {t('export.word')}
              </Button>
              <Button size="sm" variant="outline" onClick={exportPdf}>
                {t('export.pdf')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>
                {t('delete.action')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-pressed={chat.open}
                loading={chatOpening}
                onClick={() => void toggleChat()}
              >
                {t('chat.button')}
              </Button>
              <Popover
                open={requestOpen}
                onOpenChange={setRequestOpen}
                size="md"
                align="end"
                title={t('export.chat')}
                description={t('export.requestIntro')}
                labels={{ close: t('export.requestClose') }}
                trigger={
                  <Button size="sm" loading={chatBusy}>
                    {t('export.chat')}
                  </Button>
                }
              >
                <EditRequestForm busy={chatBusy} onSubmit={(r) => void editInChat(r)} />
              </Popover>
            </div>
          </header>
          <p className="border-b border-border bg-surface-sunken px-4 py-1.5 text-caption text-fg-muted">
            {tl('mandatory.y88')}
          </p>

          {deleteFailed && (
            <div className="px-4 pt-3">
              <NoticeBanner tone="danger" role="alert">
                {t('delete.error')}
              </NoticeBanner>
            </div>
          )}
          <AlertDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={t('delete.title')}
            description={t('delete.description', { title })}
            impact={t('delete.impact')}
            cancelLabel={t('delete.cancel')}
            destructiveLabel={t('delete.confirm')}
            confirmLoading={deleting}
            confirmLoadingLabel={t('delete.confirm')}
            onConfirm={() => void deleteDocument()}
          />
          {chatError && (
            <div className="px-4 pt-3">
              <NoticeBanner tone="danger" role="alert">
                {t('export.chatError')}
              </NoticeBanner>
            </div>
          )}
          {lockedReason && (
            <div className="px-4 pt-3">
              <NoticeBanner tone="warning" role="status" title={t('status.lockedTitle')}>
                {lockedReason}
              </NoticeBanner>
            </div>
          )}
          {saveState === 'conflict' && (
            <div className="px-4 pt-3">
              <NoticeBanner
                tone="danger"
                role="alert"
                title={t('conflict.title')}
                action={
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void resolveReload()}>
                      {t('conflict.reload')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void resolveKeepLocal()}>
                      {t('conflict.keepLocal')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void copyLocal()}>
                      {t('conflict.copy')}
                    </Button>
                  </div>
                }
              >
                {t('conflict.body')}
                {copied && <span className="block text-caption">{t('conflict.copied')}</span>}
              </NoticeBanner>
            </div>
          )}

          <div
            role="toolbar"
            aria-label={t('toolbar.label')}
            className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-1.5"
          >
            <FormatToolbar editor={editorInst} state={fmt} editable={editable} />
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
            <LayoutControls
              layout={layout}
              disabled={!editable || editorInst === null}
              onChange={(patch) => editorRef.current && setDocLayout(editorRef.current, patch)}
            />
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
            <Button
              size="sm"
              variant="ghost"
              disabled={!editable}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editorRef.current && addSectionAfterCurrent(editorRef.current)}
            >
              {t('toolbar.addSection')}
            </Button>
            <Select
              aria-label={t('toolbar.role')}
              size="sm"
              className="ml-auto w-48"
              disabled={!editable || role === null}
              value={role ?? 'generic'}
              onChange={(e) =>
                editorRef.current &&
                setCurrentSectionRole(editorRef.current, e.target.value as SectionRole)
              }
              options={roleOptions}
            />
          </div>
          {findOpen && (
            <FindPanel
              model={find}
              editable={editable}
              onClose={closeFind}
              inputRef={findInputRef}
            />
          )}

          <div className="min-h-0 flex-1 overflow-auto bg-surface-sunken p-6">
            <div ref={wrap} className="relative mx-auto w-full max-w-(--eda-paper-width)">
              <div ref={paperRef} className="eda-paper mx-auto" data-theme="light">
                <StudioEditor
                  initial={initialDoc}
                  editable={editable}
                  label={t('editorLabel')}
                  onChange={onChange}
                  onReady={onReady}
                  onPages={setPages}
                />
              </div>
              <p className="mt-4 text-center text-caption text-fg-subtle">{t('notice')}</p>
              {balloon && !selection && (
                <SelectionBalloon
                  position={balloon}
                  label={t('export.selectionButton')}
                  onClick={() => setSelection({ target: balloon.target, role })}
                />
              )}
            </div>
          </div>
          <footer className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-1.5 text-caption text-fg-muted">
            <button
              type="button"
              className="rounded-sm underline-offset-4 hover:text-fg hover:underline focus-visible:focus-ring disabled:no-underline disabled:hover:text-fg-muted"
              disabled={placeholderCount === 0}
              title={t('find.placeholderNext')}
              onClick={jumpToPlaceholder}
            >
              {t('placeholders', { count: placeholderCount })}
            </button>
            <span aria-hidden="true">·</span>
            <span>{t('counts.words', { count: words })}</span>
            <span aria-hidden="true">·</span>
            <span>{t('counts.pages', { count: pages })}</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              aria-keyshortcuts="Control+F"
              aria-expanded={findOpen}
              onClick={() => (findOpen ? closeFind() : openFind())}
            >
              {t('find.label')}
            </Button>
          </footer>
        </div>
        {views.chat && chat.conversationId && (
          <aside
            aria-label={t('chat.title')}
            className={`flex min-h-0 flex-col border-border ${wide ? 'w-panel-preview shrink-0 border-l' : 'min-w-0 flex-1'}`}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              <h2 className="text-body-sm font-semibold text-fg">{t('chat.title')}</h2>
              <IconButton
                size="sm"
                icon="action.close"
                label={t('chat.close')}
                className="ml-auto"
                onClick={() => void toggleChat()}
              />
            </div>
            <div className="min-h-0 flex-1">
              <ConversationScreen
                key={chat.conversationId}
                conversationId={chat.conversationId}
                embedded
                onApplied={() => void resolveReload()}
              />
            </div>
          </aside>
        )}
      </div>

      <Dialog
        open={selection !== null}
        onOpenChange={(o) => !o && setSelection(null)}
        title={t('export.selectionTitle')}
        description={t('export.selectionIntro')}
        labels={{ close: t('export.requestClose') }}
      >
        {selection && (
          <EditRequestForm
            busy={chatBusy}
            scopeNote={t('export.selectionNote', {
              section: selection.role ? tr(selection.role) : tr('generic'),
              excerpt: excerptOf(selection.target.text),
            })}
            onSubmit={(r) => void editInChat(r, selection)}
          />
        )}
      </Dialog>
      <VersionsSheet
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        documentId={initial.id}
        disabled={!editable}
        beforeCreate={() => controller.flush('manual')}
        onRestored={() => void resolveReload()}
      />
    </div>
  );
}
