// Doğrulayıcı sorun tipi ve Türkçe mesajları (054 §4.1). Mesajlar kullanıcıya gösterilebilir, içerik
// metni ve iç ayrıntı taşımaz. Rol etiketleri 003 §4.3'tür; arayüz kendi kataloğunu kullanabilir.
import type {
  EditorIssueCode,
  EditorIssueDto,
  EditorIssueSeverity,
} from '@eda/contracts/document-io';
import type { SectionRole } from '@eda/contracts/enums';

export type Issue = EditorIssueDto;
export type { EditorIssueCode as IssueCode, EditorIssueSeverity as IssueSeverity };

/** 003 §4.3 rol arayüz adları. */
export const SECTION_ROLE_LABELS: Readonly<Record<SectionRole, string>> = {
  courtHeader: 'Mahkeme başlığı',
  partiesGrid: 'Taraflar',
  subjectLine: 'Konu',
  numberedExplanations: 'Açıklamalar',
  legalGrounds: 'Hukuki sebepler',
  evidenceList: 'Deliller',
  resultAndRequest: 'Sonuç ve istem',
  attorneySignature: 'Vekil imzası',
  generic: 'Bölüm',
  freeSection: 'Serbest bölüm',
};

type MessageArgs = { role?: SectionRole; max?: number };

const MESSAGES: Readonly<Record<EditorIssueCode, (a: MessageArgs) => string>> = {
  'schema.node_invalid': () => 'Belge desteklenmeyen bir öğe içeriyor.',
  'schema.attr_invalid': () => 'Belgede desteklenmeyen veya geçersiz bir öznitelik var.',
  'limit.block_count': (a) => `Belge en çok ${a.max ?? ''} bölüm içerebilir.`,
  'limit.draft_bytes': () => 'Belge kaydedilemeyecek kadar büyük. Belgeyi bölün.',
  'text.forbidden_char': () => 'Metinde gizli veya denetim karakteri var.',
  'text.tab_not_allowed': () => 'Sekme karakteri yalnız Taraflar ve Konu bölümlerinde kullanılır.',
  'blockId.missing': () => 'Bölüm kimliği eksik.',
  'blockId.duplicate': () => 'Aynı bölüm kimliği birden çok kez geçiyor.',
  'citation.missing_id': () => 'Atıf kaydı eksik.',
  'link.protocol': () => 'Bağlantı yalnız https: veya mailto: ile başlayabilir.',
  'list.nested': () => 'Liste içinde liste kullanılamaz.',
  'table.limit': () => 'Tablo en çok 8 sütun ve 40 satır içerebilir.',
  'table.merged_cell': () => 'Birleştirilmiş tablo hücresi desteklenmez.',
  'heading.not_first': () => 'Başlık yalnız bölümün ilk satırında olabilir.',
  'role.child_not_allowed': (a) => `${label(a.role)} bölümünde bu öğe kullanılamaz.`,
  'role.count': (a) => `${label(a.role)} bölümü en çok ${a.max ?? ''} paragraf içerebilir.`,
  'role.mark_not_allowed': (a) => `${label(a.role)} bölümünde bu biçim kullanılamaz.`,
  'role.model_forbidden': (a) =>
    `${label(a.role)} bölümü kayıtlardan doldurulur; model tarafından yazılamaz.`,
  'order.court_header_not_first': () => 'Mahkeme başlığı belgenin ilk bölümü değil.',
  'order.signature_not_last': () => 'Vekil imzası belgenin son bölümü değil.',
  'role.duplicate': (a) => `${label(a.role)} bölümü birden fazla.`,
  'section.empty': () => 'Bölüm boş.',
  'placeholder.unfilled': () => 'Doldurulmamış yer tutucu var.',
  'docast.forbidden_phrase': () => 'Belgede kullanılamayacak bir imza ibaresi var.',
};

function label(role: SectionRole | undefined): string {
  return role === undefined ? 'Bölüm' : SECTION_ROLE_LABELS[role];
}

export function issue(
  code: EditorIssueCode,
  severity: EditorIssueSeverity,
  blockId: string | null,
  path: string,
  args: MessageArgs = {},
): Issue {
  return { code, severity, blockId, path, message: MESSAGES[code](args) };
}
