// Sohbet <-> stüdyo köprüsü (P18 ilk dilim): sohbetteki belge bloğu kalıcı belge olur; stüdyodaki belge
// sohbette düzenlenip "Belgeye uygula" ile geri yazılır. Düzenleme sohbet hattından geçer; böylece
// veri sınıfı kapısı ve maskeleme atlanmaz (001 Y-9). Yazma her zaman önce mevcut taslağı sürüme alır.
import { parseDocJson } from '@eda/editor/schema';
import { markdownToDoc } from './doc-convert.ts';
import { documentsApi } from './documents-api.ts';
import {
  applySelectionEdit,
  SelectionNotFoundError,
  type SelectionTarget,
} from './selection-target.ts';

const KEY = 'eda:edit-target:';

/** Sohbetin yazacağı hedef: belgenin tamamı veya bir bölümdeki seçili kısım. */
export type EditTarget =
  | { kind: 'document'; documentId: string }
  | ({ kind: 'selection'; documentId: string } & SelectionTarget);

export function rememberEditTarget(conversationId: string, target: EditTarget): void {
  try {
    sessionStorage.setItem(`${KEY}${conversationId}`, JSON.stringify(target));
  } catch {
    // Depolama kapalıysa köprü yalnız "yeni belge olarak aç" ile çalışır.
  }
}

/** Saklanan hedefi çözer; bozuk/eksik kayıt `null` (eski düz belge kimliği de tanınır). */
export function parseEditTarget(raw: string | null): EditTarget | null {
  if (raw === null || raw === '') return null;
  if (!raw.startsWith('{')) return { kind: 'document', documentId: raw };
  try {
    const v = JSON.parse(raw) as Partial<EditTarget> | null;
    if (!v || typeof v.documentId !== 'string') return null;
    if (v.kind === 'document') return { kind: 'document', documentId: v.documentId };
    if (
      v.kind === 'selection' &&
      typeof v.blockId === 'string' &&
      typeof v.text === 'string' &&
      typeof v.occurrence === 'number' &&
      typeof v.whole === 'boolean'
    ) {
      return {
        kind: 'selection',
        documentId: v.documentId,
        blockId: v.blockId,
        text: v.text,
        occurrence: v.occurrence,
        whole: v.whole,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function editTargetOf(conversationId: string): EditTarget | null {
  try {
    return parseEditTarget(sessionStorage.getItem(`${KEY}${conversationId}`));
  } catch {
    return null;
  }
}

const SAVED = 'eda:chat-doc:';
const IN_FLIGHT = new Map<string, Promise<string>>();

/** Sohbet belge bloğunun daha önce kaydedildiği belge (aynı tarayıcıda); yoksa `null`. */
export function savedDocumentOf(
  conversationId: string,
  messageId: string,
  index: number,
): string | null {
  try {
    return localStorage.getItem(`${SAVED}${conversationId}:${messageId}:${index}`);
  } catch {
    return null;
  }
}

/** Tamamlanan sohbet belgesini Belgeler'e kaydeder (blok başına bir kez); kimliği döndürür. */
export async function saveChatDocument(
  conversationId: string,
  messageId: string,
  index: number,
  title: string,
  markdownBody: string,
): Promise<string> {
  const key = `${conversationId}:${messageId}:${index}`;
  const known = savedDocumentOf(conversationId, messageId, index);
  if (known !== null) return known;
  // Otomatik kayıt sürerken "Stüdyoda aç" ikinci belge üretmesin: uçuştaki istek paylaşılır.
  const pending = IN_FLIGHT.get(key);
  if (pending) return pending;
  const run = (async () => {
    const id = await openAsNewDocument(title, markdownBody);
    try {
      localStorage.setItem(`${SAVED}${key}`, id);
    } catch {
      // Depolama kapalıysa aynı blok yeniden açılışta tekrar kaydedilebilir.
    }
    return id;
  })().finally(() => IN_FLIGHT.delete(key));
  IN_FLIGHT.set(key, run);
  return run;
}

/** Sohbet belge bloğunu yeni kalıcı belge olarak açar; belge kimliğini döndürür. */
export async function openAsNewDocument(title: string, markdownBody: string): Promise<string> {
  const doc = await documentsApi.documents.create({
    kind: 'petition',
    title: title.trim() === '' ? 'Belge taslağı' : title.trim().slice(0, 200),
  });
  await documentsApi.documents.saveDraft(doc.id, {
    baseVersion: doc.draftRev,
    draft: markdownToDoc(markdownBody) as never,
    clientSeq: 1,
    reason: 'manual',
  });
  return doc.id;
}

export { SelectionNotFoundError };

/**
 * Sohbet yanıtını hedefe yazar; önce mevcut taslak sürüme alınır. Belge hedefinde taslağın tamamı
 * değişir; seçim hedefinde yalnız o aralık yeniden yazılır, kalan belge dokunulmaz. Seçili metin artık
 * bölümde yoksa `SelectionNotFoundError` (belge değişmez).
 */
export async function applyToDocument(target: EditTarget, markdownBody: string): Promise<void> {
  const { documentId } = target;
  const current = await documentsApi.documents.get(documentId);
  let draft: unknown;
  if (target.kind === 'selection') {
    const parsed = parseDocJson(current.draft);
    if (parsed.doc === null) throw new SelectionNotFoundError();
    const { kind: _k, documentId: _d, ...selection } = target;
    draft = applySelectionEdit(parsed.doc, selection, markdownBody).toJSON();
  } else {
    draft = markdownToDoc(markdownBody);
  }
  if (current.draftRev > 0) {
    await documentsApi.documents.createVersion(documentId, {
      name:
        target.kind === 'selection'
          ? 'Seçili kısım düzenlemesi öncesi'
          : 'Sohbet düzenlemesi öncesi',
    });
  }
  await documentsApi.documents.saveDraft(documentId, {
    baseVersion: current.draftRev,
    draft: draft as never,
    clientSeq: 1,
    reason: 'manual',
  });
}

/** Editör JSON'undan sohbet ilk mesajı için düz metin (bölümler boş satırla ayrılır). */
export function docText(doc: unknown): string {
  const texts: string[] = [];
  const walkInline = (n: unknown): string => {
    const x = n as { type?: string; text?: string; content?: unknown[] };
    if (typeof x.text === 'string') return x.text;
    return (x.content ?? []).map(walkInline).join('');
  };
  const walk = (n: unknown): void => {
    const x = n as { type?: string; content?: unknown[] };
    if (x.type === 'paragraph' || x.type === 'heading') {
      const t = walkInline(x).trim();
      if (t !== '') texts.push(t);
      return;
    }
    for (const c of x.content ?? []) walk(c);
  };
  walk(doc);
  return texts.join('\n\n');
}
