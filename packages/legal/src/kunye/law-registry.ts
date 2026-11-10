// Kanun kayıt defteri (034 §9.1): haftalık mevzuat anlık görüntüsünün çalışma listesi (`snapshot: true`).
// Kısaltma ve takma adlar `law-aliases.ts`'ten (081 §6, tek kaynak) okunur, burada yinelenmez. Kanun
// adı yalnız 081 §6 tablosunda yazılı olanlardır; tabloda olmayan veya adı "doğrulanacak" işaretli
// kayıtlarda `title: null` (ad alım sırasında kaynaktan okunur). 1447 sayılı Kanun listede YOKTUR
// (081 §6.2 dışlananlar). Liste tek PR ile genişler. Saf veri.
import { MCP_TO_LAW_TYPE } from '@eda/contracts/api';
import type { LawType, McpLawType } from '@eda/contracts/enums';
import { lawByNo } from './law-aliases.ts';

export type LawRegistryGroup =
  | 'medeni_borclar_ticaret'
  | 'usul'
  | 'ceza'
  | 'is_sosyal_guvenlik'
  | 'tuketici_rekabet_fikri_kvkk'
  | 'vergi'
  | 'idare'
  | 'aile_diger'
  | 'yargi_anayasa';

export type LawRegistryEntry = {
  lawNo: string;
  /** `corpus.laws.law_type` (030); anayasa `constitution`, diğerleri `law`. */
  lawType: LawType;
  /** MCP `get_legislation_live` türü (021); anayasa da `kanun` türüyle istenir. */
  mcpLawType: McpLawType;
  group: LawRegistryGroup;
  /** 081 §6 tablosundaki ad; yoksa `null`. */
  title: string | null;
  /** Görüntü kısaltması (`law-aliases.ts`); yoksa `null` (gösterim "{no} s. K."). */
  abbr: string | null;
  aliases: readonly string[];
  snapshot: boolean;
  /** Ad veya kısaltma 081 §6.2'den: hukuk onayı bekliyor. */
  unverified: boolean;
};

type Row = readonly [lawNo: string, group: LawRegistryGroup, title: string | null];

/** 034 §9.1 başlangıç kümesi; adlar 081 §6.1–§6.2. */
const ROWS: readonly Row[] = [
  ['4721', 'medeni_borclar_ticaret', 'Türk Medeni Kanunu'],
  ['6098', 'medeni_borclar_ticaret', 'Türk Borçlar Kanunu'],
  ['6102', 'medeni_borclar_ticaret', 'Türk Ticaret Kanunu'],
  ['634', 'medeni_borclar_ticaret', 'Kat Mülkiyeti Kanunu'],
  ['2644', 'medeni_borclar_ticaret', 'Tapu Kanunu'],
  ['6750', 'medeni_borclar_ticaret', 'Ticari İşlemlerde Taşınır Rehni Kanunu'],
  ['5718', 'medeni_borclar_ticaret', 'Milletlerarası Özel Hukuk ve Usul Hukuku Hakkında Kanun'],
  ['6100', 'usul', 'Hukuk Muhakemeleri Kanunu'],
  ['5271', 'usul', 'Ceza Muhakemesi Kanunu'],
  ['2004', 'usul', 'İcra ve İflas Kanunu'],
  ['2577', 'usul', 'İdari Yargılama Usulü Kanunu'],
  ['7201', 'usul', 'Tebligat Kanunu'],
  ['6325', 'usul', 'Hukuk Uyuşmazlıklarında Arabuluculuk Kanunu'],
  ['492', 'usul', 'Harçlar Kanunu'],
  ['6754', 'usul', 'Bilirkişilik Kanunu'],
  ['1512', 'usul', 'Noterlik Kanunu'],
  ['1136', 'usul', 'Avukatlık Kanunu'],
  ['5237', 'ceza', 'Türk Ceza Kanunu'],
  ['5326', 'ceza', 'Kabahatler Kanunu'],
  ['5275', 'ceza', 'Ceza ve Güvenlik Tedbirlerinin İnfazı Hakkında Kanun'],
  ['5395', 'ceza', 'Çocuk Koruma Kanunu'],
  ['4857', 'is_sosyal_guvenlik', 'İş Kanunu'],
  ['7036', 'is_sosyal_guvenlik', 'İş Mahkemeleri Kanunu'],
  ['6331', 'is_sosyal_guvenlik', 'İş Sağlığı ve Güvenliği Kanunu'],
  ['5510', 'is_sosyal_guvenlik', 'Sosyal Sigortalar ve Genel Sağlık Sigortası Kanunu'],
  ['6356', 'is_sosyal_guvenlik', 'Sendikalar ve Toplu İş Sözleşmesi Kanunu'],
  ['6502', 'tuketici_rekabet_fikri_kvkk', 'Tüketicinin Korunması Hakkında Kanun'],
  ['4054', 'tuketici_rekabet_fikri_kvkk', 'Rekabetin Korunması Hakkında Kanun'],
  ['5846', 'tuketici_rekabet_fikri_kvkk', 'Fikir ve Sanat Eserleri Kanunu'],
  ['6769', 'tuketici_rekabet_fikri_kvkk', 'Sınai Mülkiyet Kanunu'],
  ['6698', 'tuketici_rekabet_fikri_kvkk', 'Kişisel Verilerin Korunması Kanunu'],
  [
    '5651',
    'tuketici_rekabet_fikri_kvkk',
    'İnternet Ortamında Yapılan Yayınların Düzenlenmesi Hakkında Kanun',
  ],
  ['213', 'vergi', 'Vergi Usul Kanunu'],
  ['193', 'vergi', 'Gelir Vergisi Kanunu'],
  ['5520', 'vergi', 'Kurumlar Vergisi Kanunu'],
  ['3065', 'vergi', 'Katma Değer Vergisi Kanunu'],
  // 7338: 034 §9.1 listesinde, 081 §6 sözlüğünde yok; ad ve kısaltma kaynaktan okunur.
  ['7338', 'vergi', null],
  ['6183', 'vergi', 'Amme Alacaklarının Tahsil Usulü Hakkında Kanun'],
  ['4734', 'idare', 'Kamu İhale Kanunu'],
  ['4735', 'idare', 'Kamu İhale Sözleşmeleri Kanunu'],
  ['2886', 'idare', 'Devlet İhale Kanunu'],
  ['2942', 'idare', 'Kamulaştırma Kanunu'],
  ['3194', 'idare', 'İmar Kanunu'],
  ['657', 'idare', 'Devlet Memurları Kanunu'],
  ['5018', 'idare', 'Kamu Mali Yönetimi ve Kontrol Kanunu'],
  ['6284', 'aile_diger', 'Ailenin Korunması ve Kadına Karşı Şiddetin Önlenmesine Dair Kanun'],
  ['2918', 'aile_diger', 'Karayolları Trafik Kanunu'],
  ['6458', 'aile_diger', 'Yabancılar ve Uluslararası Koruma Kanunu'],
  ['5411', 'aile_diger', 'Bankacılık Kanunu'],
  ['6362', 'aile_diger', 'Sermaye Piyasası Kanunu'],
  ['5684', 'aile_diger', 'Sigortacılık Kanunu'],
  ['4686', 'aile_diger', 'Milletlerarası Tahkim Kanunu'],
  ['2872', 'aile_diger', 'Çevre Kanunu'],
  ['5253', 'aile_diger', 'Dernekler Kanunu'],
  ['5737', 'aile_diger', 'Vakıflar Kanunu'],
  ['2709', 'yargi_anayasa', 'Türkiye Cumhuriyeti Anayasası'],
  ['2575', 'yargi_anayasa', 'Danıştay Kanunu'],
  ['2797', 'yargi_anayasa', 'Yargıtay Kanunu'],
  ['6216', 'yargi_anayasa', 'Anayasa Mahkemesinin Kuruluşu ve Yargılama Usulleri Hakkında Kanun'],
  ['6085', 'yargi_anayasa', 'Sayıştay Kanunu'],
  // 2247: 081 §6.2 adı "doğrulanacak" işaretler; ad kaynaktan okunur.
  ['2247', 'yargi_anayasa', null],
];

export const LAW_REGISTRY: readonly LawRegistryEntry[] = ROWS.map(([lawNo, group, title]) => {
  const alias = lawByNo(lawNo);
  return {
    lawNo,
    lawType: alias?.lawType === 'anayasa' ? 'constitution' : 'law',
    mcpLawType: 'kanun',
    group,
    title,
    abbr: alias?.display ?? null,
    aliases: alias?.aliases ?? [],
    snapshot: true,
    unverified: alias?.unverified ?? true,
  } satisfies LawRegistryEntry;
});

export function registryEntry(lawNo: string): LawRegistryEntry | null {
  return LAW_REGISTRY.find((e) => e.lawNo === lawNo) ?? null;
}

export type LawTypeMapping =
  | { ok: true; lawType: LawType }
  | { ok: false; reason: 'unsupported_law_type' };

/**
 * MCP türü → `corpus.laws.law_type` (034 §9.1; eşleme tek kaynak `MCP_TO_LAW_TYPE`). `tuzuk`, `teblig`,
 * `diger` MVP'de alınmaz. Anayasa `kanun` türüyle gelir; kayıt defterinden `constitution` olur.
 */
export function lawTypeToDb(mcpLawType: McpLawType, lawNo: string): LawTypeMapping {
  const mapped = MCP_TO_LAW_TYPE[mcpLawType];
  if (mapped === null) return { ok: false, reason: 'unsupported_law_type' };
  if (mapped === 'law' && registryEntry(lawNo)?.lawType === 'constitution') {
    return { ok: true, lawType: 'constitution' };
  }
  return { ok: true, lawType: mapped };
}
