// Sohbet eki çözümü (P21 ilk dilimi; K3, K4, S4 yerine anlık durum denetimi). Hono bilmez.
// Tek kiracı işleminde: kendi bağsız ekleri bu sohbete bağlanır (K3), sonra satırlar okunur. Görünmeyen
// (başka kullanıcı/büro), silinmek üzere, dava evrakı veya başka sohbete bağlı ek `FILE_NOT_FOUND`
// (varlık sızdırılmaz). Karantina, metinsiz/başarısız ve işlenmekte olan evrak bağlama girmez; hata
// kodu kullanıcıya düzeltici metinle döner. Evrak adı ve metni günlüğe yazılmaz.
import { AppError } from '@eda/contracts/errors';
import type { TenantTx } from '@eda/db';
import type { ChatActor } from '../../chat/persistence.ts';
import {
  type AttachmentRow,
  bindAttachments,
  loadAttachments,
} from '../../repositories/chat/attachments.ts';

export interface ResolvedAttachment {
  readonly fileId: string;
  readonly name: string;
  readonly fileType: string;
  readonly mimeType: string;
  readonly text: string;
  readonly pageCount: number | null;
  readonly pageOffsets: readonly number[];
  /** Yükleme günü (Europe/Istanbul değil, UTC tarih; kaynak `retrievedAt`). */
  readonly uploadedOn: string;
}

export interface ChatAttachments {
  resolve(
    actor: ChatActor,
    conversationId: string,
    ids: readonly string[],
  ): Promise<ResolvedAttachment[]>;
  /**
   * Bu sohbete daha önce bağlanmış ekler (takip sorusu bağlamı): hata FIRLATMAZ, yalnız hâlâ
   * kullanılabilir olanları döner (silinen/erişilemeyen ek sessizce düşer; sohbet kilitlenmez).
   */
  resolveBound(
    actor: ChatActor,
    conversationId: string,
    ids: readonly string[],
  ): Promise<ResolvedAttachment[]>;
}

export interface ChatAttachmentsDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
}

const PROCESSING = new Set(['uploaded', 'scanning', 'extracting', 'chunking', 'embedding']);

function toResolved(r: AttachmentRow & { text: string }): ResolvedAttachment {
  return {
    fileId: r.id,
    name: r.name,
    fileType: r.fileType,
    mimeType: r.mimeType,
    text: r.text,
    pageCount: r.pageCount,
    pageOffsets: r.pageOffsets,
    uploadedOn: r.createdAt.toISOString().slice(0, 10),
  };
}

function usable(r: AttachmentRow | undefined, actor: ChatActor, conversationId: string): boolean {
  return (
    r !== undefined &&
    r.deleteRequestedAt === null &&
    r.origin === 'chat_attachment' &&
    r.caseId === null &&
    r.uploadedBy === actor.userId &&
    r.originId === conversationId
  );
}

export function createChatAttachments(deps: { db: ChatAttachmentsDb }): ChatAttachments {
  return {
    async resolveBound(actor, conversationId, ids) {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return [];
      const rows = await deps.db.withTenant(actor, (tx) =>
        loadAttachments(tx, actor.orgId, unique),
      );
      return rows.flatMap((r) =>
        usable(r, actor, conversationId) &&
        r.status === 'ready' &&
        r.scannedAt !== null &&
        r.text !== null
          ? [toResolved({ ...r, text: r.text })]
          : [],
      );
    },
    async resolve(actor, conversationId, ids) {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return [];
      const rows = await deps.db.withTenant(actor, async (tx) => {
        await bindAttachments(tx, actor.orgId, actor.userId, conversationId, unique);
        return loadAttachments(tx, actor.orgId, unique);
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return unique.map((id) => {
        const r = byId.get(id);
        if (r === undefined || !usable(r, actor, conversationId)) {
          throw new AppError('FILE_NOT_FOUND');
        }
        if (r.status === 'quarantined') throw new AppError('FILE_QUARANTINED');
        if (r.status === 'ocr_skipped' || r.status === 'failed') {
          throw new AppError('FILE_NO_TEXT_LAYER');
        }
        // Fail-closed: taranmamış evrak hiçbir koşulda bağlama girmez.
        if (PROCESSING.has(r.status) || r.scannedAt === null || r.text === null) {
          throw new AppError('FILE_NOT_READY', { actions: ['wait'] });
        }
        return toResolved({ ...r, text: r.text });
      });
    },
  };
}
