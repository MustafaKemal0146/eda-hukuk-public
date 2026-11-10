// Rol başı yerleşim varsayılanları (054 §11.3; 084 §5.2, §5.3). Değerler 084 ölçümüyle güncellenir.
import type { DocAstAlign, DocAstParagraph, DocAstSection } from '@eda/contracts/docast';
import type { SectionRole } from '@eda/contracts/enums';

/** Metin sütunu genişliği: A4 210 mm - sol 25 - sağ 20 (084 §5.1, D3). */
export const TEXT_WIDTH_MM = 165;
/** Taraf/konu etiket sütunu (054 §5.4). */
export const LABEL_COLUMN_MM = 30;
/** İmza kutusu genişliği (084 D4). */
export const SIGNATURE_BOX_WIDTH_MM = 70;
/** CSS px -> mm (96 dpi: 1 mm = 3.7795 px; 054 §11.3). */
export const PX_PER_MM = 3.7795;

export type RoleLayout = {
  align: DocAstAlign;
  indent: DocAstParagraph['indent'];
  hangingMm: number | null;
  tabStopsMm: number[];
  layout: DocAstSection['layout'];
  boxWidthMm: number | null;
  keepTogether: boolean;
};

const FLOW = { layout: 'flow', boxWidthMm: null, keepTogether: false } as const;
const BODY: RoleLayout = {
  align: 'justify',
  indent: 'first_line',
  hangingMm: null,
  tabStopsMm: [],
  ...FLOW,
};
const HANGING: RoleLayout = {
  align: 'justify',
  indent: 'hanging',
  hangingMm: LABEL_COLUMN_MM,
  tabStopsMm: [LABEL_COLUMN_MM],
  ...FLOW,
};

export const ROLE_DEFAULTS: Readonly<Record<SectionRole, RoleLayout>> = {
  courtHeader: { ...BODY, align: 'center', indent: 'none' },
  partiesGrid: HANGING,
  subjectLine: HANGING,
  numberedExplanations: BODY,
  legalGrounds: BODY,
  evidenceList: BODY,
  resultAndRequest: BODY,
  attorneySignature: {
    align: 'center',
    indent: 'none',
    hangingMm: null,
    tabStopsMm: [],
    layout: 'right_box',
    boxWidthMm: SIGNATURE_BOX_WIDTH_MM,
    keepTogether: true,
  },
  generic: BODY,
  freeSection: BODY,
};

/** Başlıklar rol varsayılanı değil sola yaslıdır (054 §11.3). */
export const HEADING_ALIGN: DocAstAlign = 'left';
