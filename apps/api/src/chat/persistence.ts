// Sohbet kalıcılığı arayüzü (030 §7; 022 §8). İki gerçekleme: `PgChatPersistence` (kimlik zinciri
// kurulu: `withTenant` + RLS, sohbet kullanıcıya aittir) ve `MemoryChatPersistence` (kimliksiz
// geliştirme/test dilimi). Valkey'e içerik yazılmaz (Y-41). Etkin tur denetleyicileri süreç
// belleğindedir (`ActiveTurns`): akış tek süreçte yaşar, durdurma ucu aynı süreçten gelir.
import type { SourceRecord } from '@eda/ai';
import type { ModelMessage, UIMessage } from 'ai';

export interface ChatActor {
  readonly orgId: string;
  readonly userId: string;
}

export interface ChatSession {
  readonly id: string;
  readonly title: string | null;
  readonly dataClass: 'public' | 'client' | 'case';
  /** Arayüz mesajları (yalnız tamamlanmış/durdurulmuş), oluşturulma sırasıyla. */
  readonly ui: UIMessage[];
  /** Kanonik model transkripti (maskesiz; gönderimde maskelenir). */
  readonly llm: ModelMessage[];
  /** `[K#]` kaynakları, etiket sırasıyla. */
  readonly sources: SourceRecord[];
  /**
   * Son asistan mesajı ve transkripte yaptığı katkının uzunluğu. Yeniden üretimde `llm` bu kadar
   * kırpılır: eski yanıt yeni tura bağlam olarak gönderilmez (022 §2.1).
   */
  readonly lastAssistant: { readonly messageId: string; readonly llmCount: number } | null;
  /**
   * Her asistan mesajının transkripte katkısının uzunluğu (mesaj kimliği -> sayı), `ui` sırasıyla.
   * Mesaj düzenlemede kesilen asistan yanıtlarının katkısı `llm`'in sonundan bu kadar kırpılır.
   */
  readonly llmCounts: ReadonlyMap<string, number>;
}

export interface ChatSummary {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
}

export interface TurnRecord {
  readonly title: string | null;
  readonly userMessage: UIMessage;
  /** Boş yanıtla durdurulan turda `null` (yalnız kullanıcı mesajı yazılır). */
  readonly assistantMessage: UIMessage | null;
  readonly assistantStatus: 'complete' | 'stopped' | 'error';
  /** Bu turun model mesajları: kullanıcı çerçevesi + yanıt mesajları. */
  readonly llm: ModelMessage[];
  /** Turda ilk kez etiket alan kaynaklar. */
  readonly newSources: SourceRecord[];
  readonly alias: 'edai-flash' | 'edai-pro';
  readonly requestId: string;
  /**
   * Mesaj düzenleme: bu kimlikli kullanıcı mesajı ve sonrasındaki tüm mesajlar aynı işlemde
   * transkriptten düşürülür (silinmez: `in_transcript = false`), ardından tur yazılır. `[K#]`
   * etiketleri sohbetin kaydıdır, kesilen yanıtların kaynak satırları etiket defteri olarak kalır.
   */
  readonly replaceFromMessageId?: string | null;
}

/**
 * Yeniden üretim kaydı: kullanıcı mesajı zaten yazılıdır; yalnız hedef asistan yanıtı değişir.
 * Yanıt hedefin kimliğiyle üzerine yazılır (boş yanıtla durdurulan yeniden üretimde hiç yazılmaz,
 * eski yanıt korunur).
 */
export interface RegeneratedTurnRecord {
  readonly assistantMessage: UIMessage;
  readonly assistantStatus: 'complete' | 'stopped' | 'error';
  /** Bu turun model mesajları: kullanıcı çerçevesi + yanıt mesajları. */
  readonly llm: ModelMessage[];
  /** Turda ilk kez etiket alan kaynaklar (etiketler bir kez verilir, değişmez). */
  readonly newSources: readonly SourceRecord[];
  readonly alias: 'edai-flash' | 'edai-pro';
  readonly requestId: string;
}

export interface ChatPersistence {
  readonly kind: 'pg' | 'memory';
  create(actor: ChatActor, id: string): Promise<void>;
  list(actor: ChatActor): Promise<ChatSummary[]>;
  /** Sohbeti ve mesajlarını siler (yalnız sahibi); yasal saklamadaki dosyanın sohbeti silinmez. */
  remove(actor: ChatActor, id: string): Promise<'deleted' | 'not_found' | 'legal_hold'>;
  load(actor: ChatActor, id: string): Promise<ChatSession | null>;
  saveTurn(actor: ChatActor, id: string, turn: TurnRecord): Promise<void>;
  /**
   * Yeniden üretim: hedef asistan satırını yenisiyle değiştirir (eskisi transkriptten düşer),
   * kullanıcı mesajına ve sohbetin `[K#]` etiketlerine dokunmaz; turun kaynakları yeni yanıta bağlanır.
   */
  replaceTurn(
    actor: ChatActor,
    id: string,
    targetMessageId: string,
    turn: RegeneratedTurnRecord,
  ): Promise<void>;
}

/** Süreç içi etkin tur kaydı (sohbet başına tek akış; durdurma ucu bunu kullanır). */
export class ActiveTurns {
  readonly #items = new Map<string, { messageId: string; controller: AbortController }>();

  get(conversationId: string) {
    return this.#items.get(conversationId);
  }
  set(conversationId: string, value: { messageId: string; controller: AbortController }): void {
    this.#items.set(conversationId, value);
  }
  clear(conversationId: string): void {
    this.#items.delete(conversationId);
  }
}

type MemoryRecord = {
  id: string;
  createdAt: number;
  title: string | null;
  ui: UIMessage[];
  llm: ModelMessage[];
  sources: SourceRecord[];
  /** Asistan mesajı -> transkripte yaptığı katkının uzunluğu (yeniden üretim kırpması). */
  llmCounts: Map<string, number>;
};

/** Kimliksiz dilim ve testler için; süreç yeniden başlarsa sohbetler silinir. */
export class MemoryChatPersistence implements ChatPersistence {
  readonly kind = 'memory' as const;
  readonly #items = new Map<string, MemoryRecord>();
  readonly #max: number;

  constructor(max = 200) {
    this.#max = max;
  }

  async create(_actor: ChatActor, id: string): Promise<void> {
    if (this.#items.size >= this.#max) {
      const oldest = [...this.#items.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) this.#items.delete(oldest.id);
    }
    this.#items.set(id, {
      id,
      createdAt: Date.now(),
      title: null,
      ui: [],
      llm: [],
      sources: [],
      llmCounts: new Map(),
    });
  }

  async remove(_actor: ChatActor, id: string): Promise<'deleted' | 'not_found' | 'legal_hold'> {
    return this.#items.delete(id) ? 'deleted' : 'not_found';
  }

  async list(): Promise<ChatSummary[]> {
    return [...this.#items.values()]
      .filter((v) => v.ui.length > 0)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((v) => ({ id: v.id, title: v.title, createdAt: new Date(v.createdAt).toISOString() }));
  }

  async load(_actor: ChatActor, id: string): Promise<ChatSession | null> {
    const r = this.#items.get(id);
    if (!r) return null;
    const last = r.ui.findLast((m) => m.role === 'assistant');
    return {
      id: r.id,
      title: r.title,
      dataClass: 'client',
      ui: [...r.ui],
      llm: [...r.llm],
      sources: [...r.sources],
      lastAssistant: last ? { messageId: last.id, llmCount: r.llmCounts.get(last.id) ?? 0 } : null,
      llmCounts: new Map(r.llmCounts),
    };
  }

  async saveTurn(_actor: ChatActor, id: string, turn: TurnRecord): Promise<void> {
    const r = this.#items.get(id);
    if (!r) return;
    const from = turn.replaceFromMessageId ?? null;
    if (from !== null) {
      // Düzenleme: hedef kullanıcı mesajı ve sonrası düşer; kesilen yanıtların transkript katkısı kırpılır.
      const index = r.ui.findIndex((m) => m.id === from && m.role === 'user');
      if (index !== -1) {
        const cut = r.ui.splice(index);
        let contribution = 0;
        for (const m of cut) {
          if (m.role !== 'assistant') continue;
          contribution += r.llmCounts.get(m.id) ?? 0;
          r.llmCounts.delete(m.id);
        }
        if (contribution > 0) r.llm.splice(r.llm.length - contribution, contribution);
      }
    }
    r.title = turn.title ?? r.title;
    r.ui.push(turn.userMessage);
    if (turn.assistantMessage) {
      r.ui.push(turn.assistantMessage);
      r.llmCounts.set(turn.assistantMessage.id, turn.llm.length);
    }
    r.llm.push(...turn.llm);
    r.sources.push(...turn.newSources);
  }

  async replaceTurn(
    _actor: ChatActor,
    id: string,
    targetMessageId: string,
    turn: RegeneratedTurnRecord,
  ): Promise<void> {
    const r = this.#items.get(id);
    if (!r) return;
    const index = r.ui.findIndex((m) => m.id === targetMessageId && m.role === 'assistant');
    if (index === -1) return;
    // Hedef yanıtın transkript katkısı düşülür; yeni tur sona eklenir.
    const contribution = r.llmCounts.get(targetMessageId) ?? 0;
    if (contribution > 0) r.llm.splice(r.llm.length - contribution, contribution);
    r.llmCounts.delete(targetMessageId);
    // Yerinde üzerine yazma: mesaj kimliği korunur, kaynak etiketleri değişmez.
    r.ui.splice(index, 1, turn.assistantMessage);
    r.llmCounts.set(turn.assistantMessage.id, turn.llm.length);
    r.llm.push(...turn.llm);
    r.sources.push(...turn.newSources);
  }
}
