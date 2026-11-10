// Karar bölüm başlığı kalıpları (034 §6; roller 002 §11.5 DECISION_SECTION_ROLES). Veri olarak tutulur:
// kalıp değişikliği bölümleyici kodunu değiştirmez. Başlık metni Roma rakamı / numara öneki, `**` ve ":"
// sonrası atılmış, Türkçe büyük harfe çevrilmiş olarak tam eşleşir. Kalıplar hukuk uzmanı doğrulaması
// bekler (P11 raporu); 034 §6.3 genel kalıpları P14a'da eklendi.
import type { DecisionSectionRole } from '@eda/contracts/enums';

/** Kaynak başı başlık kalıpları: `default` Bedesten, `aym` Anayasa Mahkemesi, `uyusmazlik` UM. */
export type SectionProfile = 'default' | 'aym' | 'uyusmazlik';

/** `withValue`: "BAŞLIK : metin" biçimi de başlık sayılır (künye alanları "KARAR : …" sayılmaz). */
export type SectionMarker = { role: DecisionSectionRole; re: RegExp; withValue: boolean };

export const SECTION_MARKERS: readonly SectionMarker[] = [
  {
    role: 'karsi_oy',
    re: /^(KARŞI ?OY( YAZISI| GEREKÇESİ)?|MUHALEFET ŞERHİ|AZLIK OYU|FARKLI GEREKÇE( YAZISI)?)$/,
    withValue: false,
  },
  { role: 'tetkik_hakimi', re: /^(DANIŞTAY )?TETKİK H[ÂA]KİMİ/, withValue: true },
  { role: 'hukum', re: /^(HÜKÜM|SONUÇ)$/, withValue: true },
  {
    role: 'hukum',
    re: /^(KARAR|SONUÇ VE KARAR|KARAR SONUCU|HÜKÜM FIKRASI|NİHAİ KARAR)$/,
    withValue: false,
  },
  // Eski Yargıtay biçimi: özetten sonra aralıklı "K A R A R" satırı dairenin gerekçesini başlatır.
  { role: 'gerekce', re: /^K A R A R$/, withValue: false },
  {
    role: 'gerekce',
    re: /^(GEREKÇE|GEREKÇE VE SONUÇ|İNCELEME VE GEREKÇE|DEĞERLENDİRME VE GEREKÇE|DEĞERLENDİRME|DELİLLERİN DEĞERLENDİRİLMESİ VE GEREKÇE|HUKUKİ DEĞERLENDİRME|HUKUKİ NİTELENDİRME|İSTİNAF İNCELEMESİ|ESASIN İNCELENMESİ|ANAYASA MAHKEMESİNİN DEĞERLENDİRMESİ|İNCELEME)$/,
    withValue: false,
  },
  { role: 'gerekce', re: /^GEREĞİ (GÖRÜŞÜLÜP )?DÜŞÜNÜLDÜ$/, withValue: true },
  {
    role: 'taraf_iddiasi',
    re: /^(CEVAP|SAVUNMA|İDDİA|İDDİALAR|TEMYİZ EDENİN İDDİALARI|İSTİNAF SEBEPLERİ|TEMYİZ SEBEPLERİ|İSTİNAF BAŞVURU SEBEPLERİ|DAVALI CEVABI|DAVALI SAVUNMASI|DAVACI İDDİASI|TEMYİZ NEDENLERİ|TEMYİZ İSTEMİNİN ÖZETİ|İSTİNAF BAŞVURU NEDENLERİ|BAŞVURUCUNUN İDDİALARI|BAŞVURUCUNUN İDDİASI|HÜKÜMETİN GÖRÜŞÜ|BAKANLIK GÖRÜŞÜ|İPTAL İSTEMİNİN GEREKÇESİ|KARŞI CEVAP)$/,
    withValue: false,
  },
  { role: 'taraf_iddiasi', re: /^(SAVUNMANIN ÖZETİ|CEVABIN ÖZETİ)$/, withValue: true },
  {
    role: 'istem',
    re: /^(DAVA|İSTEM|TALEP|DAVANIN KONUSU|DAVA DİLEKÇESİ|İNCELENEN KARARIN|DAVA KONUSU|İSTEMİN KONUSU|BAŞVURU KONUSU|KANUN YARARINA BOZMA İSTEMİ|İTİRAZ KONUSU|İPTAL İSTEMİ)$/,
    withValue: false,
  },
  { role: 'istem', re: /^(İSTEMİN ÖZETİ|DAVANIN ÖZETİ)$/, withValue: true },
  {
    role: 'diger',
    re: /^(İLK DERECE MAHKEMESİ KARARI|BÖLGE ADLİYE MAHKEMESİ KARARI|İSTİNAF|TEMYİZ|İLGİLİ HUKUK|BAŞVURU SÜRECİ|EKLENTİ|EKLER|DİPNOTLAR?)$/,
    withValue: false,
  },
];

// AYM ve Uyuşmazlık Mahkemesi karar şablonu (2026-10-10 kayıtlı belgelerle;). Yerel
// mahkemenin / başvurucunun gerekçesi (`İtirazın Gerekçesi`) mahkemenin gerekçesi sayılmaz.
const HIGH_COURT_MARKERS: readonly SectionMarker[] = [
  { role: 'karsi_oy', re: /^FARKLI GEREKÇE( YAZISI)?$/, withValue: false },
  {
    role: 'istem',
    re: /^(İTİRAZIN KONUSU|BAŞVURUNUN KONUSU|BAŞVURUNUN ÖZETİ|DAVA KONUSU OLAY|İPTAL DAVASININ KONUSU)$/,
    withValue: true,
  },
  {
    role: 'taraf_iddiasi',
    re: /^(İTİRAZIN GEREKÇESİ|DAVANIN GEREKÇESİ|BAŞVURUNUN GEREKÇESİ|BAŞVURUCUNUN İDDİALARI)$/,
    withValue: false,
  },
  {
    role: 'gerekce',
    re: /^(ESASIN İNCELENMESİ|ANLAM VE KAPSAM|ANAYASA['’]YA AYKIRILIK SORUNU)$/,
    withValue: false,
  },
  {
    role: 'diger',
    re: /^(İLK İNCELEME|(İPTALİ İSTENEN|İTİRAZ KONUSU|DAVA KONUSU) KANUN (HÜKMÜ|HÜKÜMLERİ)|YASAL DAYANAKLAR?|İLGİLİ HUKUK|BAŞVURU SÜRECİ|OLAY VE OLGULAR|UYUŞMAZLIĞA İLİŞKİN BAŞVURU SÜRECİ|İDARİ YARGIDA|ADLİ YARGIDA)$/,
    withValue: false,
  },
];

/** Profil kalıpları genel kalıplardan önce denenir. Belge başındaki "KARAR" bu mahkemelerde künyedir. */
export const PROFILE_MARKERS: Readonly<Record<SectionProfile, readonly SectionMarker[]>> = {
  default: [],
  aym: [
    { role: 'kunye', re: /^(ANAYASA MAHKEMESİ KARARI|KARAR)$/, withValue: false },
    ...HIGH_COURT_MARKERS,
  ],
  uyusmazlik: [
    { role: 'kunye', re: /^K\s*A\s*R\s*A\s*R$/, withValue: false },
    ...HIGH_COURT_MARKERS,
  ],
};

/** "… dosya incelenerek gereği düşünüldü:" ile biten satır gerekçeyi başlatır (eski biçim, Danıştay). */
export const GEREKCE_TAIL = /GEREĞİ (GÖRÜŞÜLÜP )?DÜŞÜNÜLDÜ\s*:?$/;

/** Bu uzunluğu aşan başlık adayı başlık sayılmaz. */
export const HEADING_MAX = 80;
/** "… gereği düşünüldü:" satırı bu uzunluğa kadar gerekçe başlangıcı sayılır. */
export const GEREKCE_TAIL_LINE_MAX = 400;
/** 034 §6.6 heyet / imza bloğu kısa satırı: en çok bu kadar karakter ve sözcük. */
export const SIGNATURE_LINE_MAX_CHARS = 80;
export const SIGNATURE_LINE_MAX_WORDS = 6;
