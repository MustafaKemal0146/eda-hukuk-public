// Sohbet yanıtını Word'e (.docx) aktarma (052 §5.1 MessageActions "Dışa aktar"; 025 §1 madde 3).
// Saf modül (DOM yok): yanıt metninde `[K#]` etiketi kayıttan render edilmiş kısa künyeye döner, sonda
// atıf yapılan kaynakların listesi (portal adı + erişim tarihi) ve zorunlu ibare yer alır. Model künye
// yazmaz; künye yalnız `data-sources` kaydından gelir, eşleşmeyen etiket uydurulmaz (ham kalır).
// Kanonik kural: mesajda `not_found` durumlu atıf varsa dışa aktarım engellenir (sert engel).
import type { CitationItem } from '@eda/contracts/stream';
import type { Block } from '../studio/doc-convert.ts';
import { markdownToBlocks } from '../studio/doc-convert.ts';
import { buildDocxBytes } from '../studio/docx-writer.ts';
import { citedRefs, splitCitations } from './citations.ts';
import { splitDocuments } from './documents.ts';

/** Dışa aktarımda kaynak satırı için gereken alanlar (portal adı ve tarih çağıranda çözülür). */
export type ExportSource = {
  readonly shortKunye: string;
  readonly title: string;
  /** Portalın görünen adı (`chat.sources.portals.*`; iç kod anahtarı değil). */
  readonly portal: string;
  /** Erişim tarihi `GG.AA.YYYY`; bilinmiyorsa null (tarih uydurulmaz). */
  readonly accessDate: string | null;
};

export type AnswerExportLabels = {
  readonly title: string;
  readonly sourcesHeading: string;
  /** Kaynak satırı metni (katalogdan; künye, başlık, portal ve tarih yerleştirilmiş). */
  readonly sourceLine: (source: ExportSource) => string;
  /** Zorunlu ibare paragrafları (katalogdan, birebir). */
  readonly disclaimers: readonly string[];
};

/** Kanonik engel: mesajın atıflarından biri `not_found` ise dışa aktarım yapılmaz. */
export function exportBlocked(items: readonly Pick<CitationItem, 'status'>[] | undefined): boolean {
  return (items ?? []).some((i) => i.status === 'not_found');
}

/** `[metin](adres)` bağlantısı yalnız metnine iner (Word'de tıklanır bağlantı üretilmez). */
const LINK = /\[([^\]\n]{1,300})\]\((?:[^)\s]{1,2000})\)/g;

/** `[K#]` etiketlerini kısa künyeye çevirir; kayıtta olmayan etiket olduğu gibi kalır. */
export function renderCitations(text: string, sources: ReadonlyMap<string, ExportSource>): string {
  return splitCitations(text)
    .map((s) => {
      if (s.type === 'text') return s.value.replace(LINK, '$1');
      const names = s.refs.map((r) => sources.get(r)?.shortKunye);
      return names.every((n) => n !== undefined)
        ? `(${names.join('; ')})`
        : `[${s.refs.join(', ')}]`;
    })
    .join('');
}

/** Yanıt + "Kaynaklar" listesi + zorunlu ibare blokları. */
export function answerExportBlocks(
  text: string,
  sources: ReadonlyMap<string, ExportSource>,
  labels: AnswerExportLabels,
): Block[] {
  const blocks: Block[] = [];
  for (const seg of splitDocuments(text)) {
    if (seg.type === 'text') {
      blocks.push(...markdownToBlocks(renderCitations(seg.value, sources)));
      continue;
    }
    if (seg.title.trim() !== '') {
      blocks.push({ kind: 'h', level: 2, runs: [{ text: seg.title.trim(), marks: [] }] });
    }
    blocks.push(...markdownToBlocks(renderCitations(seg.body, sources)));
  }
  const listed = citedRefs(text).flatMap((r) => {
    const s = sources.get(r);
    return s ? [s] : [];
  });
  if (listed.length > 0) {
    blocks.push({ kind: 'h', level: 2, runs: [{ text: labels.sourcesHeading, marks: [] }] });
    listed.forEach((s, i) => {
      blocks.push({
        kind: 'li',
        ordered: true,
        index: i + 1,
        runs: [{ text: labels.sourceLine(s), marks: [] }],
      });
    });
  }
  for (const d of labels.disclaimers) {
    blocks.push({ kind: 'p', align: 'left', runs: [{ text: d, marks: ['italic'] }] });
  }
  return blocks;
}

/** Word belgesinin baytları (OOXML, bağımlılıksız yazıcı). */
export function buildAnswerDocx(
  text: string,
  sources: ReadonlyMap<string, ExportSource>,
  labels: AnswerExportLabels,
): Uint8Array {
  return buildDocxBytes(labels.title, answerExportBlocks(text, sources, labels));
}
