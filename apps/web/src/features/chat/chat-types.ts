// Sohbet mesaj tipi ve parça okuyucuları (022 §5). Kalıcı data parçaları aynı `type` + `id` ile
// yerinde güncellenir (AI SDK); geçici `data-pipeline` mesaja yazılmaz (pipeline-store).
import type {
  CitationItem,
  EdaDataParts,
  MessageMetadata,
  NoticeData,
  SourceItem,
} from '@eda/contracts/stream';
import type { UIMessage } from 'ai';

export type EdaUIMessage = UIMessage<MessageMetadata, EdaDataParts>;
export type EdaPart = EdaUIMessage['parts'][number];

export function messageText(message: EdaUIMessage): string {
  return splitMessageText(message).answer;
}

/**
 * Araçlı turda model her adımda kısa çalışma notu yazabilir ("önce mevzuatı arayacağım…"). Sonrasında
 * yeni bir adım (`step-start`) başlayan metin parçaları çalışma notudur; son adımın metni yanıttır.
 */
export function splitMessageText(message: EdaUIMessage): { notes: string[]; answer: string } {
  const notes: string[] = [];
  let pending: string[] = [];
  for (const p of message.parts) {
    if (p.type === 'text') pending.push(p.text);
    else if (p.type === 'step-start' && pending.length > 0) {
      const note = pending.join('').trim();
      if (note !== '') notes.push(note);
      pending = [];
    }
  }
  return { notes, answer: pending.join('') };
}

/** Mesajdaki son `data-sources` parçası (sunucu aynı id ile tur kaynaklarını biriktirerek yazar). */
export function messageSources(message: EdaUIMessage): SourceItem[] {
  let found: SourceItem[] = [];
  for (const p of message.parts) if (p.type === 'data-sources') found = p.data.sources;
  return found;
}

export function messageCitations(message: EdaUIMessage): {
  final: boolean;
  items: CitationItem[];
} | null {
  let found: { final: boolean; items: CitationItem[] } | null = null;
  for (const p of message.parts) {
    if (p.type === 'data-citations') found = { final: p.data.final, items: p.data.citations };
  }
  return found;
}

export function messageNotices(message: EdaUIMessage): NoticeData[] {
  const out: NoticeData[] = [];
  for (const p of message.parts) if (p.type === 'data-notice') out.push(p.data);
  return out;
}

/** `masking_applied` bildirimindeki varlık sayısı (022 S3); bildirim yoksa veya sayı geçersizse 0. */
export function maskedCountOf(message: EdaUIMessage): number {
  for (const n of messageNotices(message)) {
    if (n.code !== 'masking_applied') continue;
    const count = n.meta?.count;
    return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 0;
  }
  return 0;
}

/** Sohbet geneli `ref` -> kaynak eşlemi: `[K#]` etiketi sohbet boyunca sabittir, sonraki tur önceki
 * turun kaynağına atıf yapabilir; aynı ref için son kayıt geçerlidir. */
export function conversationSources(messages: readonly EdaUIMessage[]): Map<string, SourceItem> {
  const map = new Map<string, SourceItem>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const s of messageSources(m)) map.set(s.ref, s);
  }
  return map;
}

/**
 * Ortam bildirimi: kalıcı, kapatılamaz şerit olarak gösterilir. `simulation` (sahte yanıtlar) önceliklidir;
 * `beta_synthetic` pilot sürümde gerçek müvekkil verisinin girilmemesi içindir (sunucu her turun başında
 * yayımlar; mock modunda yoktur, bu yüzden geliştirme ortamında rahatsız etmez).
 */
export function environmentNotice(
  messages: readonly EdaUIMessage[],
): 'simulation' | 'beta_synthetic' | null {
  let beta = false;
  for (const m of messages) {
    for (const n of messageNotices(m)) {
      if (n.code === 'simulation') return 'simulation';
      if (n.code === 'beta_synthetic') beta = true;
    }
  }
  return beta ? 'beta_synthetic' : null;
}
