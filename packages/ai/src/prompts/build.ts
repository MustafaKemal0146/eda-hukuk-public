// İstem kurucu (024 §2, §4.4, §10): [1] chat.core → instructions; [7] tur bağlamı son kullanıcı
// mesajının başına. Şablon işleyici: {{değişken}} zorunlu, {{?değişken}} boşsa satırıyla birlikte düşer.
import { PROMPTS } from '@eda/contracts/prompts';
import type { DocumentIntent } from '@eda/legal/intent';
import type { SourceRecord } from '../tools/context.ts';
import { referenceHints } from './reference-hints.ts';

export function render(template: string, vars: Record<string, string | null | undefined>): string {
  return template
    .split('\n')
    .flatMap((line) => {
      const opt = /^\{\{\?([a-z_]+)\}\}$/.exec(line.trim());
      if (opt) {
        const v = vars[opt[1] ?? ''];
        return v ? [v] : [];
      }
      return [
        line.replace(/\{\{([a-z_]+)\}\}/g, (_m, k: string) => {
          const v = vars[k];
          if (v === undefined || v === null) throw new Error(`istem değişkeni eksik: ${k}`);
          return v;
        }),
      ];
    })
    .join('\n');
}

export function istanbulToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

const SOURCE_KIND_LABEL: Record<SourceRecord['kind'], string> = {
  decision: 'karar',
  legislation: 'mevzuat',
  case_file: 'evrak',
};

export function sourceIndex(sources: readonly SourceRecord[], max = 30): string {
  if (sources.length === 0) return 'Yok';
  return sources
    .slice(-max)
    .map((s) => `${s.ref}: ${s.shortKunye} (${SOURCE_KIND_LABEL[s.kind]})`)
    .join('\n');
}

const DOCUMENT_INTENT_LINES: Record<DocumentIntent, string> = {
  draft:
    'Belge isteği: AÇIK. Kullanıcı belge hazırlanmasını istedi; belge hattını create_document ile başlat.',
  forbid:
    'Belge isteği: YOK. Kullanıcı belge veya taslak istemedi; create_document, edit_document ve submit_outline çağırma, soruyu sohbette yanıtla.',
  neutral:
    'Belge isteği: belirtilmedi. Kullanıcı açıkça istemedikçe create_document çağırma; belge mi görüş mü istendiği belirsizse tek soru sor.',
};

export function chatInstructions(): string {
  return PROMPTS['chat.core'].text;
}

export function turnFrame(input: {
  modeLabel: string;
  scopeLabel: string;
  sources: readonly SourceRecord[];
  userText: string;
  /** Sunucunun belge niyeti kararı (draft | forbid | neutral); satır olarak TUR BAĞLAMI'na girer. */
  documentIntent?: DocumentIntent;
  now?: Date;
}): string {
  return render(PROMPTS['chat.turn_frame'].text, {
    today: istanbulToday(input.now),
    mode_label: input.modeLabel,
    scope_label: input.scopeLabel,
    source_index: sourceIndex(input.sources),
    draft_mode_block: input.documentIntent ? DOCUMENT_INTENT_LINES[input.documentIntent] : null,
    // Karar numarası / madde atfı yönlendirmesi: chat.core önekine dokunmaz, tur bağlamına girer.
    notices_block: referenceHints(input.userText),
    user_text: input.userText,
  });
}
