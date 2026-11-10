// Sohbet turu (022 §3, §5): kapı → aşama olayları → araç döngüsü → akış filtresi → künye eşleştirme →
// kalıcılık. Akış öncesi hatalar JSON zarfıyla (AppError); akış içi hatalar `error` parçası + durum.

import {
  buildAttachmentBlock,
  buildFollowupBlock,
  buildToolSet,
  chatInstructions,
  checkCitationQuotes,
  createKvkkMasker,
  EMPTY_DICTIONARY,
  type Gateway,
  GatewayDenied,
  type MaskerPort,
  MemoryRefStore,
  newTurnBudget,
  pickScenario,
  type QuoteTextMemory,
  type SourceBackend,
  type SourceRecord,
  type ToolContext,
  turnFrame,
} from '@eda/ai';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import { scopeFromRequest, scopePromptLabel } from '@eda/contracts/scope';
import type { ChatTurnRequest, MessageMetadata, SourceItem } from '@eda/contracts/stream';
import { nodeKvkkCrypto } from '@eda/crypto/kvkk-port';
import { detectDocumentIntent } from '@eda/legal/intent';
import type { EdaLogger } from '@eda/observability/logger';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import type { PlatformKeyGate } from '../services/ai-keys/platform-gate.ts';
import type { ChatAttachments, ResolvedAttachment } from '../services/chat/attachments.ts';
import { verifyCitations } from './citations.ts';
import { withHeartbeat } from './heartbeat.ts';
import type {
  ActiveTurns,
  ChatActor,
  ChatPersistence,
  ChatSession,
  RegeneratedTurnRecord,
  TurnRecord,
} from './persistence.ts';

export type ChatDeps = {
  gateway: Gateway;
  backend: SourceBackend;
  persistence: ChatPersistence;
  active: ActiveTurns;
  pseudonymKey: Uint8Array;
  logger: EdaLogger;
  /** Mock senaryo önekine izin (yalnız development/test, 020 §15.2). */
  allowScenarioPrefix: boolean;
  /**
   * Kurum/kullanıcı API anahtarı çözücüsü (#54 BYOK). Verilmezse (kimliksiz dilim) sunucunun ortak
   * geliştirme anahtarı kullanılır. Verilirse ve anahtar yoksa tur başlamaz: platform anahtarına
   * sessiz düşme yoktur.
   */
  resolveApiKey?: (
    actor: ChatActor,
  ) => Promise<
    { apiKey: string; source?: 'org' | 'own' | 'platform' } | { missing: 'org' | 'own' }
  >;
  /**
   * Platform ortak anahtarı kapısı. Anahtar kaynağı `platform` ise tur öncesi kullanıcı/büro
   * limitleri denetlenir ve tur sonunda kullanım yazılır. Kaynak `platform` iken bu alan yoksa tur
   * başlamaz (fail-closed): sınırsız ortak anahtar kullanımı olmaz.
   */
  platformKey?: PlatformKeyGate;
  /**
   * Sohbet eki çözücüsü (P21 ilk dilimi). Yalnız kimlik zinciri kuruluyken (RLS) bağlanır;
   * yoksa ekli tur reddedilir (ek sessizce düşürülmez).
   */
  attachments?: ChatAttachments;
  uuid: () => string;
};

/** Kullanıcı mesajındaki ek parçası (K4): bayt yok, yalnız kimlik; `data-*` parçası değildir. */
export const ATTACHMENT_URL_PREFIX = 'eda-file:';

function attachmentIdsOf(message: UIMessage | undefined): string[] {
  if (message === undefined) return [];
  return message.parts.flatMap((p) =>
    p.type === 'file' && p.url.startsWith(ATTACHMENT_URL_PREFIX)
      ? [p.url.slice(ATTACHMENT_URL_PREFIX.length)]
      : [],
  );
}

/** Ek kaynağı (K6): `source_key = file:<id>`, köken `user`; evrak adı yalnız `title`'da (UI). */
function attachmentSource(a: ResolvedAttachment, ordinal: number, ref: string): SourceRecord {
  const pages = a.pageCount === null ? '' : `, ${a.pageCount} sayfa`;
  return {
    ref,
    kind: 'case_file',
    sourceKey: `file:${a.fileId}`,
    sourceId: a.fileId,
    shortKunye: `Ek ${ordinal} (${a.fileType.toUpperCase()}${pages})`,
    title: a.name,
    retrievedAt: a.uploadedOn,
    fetchedAt: new Date().toISOString(),
    relevance: 'high',
    excerpt: a.text.slice(0, EXCERPT_CHARS),
  };
}

/** Kaynak paneli önizlemesi (SourceItem.excerpt üst sınırı). */
const EXCERPT_CHARS = 12000;

const NOTICE_TEXT = {
  simulation: 'Simülasyon: yanıtlar örnek senaryodan üretilir, gerçek yapay zekâ kullanılmaz.',
  beta_synthetic:
    'Pilot sürüm: gerçek müvekkil bilgisi girmeyin; yalnız sentetik (uydurma) veri kullanın.',
} as const;

function maskingNoticeText(count: number): string {
  return `${count} kişisel veri maskelendi.`;
}

function previewMaskedCount(masker: MaskerPort, text: string): number {
  try {
    return masker.mask([{ role: 'user', content: [{ type: 'text', text }] }]).maskedCount;
  } catch {
    return 0;
  }
}

function toSourceItem(r: SourceRecord): SourceItem {
  return {
    ref: r.ref,
    kind: r.kind,
    sourceId: r.sourceId,
    shortKunye: r.shortKunye,
    title: r.title,
    origin: r.kind === 'case_file' ? 'user' : 'live',
    ...(r.portal ? { portal: r.portal } : {}),
    ...(r.decision ? { courtType: r.decision.court_type } : {}),
    retrievedAt: r.retrievedAt,
    ...(r.fetchedAt ? { fetchedAt: r.fetchedAt } : {}),
    ...(r.url ? { url: r.url } : {}),
    relevance: r.relevance,
    ...(r.excerpt ? { excerpt: r.excerpt } : {}),
  };
}

/** UI akış filtresi (022 §5.2): araç ve kaynak parçaları atılır; start/finish yalnız tur işleyicisinden. */
function filterModelChunks(
  onSynthesis: (status: 'started' | 'skipped') => void,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  let synthesizing = false;
  return new TransformStream({
    transform(chunk, controller) {
      const t = chunk.type;
      // Metinden sonra araç çağrısı: o metin ara nottu, sentez değil.
      if (t.startsWith('tool-input') && synthesizing) {
        synthesizing = false;
        onSynthesis('skipped');
      }
      if (t.startsWith('tool-') || t.startsWith('source-') || t === 'file') return;
      if (t === 'start' || t === 'finish' || t === 'message-metadata') return;
      if (t.startsWith('reasoning')) return;
      if (t === 'text-start' && !synthesizing) {
        synthesizing = true;
        onSynthesis('started');
      }
      controller.enqueue(chunk);
    },
  });
}

function textOfMessage(message: UIMessage): string {
  return message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

/** `index`'ten itibaren kesilen asistan yanıtlarının transkript katkısı (sondan kırpılacak sayı). */
function cutLlmCount(session: ChatSession, index: number): number {
  let count = 0;
  for (const m of session.ui.slice(index)) {
    if (m.role === 'assistant') count += session.llmCounts.get(m.id) ?? 0;
  }
  return count;
}

function lastAssistantText(messages: UIMessage[]): string {
  const msg = messages.at(-1);
  return msg && msg.role === 'assistant' ? textOfMessage(msg) : '';
}

/**
 * Kalıcı kaynak etiketlerini KENDİ numaralarıyla geri yükler (025 §4.1; P12): `[K#]` sohbetin DB
 * kaydıdır, etiket bir kez verilir ve değişmez. Yeniden yüklemede eski kaynak eski etiketini alır,
 * bu turda ilk kez görülen kaynak en büyük etiketin üstünden devam eder; böylece eski bir `[K#]`
 * başka bir kaynağa kaymaz.
 */
export function restoreRefs(sources: readonly SourceRecord[]): MemoryRefStore {
  const refs = new MemoryRefStore();
  for (const rec of sources) refs.restore(rec);
  return refs;
}

export async function runTurn(
  deps: ChatDeps,
  actor: ChatActor,
  conversationId: string,
  req: ChatTurnRequest,
  requestId: string,
): Promise<Response> {
  const session = await deps.persistence.load(actor, conversationId);
  if (!session) throw new AppError('CHAT_CONVERSATION_NOT_FOUND');
  const running = deps.active.get(conversationId);
  if (running) {
    throw new AppError('CHAT_STREAM_IN_PROGRESS', { meta: { messageId: running.messageId } });
  }
  /**
   * Yeniden üretim (022 §2.1): yalnız sohbetin SON asistan yanıtı hedeflenebilir ve hedef gerçekten
   * son mesaj olmalıdır. Kullanıcı mesajı yeniden yazılmaz; eski yanıt transkriptten düşer, tur aynı
   * kullanıcı mesajıyla yeniden koşar.
   */
  const regenerating = req.trigger === 'regenerate-message';
  const submitMessage = regenerating ? null : req.message;
  const targetIndex = regenerating ? session.ui.findLastIndex((m) => m.role === 'assistant') : -1;
  const target = targetIndex >= 0 ? (session.ui[targetIndex] ?? null) : null;
  const regenerateUserIndex = regenerating
    ? session.ui.slice(0, targetIndex).findLastIndex((m) => m.role === 'user')
    : -1;
  const regenerateUser =
    regenerateUserIndex >= 0 ? (session.ui[regenerateUserIndex] ?? undefined) : undefined;
  const validRegenerate =
    regenerating &&
    target !== null &&
    targetIndex === session.ui.length - 1 &&
    regenerateUser !== undefined &&
    (req.regenerateMessageId === null || req.regenerateMessageId === target.id);
  if (regenerating ? !validRegenerate : submitMessage === null) {
    throw new AppError('VALIDATION_FAILED', {
      fields: [
        { path: regenerating ? 'body.regenerateMessageId' : 'body.trigger', issue: 'not_allowed' },
      ],
    });
  }
  /**
   * Mesaj düzenleme: `replaceFromMessageId` sohbetteki bir KULLANICI mesajını hedefler; o mesaj ve
   * sonrasındaki tüm mesajlar bağlamdan ve (tur yazılırken) transkriptten düşer; yeni mesaj yeni tur
   * olarak koşar (maskeleme, veri sınıfı kapısı ve kota aynen uygulanır). Hedef yoksa veya kullanıcı
   * mesajı değilse istek reddedilir.
   */
  const replaceFrom = req.replaceFromMessageId;
  const replaceIndex =
    replaceFrom !== null ? session.ui.findIndex((m) => m.id === replaceFrom) : -1;
  if (replaceFrom !== null && (replaceIndex === -1 || session.ui[replaceIndex]?.role !== 'user')) {
    throw new AppError('VALIDATION_FAILED', {
      fields: [{ path: 'body.replaceFromMessageId', issue: 'not_allowed' }],
    });
  }
  const refs = restoreRefs(session.sources);
  const knownRefs = new Set(refs.all().map((r) => r.ref));
  const conv = {
    id: session.id,
    title: session.title,
    dataClass: session.dataClass,
    refs,
    // Yeniden üretimde eski yanıtın model mesajları bağlamdan düşer; düzenlemede kesilen her yanıtın
    // transkript katkısı sondan kırpılır.
    llm: regenerating
      ? session.llm.slice(0, session.llm.length - (session.lastAssistant?.llmCount ?? 0))
      : replaceIndex !== -1
        ? session.llm.slice(0, session.llm.length - cutLlmCount(session, replaceIndex))
        : [...session.llm],
    // `ui` akışın `originalMessages` temelidir: yeniden üretimde hedef yanıt VE yeniden
    // gönderilecek kullanıcı mesajı çıkarılır (mesaj tekrarı olmaz); düzenlemede hedef ve sonrası.
    ui: regenerating
      ? session.ui.slice(0, regenerateUserIndex)
      : replaceIndex !== -1
        ? session.ui.slice(0, replaceIndex)
        : [...session.ui],
  };
  let turnLlm: ModelMessage[] = [];

  const incoming =
    submitMessage !== null
      ? { id: submitMessage.id, text: submitMessage.parts[0].text }
      : regenerateUser !== undefined
        ? { id: regenerateUser.id, text: textOfMessage(regenerateUser) }
        : null;
  if (incoming === null) {
    throw new AppError('VALIDATION_FAILED', {
      fields: [{ path: 'body.trigger', issue: 'not_allowed' }],
    });
  }
  let userText = incoming.text;
  let scenario: string | null = null;
  if (deps.allowScenarioPrefix && !regenerating) {
    const picked = pickScenario(userText);
    scenario = picked.scenario;
    userText = picked.text || userText;
  }
  // Yeniden üretimde tur modu kullanıcı mesajının meta verisinden gelir (dilekçe turu korunur).
  const turnMode = regenerating
    ? ((regenerateUser?.metadata as MessageMetadata | undefined)?.mode ?? req.mode)
    : req.mode;

  // Sohbet ekleri (P21 ilk dilimi): gönderimde istekten, yeniden üretimde kullanıcı mesajındaki ek
  // parçalarından. Akış öncesi çözülür; hatalar JSON zarfıyla döner (sağlayıcı çağrısı yok).
  const attachmentIds = regenerating ? attachmentIdsOf(regenerateUser) : req.attachments;
  let attachments: ResolvedAttachment[] = [];
  if (attachmentIds.length > 0) {
    if (deps.attachments === undefined) {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ path: 'body.attachments', issue: 'not_allowed' }],
      });
    }
    attachments = await deps.attachments.resolve(actor, conversationId, attachmentIds);
  }
  // Sohbette daha önce eklenen ekler (konuşma geneli sıra numarası ve takip sorusu bağlamı için).
  const priorIds = [
    ...new Set(conv.ui.flatMap((m) => (m.role === 'user' ? attachmentIdsOf(m) : []))),
  ];
  const currentIds = new Set(attachments.map((a) => a.fileId));
  // Takip sorusu: önceki turda kısmi verilen uzun ekten bu soruyla ilgili bölümler (hata fırlatmaz).
  const followups =
    deps.attachments !== undefined && priorIds.some((id) => !currentIds.has(id))
      ? await deps.attachments.resolveBound(
          actor,
          conversationId,
          priorIds.filter((id) => !currentIds.has(id)),
        )
      : [];
  const ordinalOf = (fileId: string, fallback: number): number => {
    const i = priorIds.indexOf(fileId);
    return i >= 0 ? i + 1 : fallback;
  };
  const origins: ('user_text' | 'attachment')[] =
    attachments.length > 0 || followups.length > 0 ? ['user_text', 'attachment'] : ['user_text'];

  // Anahtar kaynağı (#54): yoksa tur başlamaz; gerçek sağlayıcı çağrısı yalnız bu anahtarla yapılır.
  let turnApiKey: string | null = null;
  let keySource: 'org' | 'own' | 'platform' | null = null;
  if (deps.resolveApiKey !== undefined && !deps.gateway.usesMock()) {
    const resolved = await deps.resolveApiKey(actor);
    if ('missing' in resolved) {
      throw new AppError('AI_POLICY_NO_PROVIDER', {
        reason: resolved.missing === 'org' ? 'org_key_missing' : 'own_key_missing',
        actions: ['notify_org_admin'],
      });
    }
    turnApiKey = resolved.apiKey;
    keySource = resolved.source ?? null;
    // Ortak anahtar yalnız limit kapısıyla birlikte kullanılır; kapı yoksa fail-closed.
    if (keySource === 'platform' && deps.platformKey === undefined) {
      throw new AppError('AI_POLICY_NO_PROVIDER', {
        reason: 'org_key_missing',
        actions: ['notify_org_admin'],
      });
    }
  }

  let plan: ReturnType<Gateway['plan']>;
  try {
    plan = deps.gateway.plan({
      gate: {
        alias: req.alias,
        origins,
        conversationClass: conv.dataClass,
        publicModeDeclared: false,
      },
    });
  } catch (e) {
    if (e instanceof GatewayDenied) {
      throw new AppError('AI_POLICY_NO_PROVIDER', { reason: 'no_provider_for_class' });
    }
    throw e;
  }

  // Yeniden üretimde yanıt yerinde güncellenir: mesaj kimliği korunur (kaynak bağları ve istemci
  // eşleşmesi bozulmaz). Normal turda yeni kimlik üretilir.
  const assistantId = target !== null ? target.id : deps.uuid();
  // Ortak anahtar turu: sınırlar burada denetlenir (aşımda tur başlamaz) ve atomik rezervasyon yazılır. Reddedilirse akış ve `active` kaydı
  // henüz oluşmamıştır: sohbet kilitlenmez (D-1).
  const platformTurn =
    keySource === 'platform' && deps.platformKey !== undefined
      ? await deps.platformKey.begin(actor, {
          modelAlias: req.alias,
          conversationId,
          requestId,
        })
      : null;
  try {
    const controller = new AbortController();
    deps.active.set(conversationId, { messageId: assistantId, controller });
    const startedAt = Date.now();
    // Sözlük (clients/case_parties) P09b'de DictionaryProvider ile bağlanır; dilimde sohbet büro/dava
    // kaydına bağlı değildir: tasarım gereği boş sözlük, desen ve sezgi algılayıcıları çalışır.
    const masker = createKvkkMasker({
      crypto: nodeKvkkCrypto,
      pseudonymKey: deps.pseudonymKey,
      scopeId: conv.id,
      dictionary: EMPTY_DICTIONARY,
    });
    const userMessage: UIMessage = {
      id: incoming.id,
      role: 'user',
      parts: [
        { type: 'text', text: userText },
        ...attachments.map((a) => ({
          type: 'file' as const,
          mediaType: a.mimeType,
          filename: a.name,
          url: `${ATTACHMENT_URL_PREFIX}${a.fileId}`,
        })),
      ],
      metadata: { mode: turnMode } satisfies MessageMetadata,
    };
    if (conv.title === null) conv.title = userText.slice(0, 80);

    // Ek kaynakları (`[K#]` bir kez verilir; aynı ek sonraki turda aynı etiketi alır).
    let fresh = priorIds.filter((id) => !currentIds.has(id)).length;
    const ordinals = attachments.map((a) => {
      if (priorIds.includes(a.fileId)) return ordinalOf(a.fileId, 0);
      fresh += 1;
      return fresh;
    });
    const attachmentRefs = attachments.map((a, i) =>
      conv.refs.allocate(`file:${a.fileId}`, (ref) =>
        attachmentSource(a, ordinals[i] ?? i + 1, ref),
      ),
    );
    const attachmentBlock = await buildAttachmentBlock(
      attachments.map((a, i) => ({
        ref: attachmentRefs[i]?.ref ?? '',
        ordinal: ordinals[i] ?? i + 1,
        fileType: a.fileType,
        pageCount: a.pageCount,
        text: a.text,
        pageOffsets: a.pageOffsets,
      })),
      { query: userText },
    );
    const followupRefs = followups.map((a, i) =>
      conv.refs.allocate(`file:${a.fileId}`, (ref) =>
        attachmentSource(a, ordinalOf(a.fileId, i + 1), ref),
      ),
    );
    const followupBlock = await buildFollowupBlock(
      followups.map((a, i) => ({
        ref: followupRefs[i]?.ref ?? '',
        ordinal: ordinalOf(a.fileId, i + 1),
        fileType: a.fileType,
        pageCount: a.pageCount,
        text: a.text,
        pageOffsets: a.pageOffsets,
      })),
      { query: userText },
    );
    const contextBlock = [attachmentBlock.text, followupBlock.text]
      .filter((t) => t !== '')
      .join('\n');

    const documentIntent = detectDocumentIntent(userText).intent;
    const frame = turnFrame({
      documentIntent,
      modeLabel: turnMode === 'petition' ? 'Dilekçe' : 'Müvekkil işi',
      scopeLabel: scopePromptLabel(scopeFromRequest(req.scope)),
      sources: conv.refs.all(),
      userText,
    });
    // Ek metni ayrı parçadır: maskeleme ara katmanı onu `attachment` köken politikasıyla işler.
    const userModelMessage: ModelMessage =
      contextBlock !== ''
        ? {
            role: 'user',
            content: [
              {
                type: 'text',
                text: contextBlock,
                providerOptions: { eda: { origin: 'attachment' } },
              },
              { type: 'text', text: frame },
            ],
          }
        : { role: 'user', content: frame };

    const turnUsage: {
      value: PromiseLike<{
        inputTokens: number | undefined;
        outputTokens: number | undefined;
      }> | null;
    } = { value: null };

    const stream = createUIMessageStream<UIMessage>({
      originalMessages: [...conv.ui, userMessage],
      generateId: () => assistantId,
      execute: async ({ writer }) => {
        const meta: MessageMetadata = {
          alias: req.alias,
          providerId: plan.badge.providerId,
          region: plan.badge.region,
          modelLabel: plan.badge.modelLabel,
          dataClass: plan.badge.dataClass,
          thinking: plan.badge.thinking,
          status: 'streaming',
          requestId,
          startedAt,
          ...(keySource !== null ? { keySource } : {}),
        };
        writer.write({ type: 'start', messageId: assistantId, messageMetadata: meta });
        for (const code of plan.badge.notices) {
          writer.write({
            type: 'data-notice',
            id: `notice:${code}`,
            data: { code, level: 'info', message: NOTICE_TEXT[code] },
          });
        }

        // Maskeleme göstergesi (022 S3, 026 §9.7): yeni kullanıcı içeriğindeki varlık sayısı önizlenir;
        // asıl maskeleme geçitte yapılır. Önizleme hatası bildirimi düşürür, tur geçitte fail-closed kalır.
        const maskedCount = previewMaskedCount(masker, userText);
        if (maskedCount > 0) {
          writer.write({
            type: 'data-notice',
            id: 'notice:masking_applied',
            data: {
              code: 'masking_applied',
              level: 'info',
              message: maskingNoticeText(maskedCount),
              meta: { count: maskedCount },
            },
          });
        }

        const turnRefs = new Set<string>([
          ...attachmentRefs.map((r) => r.ref),
          ...followupRefs.filter((r) => followupBlock.partial.includes(r.ref)).map((r) => r.ref),
        ]);
        // Alıntı denetimi tur belleği (025 §6.5): yalnız bu süreçte, tur boyunca yaşar.
        const quoteTexts: QuoteTextMemory = new Map();
        if (turnRefs.size > 0) {
          writer.write({
            type: 'data-sources',
            id: 'sources',
            data: {
              sources: [...turnRefs].flatMap((r) => {
                const rec = conv.refs.byRef(r);
                return rec ? [toSourceItem(rec)] : [];
              }),
            },
          });
        }
        if (attachmentBlock.partial.length > 0) {
          writer.write({
            type: 'data-notice',
            id: 'notice:context_compacted',
            data: {
              code: 'context_compacted',
              level: 'info',
              message:
                'Ek uzun olduğu için yalnız başı, sonu ve sorunuzla ilgili bölümleri kullanıldı.',
            },
          });
        }
        const ctx: ToolContext = {
          backend: deps.backend,
          refs: conv.refs,
          budget: newTurnBudget(),
          turnRefs,
          today: new Date().toISOString().slice(0, 10),
          scope: { sources: req.scope.sources, courtTypes: req.scope.courtTypes },
          documentIntent,
          petitionMode: turnMode === 'petition',
          quoteTexts,
          emit: (e) => {
            if (e.type === 'pipeline') {
              writer.write({ type: 'data-pipeline', transient: true, data: e.data });
            } else if (e.type === 'sources') {
              writer.write({
                type: 'data-sources',
                id: 'sources',
                data: {
                  sources: e.turnRefs.flatMap((r) => {
                    const rec = conv.refs.byRef(r);
                    return rec ? [toSourceItem(rec)] : [];
                  }),
                },
              });
            } else {
              writer.write({
                type: 'data-notice',
                id: `notice:${e.code}`,
                data: { code: e.code, level: 'warning', message: e.message },
              });
            }
          },
        };

        const result = deps.gateway.streamTurn(
          {
            gate: {
              alias: req.alias,
              origins,
              conversationClass: conv.dataClass,
              publicModeDeclared: false,
            },
            orgId: null,
            masker,
            instructions: chatInstructions(),
            messages: [...conv.llm, userModelMessage],
            tools: buildToolSet(ctx, { strict: plan.candidate.model.capabilities.strictTools }),
            mockScenario: scenario,
            abortSignal: controller.signal,
            anthropicApiKey: turnApiKey,
          },
          plan.candidate,
        );
        turnUsage.value = result.totalUsage;

        writer.merge(
          result
            .toUIMessageStream({
              sendStart: false,
              sendFinish: false,
              sendReasoning: false,
              sendSources: false,
            })
            .pipeThrough(
              filterModelChunks((status) =>
                writer.write({
                  type: 'data-pipeline',
                  transient: true,
                  data: { stage: 'synthesis', status, label: 'Cevap oluşturuluyor' },
                }),
              ),
            ),
        );

        const text = await result.text;
        writer.write({
          type: 'data-pipeline',
          transient: true,
          data: { stage: 'verification', status: 'started', label: 'Künyeler doğrulanıyor' },
        });
        // Alıntı denetimi (025 §6): kanıt yoksa durum değişmez; log yalnız sayı taşır (içerik yok).
        const quotes = await checkCitationQuotes({
          text,
          refs: conv.refs,
          memory: quoteTexts,
          backend: deps.backend,
          signal: controller.signal,
        });
        if (quotes.checked + quotes.unchecked > 0) {
          deps.logger.info(
            {
              event: 'chat.citation.quote_check',
              requestId,
              checked: quotes.checked,
              unchecked: quotes.unchecked,
              mismatched: quotes.mismatched.size,
            },
            'alıntı denetimi',
          );
        }
        writer.write({
          type: 'data-citations',
          id: 'citations',
          data: { final: true, citations: verifyCitations(text, conv.refs, quotes.mismatched) },
        });
        writer.write({
          type: 'data-pipeline',
          transient: true,
          data: { stage: 'synthesis', status: 'done', label: 'Yanıt tamamlandı' },
        });
        turnLlm = [userModelMessage, ...(await result.responseMessages)];
        writer.write({ type: 'message-metadata', messageMetadata: { status: 'complete' } });
        writer.write({ type: 'finish' });
      },
      onError: (error) => {
        deps.logger.warn({ event: 'chat.turn.error', requestId, err: error }, 'sohbet turu hatası');
        return controller.signal.aborted
          ? 'Yanıt durduruldu.'
          : 'Yanıt üretilirken bir sorun oluştu. Yeniden deneyin; sorun sürerse destek koduyla bize yazın.';
      },
      onFinish: async ({ messages }) => {
        deps.active.clear(conversationId);
        const last = messages.at(-1);
        const assistant = last?.role === 'assistant' ? last : null;
        const empty = assistant === null || lastAssistantText(messages) === '';
        const aborted = controller.signal.aborted;
        const keepAssistant = assistant !== null && !(aborted && empty);
        const status: TurnRecord['assistantStatus'] = aborted
          ? 'stopped'
          : (assistant?.metadata as MessageMetadata | undefined)?.status === 'complete'
            ? 'complete'
            : 'error';
        const newSources = conv.refs.all().filter((r) => !knownRefs.has(r.ref));
        if (platformTurn !== null) {
          // Kapanış hatası turu bozmaz; kapı kendi içinde loglar ve rezervasyon kotayı korur. Token sayısı
          // gelmezse 0 verilir (kapı rezerve edilen tahmini maliyeti korur; yalnız hata ile biten tur iade edilir).
          const usage = await Promise.race([
            Promise.resolve(turnUsage.value).catch(() => null),
            new Promise<null>((r) => setTimeout(() => r(null), 2000)),
          ]);
          await platformTurn.finish({
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            status: aborted ? 'stopped' : status === 'complete' ? 'success' : 'error',
          });
        }
        try {
          if (target !== null) {
            // Boş/durdurulmuş yeniden üretim hiçbir şey yazmaz: eski yanıt korunur.
            if (keepAssistant && assistant !== null) {
              const replaced: RegeneratedTurnRecord = {
                assistantMessage: assistant,
                assistantStatus: status,
                llm: turnLlm,
                newSources,
                alias: req.alias,
                requestId,
              };
              await deps.persistence.replaceTurn(actor, conversationId, target.id, replaced);
            }
          } else {
            const record: TurnRecord = {
              title: conv.title,
              userMessage,
              assistantMessage: keepAssistant ? assistant : null,
              assistantStatus: status,
              llm: keepAssistant ? turnLlm : [],
              newSources,
              alias: req.alias,
              requestId,
              replaceFromMessageId: replaceFrom,
            };
            await deps.persistence.saveTurn(actor, conversationId, record);
          }
        } catch (err) {
          deps.logger.error(
            { event: 'chat.turn.persist_failed', requestId, err },
            'sohbet kaydedilemedi',
          );
        }
      },
    });

    const response = createUIMessageStreamResponse({
      stream,
      headers: {
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
        'x-request-id': requestId,
      },
    });
    const body = response.body;
    if (!body) return response;
    return new Response(withHeartbeat(body, CONFIG_DEFAULTS['chat.heartbeatSec'] * 1000), {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    // Akış kurulamadan başarısız tur: etkin tur kaydı ve rezervasyon her yolda serbest kalır.
    deps.active.clear(conversationId);
    await platformTurn?.finish({ inputTokens: 0, outputTokens: 0, status: 'error' });
    throw err;
  }
}

export function stopTurn(deps: ChatDeps, conversationId: string, messageId: string) {
  const running = deps.active.get(conversationId);
  if (running?.messageId === messageId) {
    running.controller.abort();
    return { status: 'stopped' as const };
  }
  return { status: 'complete' as const };
}
