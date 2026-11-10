// Dava türü kataloğu (032 §10.3 tablosu; 39 satır). `app.case_types` seed'inin tek kaynağıdır; seed
// yalnız eşler ve yazar. Hukuk onayı bekliyor: `legalBasis` madde numarasızdır, 082 kesinleştirir.
//
// Alan -> kolon eşlemesi (030 §5, `app.case_types`):
//   code -> code, name -> name, branch -> branch, legalBasis -> legal_basis,
//   sensitiveTopic -> sensitive_topic. `is_active`, `created_at`, `updated_at` DB varsayılanıdır.
import { DEADLINE_BRANCHES, SENSITIVE_TOPIC_CODES } from '@eda/contracts/enums';
import { z } from 'zod';
import { deepFreeze } from '../../catalog-common.ts';

/** `case_types_code_chk` deseni (030 §5). */
export const CASE_TYPE_CODE_PATTERN = /^[a-z0-9._-]{2,64}$/;

export const CaseTypeRowSchema = z.strictObject({
  code: z.string().regex(CASE_TYPE_CODE_PATTERN),
  name: z.string().min(1),
  branch: z.enum(DEADLINE_BRANCHES).nullable(),
  legalBasis: z.string().min(1).nullable(),
  sensitiveTopic: z.enum(SENSITIVE_TOPIC_CODES).nullable(),
});

export type CaseTypeRow = Readonly<z.infer<typeof CaseTypeRowSchema>>;

/** 032 §10.3 dava türü kataloğu; sıra plan tablosuyla aynıdır. */
export const CASE_TYPE_CATALOG: readonly CaseTypeRow[] = deepFreeze<CaseTypeRow[]>([
  {
    code: 'receivable',
    name: 'Alacak davası',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '6098 s. TBK',
  },
  {
    code: 'compensation',
    name: 'Tazminat davası',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '6098 s. TBK',
  },
  {
    code: 'eviction',
    name: 'Tahliye davası',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '6098 s. TBK (Kira)',
  },
  {
    code: 'rent_determination',
    name: 'Kira bedelinin tespiti/uyarlanması',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '6098 s. TBK (Kira)',
  },
  {
    code: 'contract_termination',
    name: 'Sözleşmenin feshi / ifa',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '6098 s. TBK',
  },
  {
    code: 'negative_declaratory',
    name: 'Menfi tespit',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '2004 s. İİK, HMK',
  },
  {
    code: 'objection_annulment',
    name: 'İtirazın iptali',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '2004 s. İİK',
  },
  // 032 §10.3 hücresi "4857 s. İş K. m.18-21"dir; tablo başlığındaki "madde numarasız" kuralı gereği
  // madde numarası yazılmadı (Hukuk onayı bekliyor).
  {
    code: 'reinstatement',
    name: 'İşe iade',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '4857 s. İş K.',
  },
  {
    code: 'labor_receivables',
    name: 'İşçilik alacakları',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '4857 s. İş K.',
  },
  {
    code: 'work_accident',
    name: 'İş kazası tazminatı',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '6098 s. TBK, 5510 s. K.',
  },
  {
    code: 'traffic_accident',
    name: 'Trafik kazası tazminatı',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '2918 s. K., 6098 s. TBK',
  },
  {
    code: 'insurance_claim',
    name: 'Sigorta tazminatı',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '6102 s. TTK',
  },
  {
    code: 'consumer',
    name: 'Tüketici uyuşmazlığı',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '6502 s. K.',
  },
  {
    code: 'commercial_dispute',
    name: 'Ticari dava',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '6102 s. TTK',
  },
  {
    code: 'co_ownership_partition',
    name: 'Ortaklığın giderilmesi',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '4721 s. TMK',
  },
  {
    code: 'land_registry_cancellation',
    name: 'Tapu iptal ve tescil',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '4721 s. TMK',
  },
  {
    code: 'condominium',
    name: 'Kat mülkiyeti',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '634 s. K.',
  },
  {
    code: 'inheritance',
    name: 'Miras hukuku davası',
    branch: 'hmk',
    sensitiveTopic: null,
    legalBasis: '4721 s. TMK',
  },
  {
    code: 'divorce',
    name: 'Boşanma',
    branch: 'hmk',
    sensitiveTopic: 'family',
    legalBasis: '4721 s. TMK',
  },
  {
    code: 'alimony',
    name: 'Nafaka',
    branch: 'hmk',
    sensitiveTopic: 'family',
    legalBasis: '4721 s. TMK',
  },
  {
    code: 'custody',
    name: 'Velayet / kişisel ilişki',
    branch: 'hmk',
    sensitiveTopic: 'child',
    legalBasis: '4721 s. TMK',
  },
  {
    code: 'child_protection',
    name: 'Çocuk koruma',
    branch: 'hmk',
    sensitiveTopic: 'child',
    legalBasis: '5395 s. K.',
  },
  {
    code: 'medical_malpractice',
    name: 'Tıbbi uygulama hatası',
    branch: 'hmk',
    sensitiveTopic: 'health',
    legalBasis: '6098 s. TBK',
  },
  {
    code: 'trade_secret_competition',
    name: 'Ticari sır / haksız rekabet',
    branch: 'hmk',
    sensitiveTopic: 'trade_secret',
    legalBasis: '6102 s. TTK',
  },
  {
    code: 'capital_markets',
    name: 'Sermaye piyasası uyuşmazlığı',
    branch: 'hmk',
    sensitiveTopic: 'capital_markets',
    legalBasis: '6362 s. K.',
  },
  {
    code: 'foreigners_migration',
    name: 'Yabancılar ve uluslararası koruma',
    branch: 'iyuk',
    sensitiveTopic: 'asylum_migration',
    legalBasis: '6458 s. K.',
  },
  {
    code: 'enforcement_proceeding',
    name: 'İcra takibi',
    branch: 'iik',
    sensitiveTopic: null,
    legalBasis: '2004 s. İİK',
  },
  {
    code: 'enforcement_objection',
    name: 'İcra takibine itiraz',
    branch: 'iik',
    sensitiveTopic: null,
    legalBasis: '2004 s. İİK',
  },
  {
    code: 'enforcement_complaint',
    name: 'İcra mahkemesine şikâyet',
    branch: 'iik',
    sensitiveTopic: null,
    legalBasis: '2004 s. İİK',
  },
  {
    code: 'criminal_case',
    name: 'Ceza davası',
    branch: 'cmk',
    sensitiveTopic: 'criminal',
    legalBasis: '5271 s. CMK, 5237 s. TCK',
  },
  {
    code: 'criminal_objection',
    name: 'Ceza yargısında itiraz/istinaf',
    branch: 'cmk',
    sensitiveTopic: 'criminal',
    legalBasis: '5271 s. CMK',
  },
  {
    code: 'admin_annulment',
    name: 'İptal davası (idari)',
    branch: 'iyuk',
    sensitiveTopic: null,
    legalBasis: '2577 s. İYUK',
  },
  {
    code: 'admin_full_remedy',
    name: 'Tam yargı davası',
    branch: 'iyuk',
    sensitiveTopic: null,
    legalBasis: '2577 s. İYUK',
  },
  {
    code: 'tax_dispute',
    name: 'Vergi uyuşmazlığı',
    branch: 'iyuk',
    sensitiveTopic: null,
    legalBasis: '2577 s. İYUK, 213 s. VUK',
  },
  {
    code: 'zoning',
    name: 'İmar uyuşmazlığı',
    branch: 'iyuk',
    sensitiveTopic: null,
    legalBasis: '3194 s. K.',
  },
  {
    code: 'expropriation',
    name: 'Kamulaştırma',
    branch: 'iyuk',
    sensitiveTopic: null,
    legalBasis: '2942 s. K.',
  },
  {
    code: 'public_procurement',
    name: 'Kamu ihale uyuşmazlığı',
    branch: 'iyuk',
    sensitiveTopic: null,
    legalBasis: '4734 s. K.',
  },
  {
    code: 'mediation',
    name: 'Arabuluculuk',
    branch: 'mediation',
    sensitiveTopic: null,
    legalBasis: '6325 s. HUAK',
  },
  { code: 'other', name: 'Diğer', branch: null, sensitiveTopic: null, legalBasis: null },
]);
