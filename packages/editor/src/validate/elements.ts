// Zorunlu unsur denetimi (054 §4.4, 080 §3, §4) — HUKUK ONAYI BEKLİYOR.
// Yalnız bölümün varlığı ve doluluğu denetlenir; metnin hukuka uygunluğu denetlenmez. Hiçbir unsur
// kodu `block` üretmez: Z + boş -> `warn`, K + boş -> `info`; `legalGrounds`/`evidenceList` tavanı `info`.
import type { ElementIssueCode, ElementIssueDto } from '@eda/contracts/document-io';
import type { DocumentKind, DocumentSubtype, SectionRole } from '@eda/contracts/enums';
import {
  ATTACHMENTS_HEADING,
  CLAIM_VALUE_LABEL,
  CLAIM_VALUE_SUBTYPES,
  ELEMENT_INFO_CAPPED_ROLES,
  ELEMENT_INFO_MESSAGES,
  ELEMENT_ROLES,
  type ElementRequirement,
  type ElementRole,
  type ElementRow,
  FILE_NO_PATTERN,
  FILE_NO_SUBTYPES,
  MEDIATION_KEYWORD,
  MEDIATION_RECORD_CASE_TYPES,
  MEDIATION_RECORD_SUBTYPES,
  PETITION_ELEMENT_MATRIX,
  type PetitionSubtype,
} from '@eda/contracts/legal/petition-types';
import { tr_fold } from '@eda/legal/text';
import type { Node as PMNode } from '@tiptap/pm/model';
import { SECTION_ROLE_LABELS } from './issues.ts';

export type ElementIssue = ElementIssueDto;

export type CheckElementsOptions = {
  /** `elements.mediationRecord` yalnız bu dava türlerinde (080 Açık Soru 10). */
  caseTypeCode?: string | null;
};

/** Alt türü olmayan dilekçede 054 §4.4 başlangıç kümesi (tüm roller Z). */
const BASE_ROW: ElementRow = Object.fromEntries(
  ELEMENT_ROLES.map((r) => [r, 'Z' as ElementRequirement]),
) as ElementRow;

const PLACEHOLDER_ALL = /\[\[Doldurulacak:[^\]]{1,200}\]\]/g;
const PLACEHOLDER_START = '[[Doldurulacak:';

function isPetitionSubtype(subtype: string | null): subtype is PetitionSubtype {
  return subtype !== null && Object.hasOwn(PETITION_ELEMENT_MATRIX, subtype);
}

/** Bölüm gövdesinin metni: ilk çocuk başlıksa hariç (başlık tek başına içerik sayılmaz). */
function bodyText(section: PMNode): string {
  const parts: string[] = [];
  section.forEach((child, _o, i) => {
    if (i === 0 && child.type.name === 'heading') return;
    parts.push(child.textContent);
  });
  return parts.join('\n');
}

/** Yer tutucular çıkarılınca boş mu. */
function isBlank(text: string): boolean {
  return text.replace(PLACEHOLDER_ALL, '').trim() === '';
}

function isMissing(role: ElementRole, section: PMNode | undefined): boolean {
  if (section === undefined) return true;
  const text = bodyText(section);
  if (role === 'partiesGrid') return isBlank(text) || text.includes(PLACEHOLDER_START);
  return isBlank(text);
}

function severityOf(role: ElementRole, req: ElementRequirement): 'warn' | 'info' | null {
  if (req === 'Y') return null;
  if ((ELEMENT_INFO_CAPPED_ROLES as readonly string[]).includes(role)) return 'info';
  return req === 'Z' ? 'warn' : 'info';
}

function fold(text: string): string {
  return tr_fold(text);
}

/**
 * Dışa aktarım kontrol listesinin `elements.*` öğeleri (054 §4.5). `notice`, `memo`, `free` için
 * boş dizi (080 §3.3). Dilekçede alt tür yoksa veya katalog dışıysa başlangıç kümesi kullanılır.
 */
export function checkElements(
  doc: PMNode,
  kind: DocumentKind,
  subtype: DocumentSubtype | string | null,
  opts: CheckElementsOptions = {},
): ElementIssue[] {
  if (kind !== 'petition') return [];
  const row = isPetitionSubtype(subtype) ? PETITION_ELEMENT_MATRIX[subtype] : BASE_ROW;
  const firstByRole = new Map<SectionRole, PMNode>();
  doc.forEach((section) => {
    const role = section.attrs.role as SectionRole;
    if (!firstByRole.has(role)) firstByRole.set(role, section);
  });
  const blockIdOf = (section: PMNode | undefined): string | null => {
    const id = section?.attrs.blockId;
    return typeof id === 'string' ? id : null;
  };

  const out: ElementIssue[] = [];
  for (const role of ELEMENT_ROLES) {
    const severity = severityOf(role, row[role]);
    if (severity === null) continue;
    const section = firstByRole.get(role);
    if (!isMissing(role, section)) continue;
    out.push({
      code: `elements.${role}` as ElementIssueCode,
      severity,
      blockId: blockIdOf(section),
      message: `${SECTION_ROLE_LABELS[role]} bölümü eksik veya boş.`,
    });
  }
  if (!isPetitionSubtype(subtype)) return out;

  if ((CLAIM_VALUE_SUBTYPES as readonly string[]).includes(subtype)) {
    const subject = firstByRole.get('subjectLine');
    const label = fold(CLAIM_VALUE_LABEL);
    let found = false;
    subject?.forEach((p) => {
      if (fold(p.textContent).startsWith(label)) found = true;
    });
    if (!found) out.push(info('elements.claimValue', blockIdOf(subject)));
  }
  if ((FILE_NO_SUBTYPES as readonly string[]).includes(subtype)) {
    const header = firstByRole.get('courtHeader');
    const text = header?.textContent ?? '';
    if (!FILE_NO_PATTERN.test(text) || text.includes(PLACEHOLDER_START)) {
      out.push(info('elements.fileNo', blockIdOf(header)));
    }
  }
  const caseType = opts.caseTypeCode ?? null;
  if (
    (MEDIATION_RECORD_SUBTYPES as readonly string[]).includes(subtype) &&
    caseType !== null &&
    (MEDIATION_RECORD_CASE_TYPES as readonly string[]).includes(caseType)
  ) {
    const attachments = fold(ATTACHMENTS_HEADING);
    let hasAttachments = false;
    doc.forEach((section) => {
      const first = section.firstChild;
      if (first?.type.name === 'heading' && fold(first.textContent) === attachments) {
        hasAttachments = true;
      }
    });
    if (!hasAttachments && !fold(doc.textContent).includes(fold(MEDIATION_KEYWORD))) {
      out.push(info('elements.mediationRecord', null));
    }
  }
  return out;
}

function info(code: keyof typeof ELEMENT_INFO_MESSAGES, blockId: string | null): ElementIssue {
  return { code, severity: 'info', blockId, message: ELEMENT_INFO_MESSAGES[code] };
}
