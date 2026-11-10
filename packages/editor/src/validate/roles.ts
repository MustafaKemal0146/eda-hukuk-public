// Rol içerik kuralları (054 §4.2; model farkı 024 §6.4). Şema her role aynı içerik ifadesini verir;
// rol kuralları burada denetlenir, böylece rol değişimi ve içe aktarma şema hatası üretmez (§2.4).
import type { SectionRole } from '@eda/contracts/enums';

export type SectionChildType = 'heading' | 'paragraph' | 'orderedList' | 'bulletList' | 'table';
export type ValidationProfile = 'user' | 'model';

export type RoleRule = {
  /** `user` profilinde izinli doğrudan çocuklar. */
  user: readonly SectionChildType[];
  /** `model` profilinde izinli çocuklar; `null` = model bu rolü yazamaz (deterministik blok). */
  model: readonly SectionChildType[] | null;
  /** Başlık yalnız ilk çocuk olabilir. */
  headingFirstOnly: boolean;
  /** En çok doğrudan çocuk sayısı (yalnız paragraf rolleri); `null` = sınırsız. */
  maxChildren: number | null;
  /** İzinli işaretler; `null` = tümü. */
  marks: readonly string[] | null;
};

const ALL: readonly SectionChildType[] = [
  'heading',
  'paragraph',
  'orderedList',
  'bulletList',
  'table',
];
const ALL_MARKS_BUT_LINK = ['bold', 'italic', 'underline', 'strike'] as const;

/** 054 §4.2 tablosu. "En az 1 içerik ögesi" şemanın `+` ifadesiyle sağlanır. */
export const ROLE_RULES: Readonly<Record<SectionRole, RoleRule>> = {
  courtHeader: {
    user: ['paragraph'],
    model: ['paragraph'],
    headingFirstOnly: true,
    maxChildren: 4,
    marks: ['bold'],
  },
  partiesGrid: {
    user: ['paragraph'],
    model: null,
    headingFirstOnly: true,
    maxChildren: 20,
    marks: null,
  },
  subjectLine: {
    user: ['paragraph'],
    model: ['paragraph'],
    headingFirstOnly: true,
    maxChildren: 6,
    marks: null,
  },
  numberedExplanations: {
    user: ['heading', 'orderedList', 'paragraph', 'table'],
    model: ['heading', 'orderedList', 'paragraph'],
    headingFirstOnly: true,
    maxChildren: null,
    marks: null,
  },
  legalGrounds: {
    user: ['heading', 'paragraph', 'bulletList', 'orderedList'],
    model: ['heading', 'paragraph', 'bulletList'],
    headingFirstOnly: true,
    maxChildren: null,
    marks: null,
  },
  evidenceList: {
    user: ['heading', 'orderedList', 'paragraph'],
    model: ['heading', 'orderedList'],
    headingFirstOnly: true,
    maxChildren: null,
    marks: null,
  },
  resultAndRequest: {
    user: ['heading', 'paragraph', 'orderedList'],
    model: ['heading', 'paragraph', 'orderedList'],
    headingFirstOnly: true,
    maxChildren: null,
    marks: null,
  },
  attorneySignature: {
    user: ['paragraph'],
    model: null,
    headingFirstOnly: true,
    maxChildren: 6,
    marks: ALL_MARKS_BUT_LINK,
  },
  generic: { user: ALL, model: ALL, headingFirstOnly: false, maxChildren: null, marks: null },
  freeSection: { user: ALL, model: ALL, headingFirstOnly: false, maxChildren: null, marks: null },
};

/** Belgede en çok bir kez geçmesi beklenen roller (054 §4.3 `role.duplicate`). */
export const SINGLETON_ROLES = [
  'courtHeader',
  'partiesGrid',
  'subjectLine',
  'resultAndRequest',
  'attorneySignature',
] as const satisfies readonly SectionRole[];

/** Model op'larının değiştiremediği korumalı roller (054 §6.3). */
export const PROTECTED_ROLES = [
  'partiesGrid',
  'attorneySignature',
] as const satisfies readonly SectionRole[];

/** Tablo sınırları (054 §2.7; 024 §6.2 `BlockItem` ile aynı, sabit). */
export const TABLE_MAX_ROWS = 40;
export const TABLE_MAX_COLS = 8;

/** Yer tutucu biçimi (054 §4.3, 080 §4 kural 6). */
export const PLACEHOLDER_PATTERN = /\[\[Doldurulacak:[^\]]{1,200}\]\]/;
