'use client';
// Sohbet ekranı (053-02; 052 §5.1 ConversationProvider + ConversationView): geçmişi `GET` ile yükler,
// `/sohbet`'ten gelen ilk mesajı bir kez gönderir, AI SDK `useChat` ile UI Message Stream'i tüketir
// (022 §12.1). Geçici `data-pipeline` olayları `onData` ile ajan hattına, kalıcı parçalar mesaja.
import { useChat } from '@ai-sdk/react';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { KunyeStatus } from '@eda/contracts/enums';
import { dataPartSchemas, MessageMetadata, type SourceItem } from '@eda/contracts/stream';
import {
  Button,
  EnvironmentStrip,
  ErrorState,
  NoticeBanner,
  Sheet,
  Skeleton,
  useAnnounce,
} from '@eda/ui';
import { ConversationView } from '@eda/ui/ai-elements';
import { DefaultChatTransport, type FileUIPart, validateUIMessages } from 'ai';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ApiErrorInfo, errorInfoOf } from '../../lib/api-error.ts';
import { authTargetFor } from '../../lib/auth-redirect.ts';
import {
  CONVERSATIONS_API,
  getConversation,
  refreshRecentConversations,
  stopConversationTurn,
} from '../../lib/conversations.ts';
import { stashDraft, takeDraft } from '../../lib/draft-stash.ts';
import { guardedFetch, onSessionEnded } from '../../lib/session-guard.ts';
import { uuidv7 } from '../../lib/uuid.ts';
import { readScope } from '../scope/scope-store.ts';
import {
  applyToDocument,
  editTargetOf,
  openAsNewDocument,
  SelectionNotFoundError,
  saveChatDocument,
} from '../studio/chat-bridge.ts';
import { ApiClientError, authRedirectFor } from '../studio/documents-api.ts';
import { downloadDocx } from '../studio/docx-writer.ts';
import { type AnswerExportLabels, answerExportBlocks, exportBlocked } from './answer-export.ts';
import { readyParts, useChatAttachments } from './attachments.ts';
import { AssistantMessage, UserMessage } from './chat-message.tsx';
import {
  ALIAS_BY_MODE,
  aliasFromBody,
  buildChatTurnRequest,
  buildRegenerateRequest,
  replaceFromOfBody,
  truncateFromMessage,
} from './chat-request.ts';
import {
  conversationSources,
  type EdaUIMessage,
  environmentNotice,
  messageCitations,
  messageSources,
  messageText,
} from './chat-types.ts';
import { citedRefs, serializeForCopy } from './citations.ts';
import { Composer, type ComposerMode } from './composer.tsx';
import { readComposerMode } from './composer-mode-store.ts';
import { fileSlug } from './document-export.ts';
import { DocumentPanel } from './document-panel.tsx';
import { documentsOf } from './documents.ts';
import { claimFor } from './highlight.ts';
import type { CitationContextValue } from './message-content.tsx';
import {
  clearPendingFirstMessage,
  type PendingFirstMessage,
  peekPendingFirstMessage,
} from './pending-message.ts';
import { useSourceMeta } from './source-meta.ts';
import { previewIdOf } from './source-preview.tsx';
import { SourcesList, SourcesPanel, type SourcesPanelData } from './sources-panel.tsx';
import { type CitationReason, useChipLabel, useChipMeta } from './use-chip-label.ts';
import { useMediaQuery } from './use-media-query.ts';
import { usePipelineTracker } from './use-pipeline.ts';

/** Durdur isteğinden sonra akış kapanmazsa istemci tarafı kesme (053-02 §4.9: 3 sn). */
const STOP_FALLBACK_MS = 3000;

/** Dışa aktarılan dosya adındaki gün (`YYYY-AA-GG`, Europe/Istanbul). */
const ISTANBUL_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function refNumber(ref: string): number {
  return Number(ref.slice(1)) || 0;
}
/** >= xl (051 §12 `--breakpoint-xl`): kaynak paneli satır içi sütun. */
const PANEL_INLINE_QUERY = '(min-width: 80rem)';

type LoadState =
  | { state: 'loading' }
  | { state: 'error'; info: ApiErrorInfo }
  | {
      state: 'ready';
      messages: EdaUIMessage[];
      title: string | null;
      streamingMessageId: string | null;
      pending: PendingFirstMessage | null;
    };

export type ConversationScreenProps = {
  conversationId: string;
  /** Başka bir ekranın (stüdyo yan paneli) içinde: kaynak/belge paneli daima çekmecede açılır. */
  embedded?: boolean;
  /** "Belgeye uygula" sonrası sayfadan ayrılmadan çağrılır (stüdyo belgeyi yeniden yükler). */
  onApplied?: (documentId: string) => void;
};

export function ConversationScreen({
  conversationId,
  embedded,
  onApplied,
}: ConversationScreenProps) {
  const t = useTranslations('chat');
  const [load, setLoad] = useState<LoadState>(() => {
    const pending = peekPendingFirstMessage(conversationId);
    return pending
      ? {
          state: 'ready',
          messages: [],
          title: pending.text.slice(0, 80),
          streamingMessageId: null,
          pending,
        }
      : { state: 'loading' };
  });

  useEffect(() => {
    if (load.state !== 'loading') return;
    let cancelled = false;
    getConversation(conversationId)
      .then(async (detail) => {
        const messages =
          detail.messages.length === 0
            ? []
            : await validateUIMessages<EdaUIMessage>({
                messages: detail.messages,
                metadataSchema: MessageMetadata,
                dataSchemas: dataPartSchemas,
              });
        if (!cancelled) {
          setLoad({
            state: 'ready',
            messages,
            title: detail.title,
            streamingMessageId: detail.streamingMessageId,
            pending: null,
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const info = errorInfoOf(err);
        const to = authTargetFor(info, `/sohbet/${conversationId}`);
        if (to) window.location.replace(to);
        else setLoad({ state: 'error', info });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, load.state]);

  if (load.state === 'loading') {
    return (
      <div className="mx-auto flex w-full max-w-chat flex-col gap-6 px-4 py-8" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="ml-auto h-10 w-1/2 rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="ml-auto h-10 w-1/3 rounded-lg" />
      </div>
    );
  }
  if (load.state === 'error') {
    const notFound = load.info.code === 'CHAT_CONVERSATION_NOT_FOUND';
    return (
      <div className="mx-auto flex w-full max-w-chat flex-col items-center px-4 py-10">
        <ErrorState
          title={notFound ? t('notFound.title') : t('loadError.title')}
          message={notFound ? t('notFound.body') : (load.info.message ?? t('error.generic'))}
          {...(notFound ? {} : { onRetry: () => setLoad({ state: 'loading' }) })}
          {...(load.info.requestId ? { requestId: load.info.requestId } : {})}
          labels={{
            retry: t('error.retry'),
            supportCode: t('error.supportCodeLabel'),
            copy: t('error.copyCode'),
            copied: t('error.copiedCode'),
          }}
        />
        <Button variant="ghost" leadingIcon="nav.new-chat" render={<Link href="/sohbet" />}>
          {t('notFound.newChat')}
        </Button>
      </div>
    );
  }
  return (
    <ChatSession
      key={conversationId}
      conversationId={conversationId}
      initialMessages={load.messages}
      title={load.title}
      pending={load.pending}
      streamingMessageId={load.streamingMessageId}
      onReload={() => setLoad({ state: 'loading' })}
      embedded={embedded ?? false}
      {...(onApplied ? { onApplied } : {})}
    />
  );
}

function ChatSession({
  conversationId,
  initialMessages,
  title,
  pending,
  streamingMessageId,
  onReload,
  embedded,
  onApplied,
}: {
  conversationId: string;
  embedded: boolean;
  onApplied?: (documentId: string) => void;
  initialMessages: EdaUIMessage[];
  title: string | null;
  pending: PendingFirstMessage | null;
  streamingMessageId: string | null;
  onReload: () => void;
}) {
  const t = useTranslations('chat');
  const tl = useTranslations('legal');
  const announce = useAnnounce();
  const router = useRouter();
  const chipLabel = useChipLabel();
  const chipMeta = useChipMeta();
  const sourceMeta = useSourceMeta();
  const pipeline = usePipelineTracker();
  const panelInline = useMediaQuery(PANEL_INLINE_QUERY) && !embedded;

  const stopRequested = useRef(false);
  const lastMode = useRef<ComposerMode>(pending?.alias === 'edai-pro' ? 'deep' : 'fast');
  /** Düzenlenip yeniden gönderilen mesajın kesme noktası; tur kaydedilene dek (yeniden dene) korunur. */
  const replaceFromRef = useRef<string | null>(null);
  const [draft, setDraft] = useState('');
  const [turnError, setTurnError] = useState<ApiErrorInfo | null>(null);
  const [stoppedIds, setStoppedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [activeRef, setActiveRef] = useState<string | null>(null);
  const [activeClaim, setActiveClaim] = useState('');
  const [previewRef, setPreviewRef] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lockedId, setLockedId] = useState(streamingMessageId);
  // Sağ panel: kaynaklar veya sohbetteki belge kartından açılan belge metni (Claude "artifact" kalıbı).
  const [panelView, setPanelView] = useState<'sources' | 'document'>('sources');
  const [docKey, setDocKey] = useState<{ messageId: string; index: number } | null>(null);
  const autoOpenedDoc = useRef<string | null>(null);
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioError, setStudioError] = useState(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<EdaUIMessage>({
        api: `${CONVERSATIONS_API}/${encodeURIComponent(conversationId)}/messages`,
        credentials: 'same-origin',
        fetch: guardedFetch,
        prepareSendMessagesRequest: ({ messages, body, trigger, messageId }) => ({
          // Yeniden üretimde kullanıcı mesajı yeniden gönderilmez; sunucu hedefi kendisi çözer.
          body:
            trigger === 'regenerate-message'
              ? buildRegenerateRequest(aliasFromBody(body), messageId ?? null, readScope())
              : buildChatTurnRequest(
                  messages,
                  aliasFromBody(body),
                  readScope(),
                  replaceFromOfBody(body),
                ),
          headers: { 'x-request-id': uuidv7() },
        }),
      }),
    [conversationId],
  );

  const { settle, push, begin } = pipeline;
  const chat = useChat<EdaUIMessage>({
    id: conversationId,
    messages: initialMessages,
    generateId: () => uuidv7(),
    transport,
    messageMetadataSchema: MessageMetadata,
    dataPartSchemas,
    throttle: CONFIG_DEFAULTS['chat.uiThrottleMs'],
    onData: (part) => {
      if (part.type === 'data-pipeline') push(part.data);
    },
    onFinish: ({ message, isAbort, isDisconnect, isError }) => {
      const assistantId = message.role === 'assistant' ? message.id : null;
      const outcome =
        stopRequested.current || isAbort ? 'stopped' : isError || isDisconnect ? 'error' : 'done';
      settle(assistantId, outcome);
      // Tur sunucuda kaydedildi: düzenleme kesme noktası artık yeniden gönderime taşınmaz.
      replaceFromRef.current = null;
      if (outcome === 'stopped' && assistantId) {
        setStoppedIds((prev) => new Set(prev).add(assistantId));
      }
      stopRequested.current = false;
      announce(t(outcome === 'done' ? 'status.completed' : `status.${outcome}`));
      void refreshRecentConversations();
    },
    onError: (err) => {
      // Durdurma isteğinde sunucu akışı "durduruldu" hata parçasıyla kapatır: hata değildir.
      if (stopRequested.current) return;
      const info = errorInfoOf(err);
      const to = authTargetFor(info, `/sohbet/${conversationId}`);
      if (to) {
        router.replace(to);
        return;
      }
      setTurnError(info);
    },
  });
  const {
    messages,
    status,
    sendMessage,
    regenerate: regenerateResponse,
    setMessages,
    stop: abortStream,
  } = chat;
  const busy = status === 'submitted' || status === 'streaming';
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Oturum sayfa açıkken biterse: açık akış durdurulur, taslak (veya yanıtı gelmeyen son gönderim)
  // sekmeye geçici saklanır; girişten dönüşte geri gelir. Yönlendirmeyi `guardedFetch` yapar.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const lastSentRef = useRef<string | null>(null);
  const abortRef = useRef(abortStream);
  abortRef.current = abortStream;
  const hereRef = useRef(`/sohbet/${conversationId}`);
  hereRef.current = `/sohbet/${conversationId}`;
  useEffect(() => {
    const restored = takeDraft(hereRef.current);
    if (restored !== null) setDraft(restored);
    return onSessionEnded(() => {
      stashDraft(hereRef.current, busyRef.current ? (lastSentRef.current ?? '') : draftRef.current);
      void abortRef.current();
    });
  }, []);

  const attachments = useChatAttachments({ originId: conversationId });
  const send = useCallback(
    (
      text: string,
      mode: ComposerMode,
      replaceFromMessageId: string | null = null,
      files: readonly FileUIPart[] = [],
    ) => {
      lastMode.current = mode;
      lastSentRef.current = text;
      replaceFromRef.current = replaceFromMessageId;
      setTurnError(null);
      begin();
      // Ek kimliği mesajın `file` parçasıyla gider (bayt yok); istek gövdesi `attachments`'ı ondan kurar.
      void sendMessage(files.length > 0 ? { text, files: [...files] } : { text }, {
        body: { alias: ALIAS_BY_MODE[mode], replaceFromMessageId },
      });
    },
    [begin, sendMessage],
  );

  /**
   * Kullanıcı mesajını düzenleyip yeniden gönderir: o mesaj ve sonrasındaki TÜM mesajlar sohbetten
   * kalkar (kaynak eşlemesi mesajlardan türediği için panel de temizlenir), metin yeni tur olarak
   * gider; sunucu aynı noktadan keser. Tur sürerken düğme çizilmediği için çift tetikleme olmaz.
   */
  const editMessage = useCallback(
    (messageId: string, text: string) => {
      if (busyRef.current || text.trim() === '') return;
      const kept = truncateFromMessage(messages, messageId);
      if (kept === null) return;
      setMessages([...kept]);
      send(text, readComposerMode(), messageId);
    },
    [messages, setMessages, send],
  );

  // İlk mesaj (053-02 §1.4): ref korumalı, bir kez. Gönderim bir sonraki görev dilimine ertelenir:
  // Strict Mode'un sahte söküm adımında `useChat` temizliği (`chat.stop()`) isteği kesmesin.
  const pendingSent = useRef(false);
  useEffect(() => {
    if (!pending || pendingSent.current) return;
    const timer = setTimeout(() => {
      pendingSent.current = true;
      clearPendingFirstMessage(conversationId);
      send(pending.text, pending.alias === 'edai-pro' ? 'deep' : 'fast', null, pending.files ?? []);
    }, 0);
    return () => clearTimeout(timer);
  }, [pending, conversationId, send]);

  /**
   * Son asistan yanıtını yeniden üretir (022 §2.1): eski yanıt yerinden kalkar, aynı kullanıcı
   * mesajıyla yeni tur başlar. Tur sürerken eylem çizilmediği için çift tetikleme olmaz.
   */
  const regenerate = useCallback(() => {
    if (busyRef.current) return;
    const last = messages.findLast((m) => m.role === 'assistant');
    if (!last) return;
    setTurnError(null);
    begin();
    void regenerateResponse({
      messageId: last.id,
      body: { alias: ALIAS_BY_MODE[readComposerMode()] },
    });
  }, [messages, begin, regenerateResponse]);

  const stop = useCallback(async () => {
    stopRequested.current = true;
    const last = messages.at(-1);
    if (last?.role === 'assistant') {
      try {
        await stopConversationTurn(conversationId, last.id);
      } catch {
        void abortStream();
        return;
      }
      setTimeout(() => {
        if (busyRef.current) void abortStream();
      }, STOP_FALLBACK_MS);
    } else {
      void abortStream();
    }
  }, [messages, conversationId, abortStream]);

  const stopLocked = useCallback(async () => {
    if (!lockedId) return;
    try {
      await stopConversationTurn(conversationId, lockedId);
    } catch {
      // Sunucu turu zaten kapatmış olabilir; yeniden yükleme güncel durumu getirir.
    }
    setLockedId(null);
    onReload();
  }, [lockedId, conversationId, onReload]);

  const retry = useCallback(() => {
    const idx = messages.findLastIndex((m) => m.role === 'user');
    const user = idx === -1 ? undefined : messages[idx];
    if (!user) return;
    setMessages(messages.slice(0, idx));
    // Başarısız düzenleme gönderimi yeniden denenirken kesme noktası korunur (sunucu henüz kesmedi).
    send(messageText(user), lastMode.current, replaceFromRef.current);
  }, [messages, setMessages, send]);

  // --- Kaynaklar ve künye durumları -------------------------------------------------------
  const sourceMap = useMemo(() => conversationSources(messages), [messages]);
  const lastAssistant = useMemo(() => messages.findLast((m) => m.role === 'assistant'), [messages]);

  const statusesFor = useCallback((m: EdaUIMessage | undefined) => {
    const map = new Map<string, KunyeStatus>();
    const c = m ? messageCitations(m) : null;
    for (const item of c?.items ?? []) if (item.ref) map.set(item.ref, item.status);
    return map;
  }, []);

  // Durum nedeni (ör. alıntı uyuşmazlığı): çip etiketi "Alıntı kaynakta bulunamadı" olur.
  const reasonsFor = useCallback((m: EdaUIMessage | undefined) => {
    const map = new Map<string, CitationReason>();
    const c = m ? messageCitations(m) : null;
    for (const item of c?.items ?? []) if (item.ref && item.reason) map.set(item.ref, item.reason);
    return map;
  }, []);

  const sourcesFor = useCallback(
    (m: EdaUIMessage | undefined): SourceItem[] => {
      if (!m) return [];
      const own = messageSources(m);
      const seen = new Set(own.map((s) => s.ref));
      const extra = citedRefs(messageText(m)).flatMap((r) => {
        const s = sourceMap.get(r);
        return s && !seen.has(r) ? [s] : [];
      });
      return [...own, ...extra];
    },
    [sourceMap],
  );

  const showSources = useCallback(
    (ref: string | null, claim = '') => {
      setActiveRef(ref);
      setActiveClaim(claim);
      // Önizleme açıkken başka çipe tıklanırsa önizleme o kaynağa geçer; kaynak listesine dönülürse kapanır.
      setPreviewRef((p) => (p !== null && ref !== null ? ref : null));
      setPanelView('sources');
      setFocusTick((n) => n + 1);
      if (!panelInline) setSheetOpen(true);
    },
    [panelInline],
  );

  const openDocument = useCallback(
    (messageId: string, index: number) => {
      setDocKey({ messageId, index });
      setPanelView('document');
      if (!panelInline) setSheetOpen(true);
    },
    [panelInline],
  );

  // Belge yazılmaya başlayınca panel kendiliğinden açılır (mesaj başına bir kez).
  useEffect(() => {
    if (!busy || !lastAssistant || autoOpenedDoc.current === lastAssistant.id) return;
    const first = documentsOf(messageText(lastAssistant))[0];
    if (!first) return;
    autoOpenedDoc.current = lastAssistant.id;
    openDocument(lastAssistant.id, first.index);
  }, [busy, lastAssistant, openDocument]);

  // Yanıt tamamlanınca belge bloğu kendiliğinden Belgeler'e kaydedilir (yanıt başına bir kez; kayıt
  // başarısız olursa sessiz kalınır, "Stüdyoda aç" düğmesi yine kaydeder).
  const wasBusy = useRef(false);
  useEffect(() => {
    const finished = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (!finished || !lastAssistant) return;
    for (const block of documentsOf(messageText(lastAssistant))) {
      if (!block.complete || block.body.trim() === '') continue;
      void saveChatDocument(
        conversationId,
        lastAssistant.id,
        block.index,
        block.title,
        block.body,
      ).catch(() => undefined);
    }
  }, [busy, lastAssistant, conversationId]);

  const docMessage = docKey ? messages.find((m) => m.id === docKey.messageId) : undefined;
  const docBlock =
    docMessage && docKey
      ? documentsOf(messageText(docMessage)).find((d) => d.index === docKey.index)
      : undefined;
  const showDocument =
    panelView === 'document' && docMessage !== undefined && docBlock !== undefined;

  // Sohbetteki her kaynak "Kaynaklar" sekmesinde görünür (ref sırasıyla); künye durumu ve atıf
  // cümlesi, kaynağa en son atıf yapan yanıttan alınır.
  const panelSources = useMemo(
    () => [...sourceMap.values()].sort((a, b) => refNumber(a.ref) - refNumber(b.ref)),
    [sourceMap],
  );
  const { panelStatuses, panelReasons, claims } = useMemo(() => {
    const st = new Map<string, KunyeStatus>();
    const rs = new Map<string, CitationReason>();
    const cl = new Map<string, string>();
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      const reasons = reasonsFor(m);
      for (const [ref, status] of statusesFor(m)) {
        st.set(ref, status);
        const reason = reasons.get(ref);
        if (reason) rs.set(ref, reason);
        else rs.delete(ref);
      }
      const text = messageText(m);
      for (const ref of citedRefs(text)) {
        const claim = claimFor(text, ref);
        if (claim !== '') cl.set(ref, claim);
      }
    }
    return { panelStatuses: st, panelReasons: rs, claims: cl };
  }, [messages, statusesFor, reasonsFor]);
  const previewSource = previewRef ? panelSources.find((s) => s.ref === previewRef) : undefined;
  const previewId = previewSource ? previewIdOf(previewSource) : null;
  const panelData: SourcesPanelData = {
    sources: panelSources,
    statuses: panelStatuses,
    reasons: panelReasons,
    activeRef,
    activeClaim,
    claims,
    preview: previewSource && previewId ? { source: previewSource, decisionId: previewId } : null,
    onPreview: setPreviewRef,
    focusTick,
  };

  const copy = useCallback(
    async (m: EdaUIMessage) => {
      const text = serializeForCopy(messageText(m), sourceMap, t('copy.sourcesHeading'));
      try {
        await navigator.clipboard.writeText(text);
        announce(t('copy.done'));
      } catch {
        announce(t('copy.failed'), { politeness: 'assertive' });
      }
    },
    [sourceMap, announce, t],
  );

  /**
   * Yanıtı Word'e aktarır: `[K#]` kayıttan render edilen künyeye döner, sonda "Kaynaklar" (portal adı,
   * erişim tarihi) ve zorunlu ibare (Y-86, Y-87) yer alır. `not_found` atıf varsa indirme yapılmaz.
   */
  const exportAnswer = useCallback(
    (m: EdaUIMessage) => {
      if (exportBlocked(messageCitations(m)?.items)) {
        announce(t('message.exportBlocked'), { politeness: 'assertive' });
        return;
      }
      const resolved = new Map(
        [...sourceMap].map(([ref, s]) => {
          const meta = sourceMeta(s);
          return [
            ref,
            {
              shortKunye: s.shortKunye,
              title: s.title,
              portal: meta.portal,
              accessDate: meta.date,
            },
          ] as const;
        }),
      );
      const labels: AnswerExportLabels = {
        title: t('message.exportTitle'),
        sourcesHeading: t('copy.sourcesHeading'),
        sourceLine: (s) => {
          const args = {
            hasTitle: s.title.trim() === '' ? 'no' : 'yes',
            kunye: s.shortKunye,
            title: s.title.trim(),
            portal: s.portal,
          };
          return s.accessDate === null
            ? t('message.exportSourceLineNoDate', args)
            : t('message.exportSourceLine', { ...args, date: s.accessDate });
        },
        disclaimers: [tl('mandatory.y86'), tl('mandatory.y87')],
      };
      try {
        const startedAt = m.metadata?.startedAt;
        const day = ISTANBUL_DAY.format(startedAt ? new Date(startedAt) : new Date());
        downloadDocx(
          labels.title,
          answerExportBlocks(messageText(m), resolved, labels),
          fileSlug(t('message.exportFileName', { date: day })),
        );
        announce(t('message.exportDone'));
      } catch {
        announce(t('message.exportFailed'), { politeness: 'assertive' });
      }
    },
    [sourceMap, sourceMeta, announce, t, tl],
  );

  /** Kullanıcı mesajı düz metin kopyalanır (kaynak başlığı yok); sonuç balondaki geri bildirime döner. */
  const copyUser = useCallback(
    async (m: EdaUIMessage): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(messageText(m));
        announce(t('copy.userDone'));
        return true;
      } catch {
        announce(t('copy.userFailed'), { politeness: 'assertive' });
        return false;
      }
    },
    [announce, t],
  );

  const copyDocument = useCallback(async () => {
    if (!docBlock) return;
    const text = serializeForCopy(
      `${docBlock.title}\n\n${docBlock.body}`,
      sourceMap,
      t('copy.sourcesHeading'),
    );
    try {
      await navigator.clipboard.writeText(text);
      announce(t('document.copied'));
    } catch {
      announce(t('copy.failed'), { politeness: 'assertive' });
    }
  }, [docBlock, sourceMap, announce, t]);

  const editTarget = editTargetOf(conversationId);
  const sendToStudio = useCallback(
    async (mode: 'new' | 'apply') => {
      if (!docBlock) return;
      setStudioBusy(true);
      setStudioError(false);
      try {
        let id: string;
        if (mode === 'apply' && editTarget) {
          await applyToDocument(editTarget, docBlock.body);
          id = editTarget.documentId;
          if (onApplied) {
            onApplied(id);
            return;
          }
        } else {
          id = docKey
            ? await saveChatDocument(
                conversationId,
                docKey.messageId,
                docKey.index,
                docBlock.title,
                docBlock.body,
              )
            : await openAsNewDocument(docBlock.title, docBlock.body);
        }
        router.push(`/belgeler/${id}`);
      } catch (err) {
        const to = authRedirectFor(err, `/sohbet/${conversationId}`);
        if (to) router.replace(to);
        else {
          setStudioError(true);
          if (err instanceof SelectionNotFoundError) announce(t('document.selectionGone'));
          else if (err instanceof ApiClientError && err.status === 403)
            announce(t('document.studioError'));
        }
      } finally {
        setStudioBusy(false);
      }
    },
    [docBlock, docKey, editTarget, conversationId, router, announce, t, onApplied],
  );

  const env = environmentNotice(messages);
  const last = messages.at(-1);
  const awaitingAssistant = busy && last?.role === 'user';

  const documentPanel =
    docBlock && docMessage ? (
      <DocumentPanel
        embedded={!panelInline}
        block={docBlock}
        streaming={busy && docMessage.id === last?.id}
        citations={{
          sources: sourceMap,
          statuses: statusesFor(docMessage),
          reasons: reasonsFor(docMessage),
          onActivate: (ref) => showSources(ref, claimFor(messageText(docMessage), ref)),
          labels: { chip: chipLabel, meta: chipMeta, unresolved: t('chip.unresolved') },
        }}
        onClose={() => setPanelView('sources')}
        onCopy={() => void copyDocument()}
        onOpenStudio={() => void sendToStudio('new')}
        {...(editTarget ? { onApplyToDocument: () => void sendToStudio('apply') } : {})}
        studioBusy={studioBusy}
        studioError={studioError}
      />
    ) : null;

  // Belge açıldıysa panel iki görünüm arasında geçiş sunar.
  const panelTabs = docBlock ? (
    <div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-3 pt-2">
      {(['document', 'sources'] as const).map((view) => (
        <button
          key={view}
          type="button"
          role="tab"
          aria-selected={panelView === view}
          onClick={() => setPanelView(view)}
          className={`rounded-t-md border-b-2 px-3 py-1.5 text-body-sm font-medium focus-visible:focus-ring ${
            panelView === view
              ? 'border-primary text-fg'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          {view === 'document' ? t('document.tabDocument') : t('document.tabSources')}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        {env && (
          <EnvironmentStrip title={t(`environment.${env}.title`)}>
            {t(`environment.${env}.body`)}
          </EnvironmentStrip>
        )}
        <h1 className="sr-only">{title ?? t('untitled')}</h1>
        <ConversationView
          label={t('conversationLabel')}
          labels={{ scrollToLatest: t('scrollToLatest') }}
          className="flex-1"
        >
          {/* `relative`: ekran okuyucu metinleri (sr-only, absolute) kaydırma kabının içinde kalır;
              aksi hâlde dış kap taşar ve ikinci kaydırma çubuğu çıkar. */}
          <div className="relative mx-auto flex w-full max-w-chat flex-col gap-6 px-4 pt-6 pb-4">
            {messages.map((m) => {
              if (m.role === 'user')
                return (
                  <UserMessage
                    key={m.id}
                    message={m}
                    onCopy={() => copyUser(m)}
                    {...(!busy && lockedId === null
                      ? { onEdit: (text: string) => editMessage(m.id, text) }
                      : {})}
                  />
                );
              if (m.role !== 'assistant') return null;
              const streaming = busy && m.id === last?.id;
              const statuses = statusesFor(m);
              const sources = sourcesFor(m);
              const citations: CitationContextValue = {
                sources: sourceMap,
                statuses,
                reasons: reasonsFor(m),
                onActivate: (ref) => showSources(ref, claimFor(messageText(m), ref)),
                labels: { chip: chipLabel, meta: chipMeta, unresolved: t('chip.unresolved') },
              };
              return (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  streaming={streaming}
                  stopped={stoppedIds.has(m.id)}
                  pipeline={streaming ? pipeline.current : (pipeline.byMessage.get(m.id) ?? null)}
                  sources={sources}
                  citations={citations}
                  onShowSources={() => showSources(null)}
                  onCopy={() => void copy(m)}
                  {...(streaming ? {} : { onExport: () => exportAnswer(m) })}
                  {...(m.id === lastAssistant?.id && !busy
                    ? { onRegenerate: () => regenerate() }
                    : {})}
                  onOpenDocument={(index) => openDocument(m.id, index)}
                  activeDocument={
                    showDocument && docKey?.messageId === m.id ? (docKey?.index ?? null) : null
                  }
                />
              );
            })}
            {awaitingAssistant && (
              <AssistantMessage
                message={null}
                streaming
                stopped={false}
                pipeline={pipeline.current}
                sources={[]}
                citations={{
                  sources: sourceMap,
                  statuses: new Map(),
                  labels: { chip: chipLabel, meta: chipMeta, unresolved: t('chip.unresolved') },
                }}
              />
            )}
          </div>
        </ConversationView>
        <div className="mx-auto flex w-full max-w-chat flex-col gap-2 px-4 pb-3">
          {lockedId && !busy && (
            <NoticeBanner
              tone="warning"
              role="status"
              action={
                <Button variant="outline" size="sm" onClick={() => void stopLocked()}>
                  {t('stop')}
                </Button>
              }
            >
              {t('locked')}
            </NoticeBanner>
          )}
          {turnError && !busy && (
            <NoticeBanner
              tone="danger"
              role="alert"
              action={
                turnError.code === 'AI_POLICY_NO_PROVIDER' ||
                turnError.code === 'QUOTA_DAILY_COST_CAP' ? (
                  <Button variant="outline" size="sm" render={<Link href="/ayarlar" />}>
                    {t('error.openSettings')}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" leadingIcon="action.retry" onClick={retry}>
                    {t('error.retry')}
                  </Button>
                )
              }
            >
              {turnError.code === 'CLIENT_NETWORK'
                ? t('error.network')
                : (turnError.message ?? t('error.generic'))}
              {turnError.requestId && (
                <span className="block text-caption">
                  {t('error.supportCode', { code: turnError.requestId })}
                </span>
              )}
            </NoticeBanner>
          )}
          <Composer
            autoFocus
            value={draft}
            onValueChange={setDraft}
            busy={busy || lockedId !== null}
            onStop={() => void (busy ? stop() : stopLocked())}
            attachments={{
              items: attachments.items,
              onAdd: attachments.add,
              onRemove: attachments.remove,
            }}
            onSubmit={(text, mode) => {
              setDraft('');
              send(text, mode, null, readyParts(attachments.items));
              attachments.clear();
            }}
          />
          <p className="text-center text-caption text-fg-subtle">{tl('mandatory.y86')}</p>
        </div>
      </div>

      {panelInline ? (
        <div
          className={`${showDocument || panelData.preview ? 'w-panel-preview' : 'w-panel-sources'} flex shrink-0 flex-col border-l border-border`}
        >
          {panelTabs}
          <div className="min-h-0 flex-1">
            {showDocument ? documentPanel : <SourcesPanel data={panelData} />}
          </div>
        </div>
      ) : (
        <Sheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={showDocument ? docBlock?.title || t('document.untitled') : t('sources.title')}
          description={
            showDocument
              ? t('document.draftNote')
              : t('sources.count', { count: panelData.sources.length })
          }
          labels={{ close: showDocument ? t('document.close') : t('sources.close') }}
        >
          {panelTabs}
          <div className="p-3">
            {showDocument ? documentPanel : <SourcesList data={panelData} />}
          </div>
        </Sheet>
      )}
    </div>
  );
}
