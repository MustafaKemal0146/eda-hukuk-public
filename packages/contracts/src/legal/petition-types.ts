// Dilekçe/belge alt tür kataloğu, takma adlar ve zorunlu unsur matrisi (080 §1.3, §1.4, §3).
// Saf veri; içerik 080'den aynen aktarılmıştır ve HUKUK ONAYI BEKLİYOR (080 Durum).
// "Dayanak" alanları doğrulanmamıştır. Hatıradan ekleme/çıkarma yapılmaz.
// Belirsiz alacak davası katalogda ve takma adlarda YOKTUR (080 §10, Y-82; KK-080-1).
// `PARTY_LABELS`, `SUBJECT_LINES`, `COURT_HEADER_PATTERNS`, `resolveSubtype` P18a'dadır.
import {
  type DeadlineBranch,
  DOCUMENT_SUBTYPES,
  type DocumentKind,
  type DocumentSubtype,
  type SectionRole,
} from '../enums.ts';

export { DOCUMENT_SUBTYPES, type DocumentSubtype };

/** 080 §1.3 `Kapsam` sütunu: MVP-şablonlu, MVP-türü, V1.1. */
export const PETITION_SCOPES = ['mvp_template', 'mvp_type', 'v1_1'] as const;
export type PetitionScope = (typeof PETITION_SCOPES)[number];

export type PetitionTemplateRef = {
  /** Platform şablonu `slug` (032 §10.7). */
  slug: string;
  /** Dava türüne özgü şablonlarda `case_type_code`. */
  caseTypeCode: string | null;
};

export type PetitionCatalogEntry = {
  code: DocumentSubtype;
  name: string;
  kind: DocumentKind;
  /** Süre stratejisi (`deadline_rules.branch`); boş dizi = yok. */
  branches: readonly DeadlineBranch[];
  branchNote: string | null;
  /** Muhatap (merci başlığı). */
  addressee: string;
  /** Süre kuralı bağı (`deadline_rules.code`, 032 §10.5). */
  deadlineRuleCodes: readonly string[];
  deadlineRuleNote: string | null;
  /** Dayanak (doğrulanacak); `null` = belirtilmemiş. */
  basis: string | null;
  templates: readonly PetitionTemplateRef[];
  templateNote: string | null;
  scope: PetitionScope;
};

const SAME_COURT = 'Davanın görüldüğü mahkeme (dosya no ile)';

/** 080 §1.3 (22 kod; sıra `DOCUMENT_SUBTYPES` ile aynı). "Aynı" hücreleri önceki satırın değeridir. */
export const PETITION_CATALOG: readonly PetitionCatalogEntry[] = [
  {
    code: 'claim',
    name: 'Dava dilekçesi',
    kind: 'petition',
    branches: ['hmk'],
    branchNote: 'özel kanunlarda iyuk/iik ayrı türler',
    addressee: 'İlk derece mahkemesi',
    deadlineRuleCodes: [],
    deadlineRuleNote:
      'Koşullu: genel kural yok; dava açma süresi dava türüne bağlı (ör. hmk_ise_iade_dava, med_* dava şartı)',
    basis: 'HMK m.119; dava şartı arabuluculuk: 6325 s. K. m.18/A, 7036 s. K. m.3, TTK m.5/A',
    templates: [
      { slug: 'petition-claim-generic', caseTypeCode: null },
      { slug: 'petition-reinstatement', caseTypeCode: 'reinstatement' },
    ],
    templateNote: null,
    scope: 'mvp_template',
  },
  {
    code: 'answer',
    name: 'Cevap dilekçesi',
    kind: 'petition',
    branches: ['hmk'],
    branchNote: null,
    addressee: SAME_COURT,
    deadlineRuleCodes: ['hmk_cevap_dilekcesi'],
    deadlineRuleNote: null,
    basis: 'HMK m.127 (süre), m.129 (içerik)',
    templates: [{ slug: 'petition-answer-generic', caseTypeCode: null }],
    templateNote: null,
    scope: 'mvp_template',
  },
  {
    code: 'reply',
    name: 'Cevaba cevap dilekçesi (replik)',
    kind: 'petition',
    branches: ['hmk'],
    branchNote: null,
    addressee: SAME_COURT,
    deadlineRuleCodes: ['hmk_replik_dilekcesi'],
    deadlineRuleNote: null,
    basis: 'HMK m.136',
    templates: [{ slug: 'petition-reply-rejoinder', caseTypeCode: null }],
    templateNote: null,
    scope: 'mvp_template',
  },
  {
    code: 'rejoinder',
    name: 'İkinci cevap dilekçesi (düplik)',
    kind: 'petition',
    branches: ['hmk'],
    branchNote: null,
    addressee: SAME_COURT,
    deadlineRuleCodes: ['hmk_duplik_dilekcesi'],
    deadlineRuleNote: null,
    basis: 'HMK m.136',
    templates: [{ slug: 'petition-reply-rejoinder', caseTypeCode: null }],
    templateNote: null,
    scope: 'mvp_template',
  },
  {
    code: 'claim_correction',
    name: 'Islah dilekçesi',
    kind: 'petition',
    branches: ['hmk'],
    branchNote: null,
    addressee: SAME_COURT,
    deadlineRuleCodes: [],
    deadlineRuleNote: 'Yok (takvim kuralı yok; ıslahın zamanı sınırı hukuki konudur)',
    basis: 'HMK m.176–182',
    templates: [],
    templateNote: null,
    scope: 'v1_1',
  },
  {
    code: 'expert_report_objection',
    name: 'Bilirkişi raporuna itiraz dilekçesi',
    kind: 'petition',
    branches: ['hmk'],
    branchNote: null,
    addressee: SAME_COURT,
    deadlineRuleCodes: ['hmk_bilirkisi_raporuna_itiraz'],
    deadlineRuleNote: 'güven C',
    basis: 'HMK m.281',
    templates: [],
    templateNote: null,
    scope: 'v1_1',
  },
  {
    code: 'interim_injunction_objection',
    name: 'İhtiyati tedbire itiraz dilekçesi',
    kind: 'petition',
    branches: ['hmk'],
    branchNote: null,
    addressee: SAME_COURT,
    deadlineRuleCodes: ['hmk_ihtiyati_tedbir_itiraz'],
    deadlineRuleNote: 'güven C',
    basis: 'HMK m.394',
    templates: [],
    templateNote: null,
    scope: 'v1_1',
  },
  {
    code: 'excuse',
    name: 'Mazeret dilekçesi (duruşma/süre mazereti)',
    kind: 'petition',
    branches: ['hmk'],
    branchNote: 'diğer kollarda da kullanılır',
    addressee: SAME_COURT,
    deadlineRuleCodes: [],
    deadlineRuleNote: 'Yok (süre = duruşma tarihi veya ilgili işlemin süre sonu; kullanıcı girer)',
    basis: 'Mazeret/eski hâle getirme hükümleri (madde numarası doğrulanacak)',
    templates: [],
    templateNote: null,
    scope: 'v1_1',
  },
  {
    code: 'general_statement',
    name: 'Beyan / talep dilekçesi (genel)',
    kind: 'petition',
    branches: [],
    branchNote: null,
    addressee: SAME_COURT,
    deadlineRuleCodes: [],
    deadlineRuleNote: 'Yok',
    basis: null,
    templates: [],
    templateNote: null,
    scope: 'v1_1',
  },
  {
    code: 'appeal_regional',
    name: 'İstinaf dilekçesi',
    kind: 'petition',
    branches: ['hmk', 'cmk', 'iyuk'],
    branchNote: 'dava türünden gelir',
    addressee: 'İlk derece mahkemesi aracılığıyla bölge adliye/bölge idare mahkemesi (080 §5.3)',
    deadlineRuleCodes: ['hmk_istinaf_basvuru', 'cmk_istinaf', 'iyuk_istinaf'],
    deadlineRuleNote: null,
    basis: 'HMK m.341 vd., m.345; CMK m.273; İYUK m.45 (7589 s. K. ile değişti)',
    templates: [{ slug: 'petition-istinaf', caseTypeCode: null }],
    templateNote: null,
    scope: 'mvp_template',
  },
  {
    code: 'appeal_cassation',
    name: 'Temyiz dilekçesi',
    kind: 'petition',
    branches: ['hmk', 'cmk', 'iyuk'],
    branchNote: null,
    addressee: 'Karar veren mahkeme aracılığıyla Yargıtay/Danıştay',
    deadlineRuleCodes: ['hmk_temyiz_basvuru', 'cmk_temyiz', 'iyuk_temyiz'],
    deadlineRuleNote: null,
    basis: 'HMK m.361; CMK m.291; İYUK m.46 (7589 s. K. ile değişti)',
    templates: [{ slug: 'petition-temyiz', caseTypeCode: null }],
    templateNote: null,
    scope: 'mvp_template',
  },
  {
    code: 'enforcement_request',
    name: 'İcra takip talebi',
    kind: 'petition',
    branches: ['iik'],
    branchNote: null,
    addressee: 'İcra müdürlüğü',
    deadlineRuleCodes: [],
    deadlineRuleNote: 'Yok',
    basis: 'İİK m.58 vd. (doğrulanacak)',
    templates: [],
    templateNote: null,
    scope: 'v1_1',
  },
  {
    code: 'enforcement_objection',
    name: 'İcra takibine itiraz (ödeme emrine/borca/imzaya itiraz)',
    kind: 'petition',
    branches: ['iik'],
    branchNote: null,
    addressee: 'İcra müdürlüğü (dosya no ile)',
    deadlineRuleCodes: ['iik_odeme_emrine_itiraz', 'iik_imzaya_itiraz'],
    deadlineRuleNote: null,
    basis: 'İİK m.62, m.60',
    templates: [{ slug: 'petition-enforcement-objection', caseTypeCode: 'enforcement_objection' }],
    templateNote: null,
    scope: 'mvp_template',
  },
  {
    code: 'enforcement_complaint',
    name: 'İcra mahkemesine şikâyet',
    kind: 'petition',
    branches: ['iik'],
    branchNote: null,
    addressee: 'İcra hukuk mahkemesi',
    deadlineRuleCodes: ['iik_sikayet'],
    deadlineRuleNote: null,
    basis: 'İİK m.16',
    templates: [{ slug: 'petition-enforcement-complaint', caseTypeCode: 'enforcement_complaint' }],
    templateNote: null,
    scope: 'mvp_template',
  },
  {
    code: 'mediation_application',
    name: 'Arabuluculuk başvurusu',
    kind: 'petition',
    branches: ['mediation'],
    branchNote: null,
    addressee: 'Arabuluculuk bürosu (adliye)',
    deadlineRuleCodes: [
      'med_dava_sarti_genel',
      'med_dava_sarti_ticari',
      'is_ise_iade_arabulucu_basvuru',
    ],
    deadlineRuleNote: 'süre sayacı görevlendirmeden/ilgili olaydan başlar, 083',
    basis: '6325 s. K. m.18/A; 7036 s. K. m.3; TTK m.5/A',
    templates: [],
    templateNote: null,
    scope: 'v1_1',
  },
  {
    code: 'administrative_claim',
    name: 'İdari dava dilekçesi (iptal / tam yargı)',
    kind: 'petition',
    branches: ['iyuk'],
    branchNote: null,
    addressee: 'İdare mahkemesi',
    deadlineRuleCodes: ['iyuk_dava_acma_idare'],
    deadlineRuleNote: null,
    basis: 'İYUK m.2, m.3 (dilekçe içeriği), m.7 (süre)',
    templates: [{ slug: 'petition-admin-annulment', caseTypeCode: 'admin_annulment' }],
    templateNote: 'tam yargı şablonu V1.1',
    scope: 'mvp_template',
  },
  {
    code: 'tax_claim',
    name: 'Vergi davası dilekçesi',
    kind: 'petition',
    branches: ['iyuk'],
    branchNote: null,
    addressee: 'Vergi mahkemesi',
    deadlineRuleCodes: ['iyuk_dava_acma_vergi'],
    deadlineRuleNote: 'güven C',
    basis: 'İYUK m.3, m.7; VUK',
    templates: [],
    templateNote: null,
    scope: 'v1_1',
  },
  {
    code: 'criminal_complaint',
    name: 'Suç duyurusu / şikâyet dilekçesi',
    kind: 'petition',
    branches: ['cmk'],
    branchNote: null,
    addressee: 'Cumhuriyet başsavcılığı',
    deadlineRuleCodes: [],
    deadlineRuleNote: 'Yok (şikâyet süresi suça göre değişir; kural kataloğunda yok)',
    basis: 'CMK m.158; TCK şikâyet süresi hükmü (doğrulanacak)',
    templates: [],
    templateNote: null,
    scope: 'v1_1',
  },
  {
    code: 'criminal_objection',
    name: 'Kovuşturmaya yer olmadığı kararına itiraz',
    kind: 'petition',
    branches: ['cmk'],
    branchNote: null,
    addressee: 'Sulh ceza hâkimliği',
    deadlineRuleCodes: ['cmk_kyok_itiraz'],
    deadlineRuleNote: 'güven C',
    basis: 'CMK m.173',
    templates: [{ slug: 'petition-criminal-objection', caseTypeCode: 'criminal_objection' }],
    templateNote: null,
    scope: 'mvp_template',
  },
  {
    code: 'notice_general',
    name: 'İhtarname',
    kind: 'notice',
    branches: [],
    branchNote: null,
    addressee:
      'Muhatap (mahkemeye sunulmaz; noter aracılığıyla gönderilir, Noterlik Kanunu — madde doğrulanacak)',
    deadlineRuleCodes: [],
    deadlineRuleNote:
      'Koşullu: ihtarla verilen süre kullanıcıdan gelir (modele bırakılmaz, 024 §6.3)',
    basis: null,
    templates: [{ slug: 'notice-general', caseTypeCode: null }],
    templateNote: null,
    scope: 'mvp_template',
  },
  {
    code: 'memo_legal_opinion',
    name: 'Hukuki mütalaa',
    kind: 'memo',
    branches: [],
    branchNote: null,
    addressee: 'Yok (müvekkil/iç kullanım)',
    deadlineRuleCodes: [],
    deadlineRuleNote: 'Yok',
    basis: 'Av.K. m.35 (mütalaa verme yetkisi avukata aittir)',
    templates: [{ slug: 'memo-legal-opinion', caseTypeCode: null }],
    templateNote: null,
    scope: 'mvp_template',
  },
  {
    code: 'free_blank',
    name: 'Boş belge',
    kind: 'free',
    branches: [],
    branchNote: null,
    addressee: 'Yok',
    deadlineRuleCodes: [],
    deadlineRuleNote: 'Yok',
    basis: null,
    templates: [{ slug: 'free-blank', caseTypeCode: null }],
    templateNote: null,
    scope: 'mvp_template',
  },
];

// ---------- Takma adlar (080 §1.4) ----------

/** Bağlama bağlı takma adlar: bağlam yoksa çözüm `null` (080 §1.4). */
export const SUBTYPE_ALIAS_CONTEXTS = ['enforcement', 'criminal'] as const;
export type SubtypeAliasContext = (typeof SUBTYPE_ALIAS_CONTEXTS)[number];

export type SubtypeAlias = {
  /** `tr_fold` ile katlanmış yazım; tam eşleşme (alt dize değil). */
  folded: string;
  context: SubtypeAliasContext | null;
};

const plain = (...folded: string[]): SubtypeAlias[] =>
  folded.map((f) => ({ folded: f, context: null }));

export const SUBTYPE_ALIASES: Readonly<Record<DocumentSubtype, readonly SubtypeAlias[]>> = {
  claim: plain('dava', 'dava dilekcesi', 'dava acma dilekcesi', 'claim'),
  answer: plain('cevap', 'cevap dilekcesi', 'davaya cevap', 'davaya cevap dilekcesi'),
  reply: plain('cevaba cevap', 'cevaba cevap dilekcesi', 'replik', 'replik dilekcesi'),
  rejoinder: plain('ikinci cevap', 'ikinci cevap dilekcesi', 'duplik', 'duplik dilekcesi'),
  claim_correction: plain('islah', 'islah dilekcesi'),
  expert_report_objection: plain('bilirkisi raporuna itiraz', 'bilirkisi itirazi'),
  interim_injunction_objection: plain('ihtiyati tedbire itiraz', 'tedbire itiraz'),
  excuse: plain('mazeret', 'mazeret dilekcesi', 'durusma mazereti'),
  general_statement: plain('beyan', 'beyan dilekcesi', 'talep dilekcesi'),
  appeal_regional: plain('istinaf', 'istinaf dilekcesi', 'istinaf basvurusu'),
  appeal_cassation: plain('temyiz', 'temyiz dilekcesi', 'temyiz basvurusu'),
  enforcement_request: plain('icra takip talebi', 'takip talebi'),
  enforcement_objection: [
    ...plain('icra takibine itiraz', 'odeme emrine itiraz'),
    { folded: 'itiraz dilekcesi', context: 'enforcement' },
  ],
  enforcement_complaint: [
    ...plain('icra mahkemesine sikayet'),
    { folded: 'sikayet dilekcesi', context: 'enforcement' },
  ],
  mediation_application: plain('arabuluculuk basvurusu', 'arabulucuya basvuru'),
  administrative_claim: plain(
    'idari dava',
    'iptal davasi',
    'idari dava dilekcesi',
    'tam yargi davasi',
  ),
  tax_claim: plain('vergi davasi', 'vergi dava dilekcesi'),
  criminal_complaint: [
    ...plain('suc duyurusu', 'suc duyurusu dilekcesi'),
    { folded: 'sikayet dilekcesi', context: 'criminal' },
  ],
  criminal_objection: plain('kyok itirazi', 'kovusturmaya yer olmadigi kararina itiraz'),
  notice_general: plain('ihtarname', 'ihtar'),
  memo_legal_opinion: plain('mutalaa', 'hukuki mutalaa'),
  free_blank: plain('bos belge', 'serbest belge'),
};

// ---------- Tür × unsur matrisi (080 §3.1) ----------

/** Matris sütunları: unsur rolleri (CH PG SL NE LG EV RR AS). */
export const ELEMENT_ROLES = [
  'courtHeader',
  'partiesGrid',
  'subjectLine',
  'numberedExplanations',
  'legalGrounds',
  'evidenceList',
  'resultAndRequest',
  'attorneySignature',
] as const satisfies readonly SectionRole[];
export type ElementRole = (typeof ELEMENT_ROLES)[number];

/** Z = Zorunlu, K = Koşullu (koşul kullanıcıya sorulur), Y = Yok (080 §3). */
export const ELEMENT_REQUIREMENTS = ['Z', 'K', 'Y'] as const;
export type ElementRequirement = (typeof ELEMENT_REQUIREMENTS)[number];

/** `petition` türündeki 19 alt tür (matris satırları). */
export const PETITION_SUBTYPES = [
  'claim',
  'answer',
  'reply',
  'rejoinder',
  'claim_correction',
  'expert_report_objection',
  'interim_injunction_objection',
  'excuse',
  'general_statement',
  'appeal_regional',
  'appeal_cassation',
  'enforcement_request',
  'enforcement_objection',
  'enforcement_complaint',
  'mediation_application',
  'administrative_claim',
  'tax_claim',
  'criminal_complaint',
  'criminal_objection',
] as const satisfies readonly DocumentSubtype[];
export type PetitionSubtype = (typeof PETITION_SUBTYPES)[number];

export type ElementRow = Readonly<Record<ElementRole, ElementRequirement>>;

/** Tablo satırını (CH PG SL NE LG EV RR AS sırasıyla 8 harf) rol kaydına çevirir. */
function row(cells: string): ElementRow {
  const out: Partial<Record<ElementRole, ElementRequirement>> = {};
  ELEMENT_ROLES.forEach((role, i) => {
    const c = cells[i];
    if (c !== 'Z' && c !== 'K' && c !== 'Y') throw new Error(`geçersiz matris hücresi: ${cells}`);
    out[role] = c;
  });
  if (cells.length !== ELEMENT_ROLES.length) throw new Error(`eksik matris satırı: ${cells}`);
  return out as ElementRow;
}

/** 080 §3.1; sütun sırası CH PG SL NE LG EV RR AS. */
export const PETITION_ELEMENT_MATRIX: Readonly<Record<PetitionSubtype, ElementRow>> = {
  claim: row('ZZZZZZZZ'),
  answer: row('ZZZZZKZZ'),
  reply: row('ZZZZKKZZ'),
  rejoinder: row('ZZZZKKZZ'),
  claim_correction: row('ZZZZKKZZ'),
  expert_report_objection: row('ZKZZKKZZ'),
  interim_injunction_objection: row('ZZZZZKZZ'),
  excuse: row('ZKZZKKZZ'),
  general_statement: row('ZKZZKKZZ'),
  appeal_regional: row('ZZZZZKZZ'),
  appeal_cassation: row('ZZZZZKZZ'),
  enforcement_request: row('ZZZZKKZZ'),
  enforcement_objection: row('ZZZZKKZZ'),
  enforcement_complaint: row('ZZZZKKZZ'),
  mediation_application: row('ZZZZKKZZ'),
  administrative_claim: row('ZZZZZKZZ'),
  tax_claim: row('ZZZZZKZZ'),
  criminal_complaint: row('ZZZZKKZZ'),
  criminal_objection: row('ZZZZZKZZ'),
};

/** En yüksek düzeyi `info` olan roller (080 §4 kural 2; 054 §4.4). */
export const ELEMENT_INFO_CAPPED_ROLES = [
  'legalGrounds',
  'evidenceList',
] as const satisfies readonly ElementRole[];

// ---------- Matris dışı bilgi kontrolleri (080 §3.2) ----------

export const CLAIM_VALUE_SUBTYPES = ['claim'] as const satisfies readonly PetitionSubtype[];

export const FILE_NO_SUBTYPES = [
  'answer',
  'reply',
  'rejoinder',
  'claim_correction',
  'expert_report_objection',
  'interim_injunction_objection',
  'excuse',
  'general_statement',
  'enforcement_objection',
  'enforcement_complaint',
] as const satisfies readonly PetitionSubtype[];

export const MEDIATION_RECORD_SUBTYPES = ['claim'] as const satisfies readonly PetitionSubtype[];

/** 080 Açık Soru 10: bilgi satırının gösterildiği dava türleri (hukuk onayında daralır/genişler). */
export const MEDIATION_RECORD_CASE_TYPES = [
  'reinstatement',
  'labor_receivables',
  'consumer',
  'eviction',
  'rent_determination',
  'commercial_dispute',
  'receivable',
  'co_ownership_partition',
  'condominium',
] as const;

/** `subjectLine` dava değeri etiketi (080 §2.3, §3.2). */
export const CLAIM_VALUE_LABEL = 'DAVA DEĞERİ';
/** Ekler bölüm başlığı (080 §2.1). */
export const ATTACHMENTS_HEADING = 'EKLER';
/** `elements.mediationRecord` metin denetimi sözcüğü (080 §3.2). */
export const MEDIATION_KEYWORD = 'arabuluculuk';
/** `elements.fileNo`: `courtHeader` metninde dosya numarası deseni (080 §3.2). */
export const FILE_NO_PATTERN = /\d{4}\/\d{1,7}/;

/** 080 §3.2 mesajları (aynen). */
export const ELEMENT_INFO_MESSAGES = {
  'elements.claimValue':
    'Malvarlığı haklarına ilişkin davalarda dava konusunun değeri belirtilir (HMK m.119). Dava değeri yoksa bu uyarıyı yok sayabilirsiniz.',
  'elements.fileNo': 'Dosya numarası belirtilmemiş.',
  'elements.mediationRecord':
    'Dava şartı arabuluculuk kapsamındaki uyuşmazlıklarda son tutanağın dilekçeye eklenmesi gerekebilir; kapsamı avukat belirler.',
} as const;
