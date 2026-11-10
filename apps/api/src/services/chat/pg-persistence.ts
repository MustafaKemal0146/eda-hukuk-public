// PostgreSQL sohbet kalıcılığı (P09): tüm erişim `withTenant` işlemidir; kullanıcıya ait olmayan sohbet
// "bulunamadı" döner (varlık sızdırılmaz). Mesaj içeriği günlüğe/span'a yazılmaz.
import type { SourceRecord } from '@eda/ai';
import type { TenantTx } from '@eda/db';
import { tr_fold } from '@eda/legal/text';
import type { ModelMessage, UIMessage } from 'ai';
import type {
  ChatActor,
  ChatPersistence,
  ChatSession,
  ChatSummary,
  RegeneratedTurnRecord,
  TurnRecord,
} from '../../chat/persistence.ts';
import {
  deleteConversation,
  getConversation,
  insertConversation,
  insertMessage,
  insertSource,
  listConversations,
  listMessages,
  listSources,
  retireMessagesFrom,
  touchConversation,
  updateAssistantMessage,
} from '../../repositories/chat/chat.ts';

export interface ChatDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
}

const LIST_LIMIT = 50;

function metaOf(m: UIMessage): Record<string, unknown> {
  return (m.metadata ?? {}) as Record<string, unknown>;
}

function uiMessageOf(row: {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: unknown;
  metadata: unknown;
}): UIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: (Array.isArray(row.parts) ? row.parts : []) as UIMessage['parts'],
    ...(row.metadata && typeof row.metadata === 'object' && Object.keys(row.metadata).length > 0
      ? { metadata: row.metadata }
      : {}),
  } as UIMessage;
}

export class PgChatPersistence implements ChatPersistence {
  readonly kind = 'pg' as const;
  readonly #db: ChatDb;

  constructor(db: ChatDb) {
    this.#db = db;
  }

  async create(actor: ChatActor, id: string): Promise<void> {
    await this.#db.withTenant(actor, (tx) => insertConversation(tx, actor.orgId, actor.userId, id));
  }

  async remove(actor: ChatActor, id: string): Promise<'deleted' | 'not_found' | 'legal_hold'> {
    return this.#db.withTenant(actor, (tx) =>
      deleteConversation(tx, actor.orgId, actor.userId, id),
    );
  }

  async list(actor: ChatActor): Promise<ChatSummary[]> {
    const rows = await this.#db.withTenant(actor, (tx) =>
      listConversations(tx, actor.orgId, actor.userId, LIST_LIMIT),
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async load(actor: ChatActor, id: string): Promise<ChatSession | null> {
    return this.#db.withTenant(actor, async (tx) => {
      const conv = await getConversation(tx, actor.orgId, actor.userId, id);
      if (!conv) return null;
      const [msgs, srcs] = await Promise.all([
        listMessages(tx, actor.orgId, id),
        listSources(tx, actor.orgId, id),
      ]);
      const llm: ModelMessage[] = [];
      // Son asistan satırının transkript katkısı yeniden üretimde kırpılır (022 §2.1); mesaj
      // düzenlemede kesilen her yanıtın katkısı `llmCounts` ile kırpılır.
      let lastAssistant: ChatSession['lastAssistant'] = null;
      const llmCounts = new Map<string, number>();
      for (const m of msgs) {
        if (m.role !== 'assistant') continue;
        // `llm_parts` bayt kararlı `json`: sürücü ham metin döndürebilir (030 Tuzak 9).
        let parts: unknown = m.llmParts;
        if (typeof parts === 'string') {
          try {
            parts = JSON.parse(parts);
          } catch {
            parts = null;
          }
        }
        const own = Array.isArray(parts) ? (parts as ModelMessage[]) : [];
        llm.push(...own);
        lastAssistant = { messageId: m.id, llmCount: own.length };
        llmCounts.set(m.id, own.length);
      }
      return {
        id: conv.id,
        title: conv.title,
        dataClass: conv.dataClass,
        ui: msgs.filter((m) => m.role !== 'system').map(uiMessageOf),
        llm,
        sources: srcs.map((s) => s.snapshot as SourceRecord),
        lastAssistant,
        llmCounts,
      };
    });
  }

  async saveTurn(actor: ChatActor, id: string, turn: TurnRecord): Promise<void> {
    await this.#db.withTenant(actor, async (tx) => {
      const conv = await getConversation(tx, actor.orgId, actor.userId, id, true);
      if (!conv) return;
      // Düzenleme: hedef ve sonrası aynı işlemde transkriptten düşer; yeni tur peşine yazılır.
      const from = turn.replaceFromMessageId ?? null;
      if (from !== null) await retireMessagesFrom(tx, actor.orgId, id, from);
      const um = turn.userMessage;
      await insertMessage(tx, actor.orgId, id, {
        id: um.id,
        role: 'user',
        status: 'complete',
        userId: actor.userId,
        parts: um.parts,
        metadata: metaOf(um),
        llmParts: null,
        modelAlias: null,
        providerId: null,
        modelId: null,
        region: null,
        dataClass: null,
        thinking: null,
        requestId: turn.requestId,
        replyToMessageId: null,
      });
      if (turn.assistantMessage) {
        const am = turn.assistantMessage;
        const meta = metaOf(am);
        const str = (k: string): string | null =>
          typeof meta[k] === 'string' ? (meta[k] as string) : null;
        await insertMessage(tx, actor.orgId, id, {
          id: am.id,
          role: 'assistant',
          status: turn.assistantStatus,
          userId: null,
          parts: am.parts,
          metadata: meta,
          llmParts: turn.llm,
          modelAlias: turn.alias,
          providerId: str('providerId'),
          modelId: str('modelLabel'),
          region: str('region'),
          dataClass: str('dataClass'),
          thinking: str('thinking'),
          requestId: turn.requestId,
          replyToMessageId: um.id,
        });
        for (const s of turn.newSources) {
          const refNo = Number(s.ref.slice(1));
          if (Number.isInteger(refNo) && refNo >= 1) {
            await insertSource(tx, actor.orgId, id, am.id, {
              refNo,
              kind: s.kind,
              sourceKey: s.sourceKey,
              snapshot: s,
            });
          }
        }
      }
      const nextLabel = 1 + Math.max(0, ...turn.newSources.map((s) => Number(s.ref.slice(1)) || 0));
      await touchConversation(tx, actor.orgId, id, {
        title: turn.title,
        titleFold: turn.title === null ? null : tr_fold(turn.title),
        nextSourceLabel: nextLabel,
        alias: turn.alias,
      });
    });
  }

  async replaceTurn(
    actor: ChatActor,
    id: string,
    targetMessageId: string,
    turn: RegeneratedTurnRecord,
  ): Promise<void> {
    await this.#db.withTenant(actor, async (tx) => {
      const conv = await getConversation(tx, actor.orgId, actor.userId, id, true);
      if (!conv) return;
      // Yanıt yerinde güncellenir: mesaj kimliği korunur, ona bağlı `[K#]` kaynakları değişmez.
      const am = turn.assistantMessage;
      const meta = metaOf(am);
      const str = (k: string): string | null =>
        typeof meta[k] === 'string' ? (meta[k] as string) : null;
      await updateAssistantMessage(tx, actor.orgId, id, targetMessageId, {
        parts: am.parts,
        metadata: meta,
        llmParts: turn.llm,
        status: turn.assistantStatus,
        modelAlias: turn.alias,
        providerId: str('providerId'),
        modelId: str('modelLabel'),
        region: str('region'),
        dataClass: str('dataClass'),
        thinking: str('thinking'),
        requestId: turn.requestId,
      });
      // Turda ilk kez etiket alan kaynaklar aynı mesaja bağlanır; etiketler bir kez verilir.
      for (const s of turn.newSources) {
        const refNo = Number(s.ref.slice(1));
        if (Number.isInteger(refNo) && refNo >= 1) {
          await insertSource(tx, actor.orgId, id, targetMessageId, {
            refNo,
            kind: s.kind,
            sourceKey: s.sourceKey,
            snapshot: s,
          });
        }
      }
      // Başlık ve etiket sayacı korunur: yeniden üretim sohbeti ilerletmez.
      const nextLabel = 1 + Math.max(0, ...turn.newSources.map((s) => Number(s.ref.slice(1)) || 0));
      await touchConversation(tx, actor.orgId, id, {
        title: null,
        titleFold: null,
        nextSourceLabel: nextLabel,
        alias: turn.alias,
      });
    });
  }
}
