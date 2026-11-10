// Yasal metin sürümleri (053-12 §1, §3.3). Sürüm değeri kayıtta `user_preferences.terms_version` /
// `privacy_notice_version` olarak yazılan değerle aynıdır. Yürürlük tarihleri hukuk onayından sonra
// yayın öncesi doldurulur; bu yüzden burada tarih tutulmaz, sayfalar yer tutucu gösterir.
// Metinler TASLAK'tır: hukuk onayı bekleyen sürüm numarası `taslak-` önekini taşır.

export const LEGAL_VERSIONS = {
  termsVersion: 'taslak-1',
  privacyNoticeVersion: 'taslak-1',
  privacyPolicyVersion: 'taslak-1',
  cookiePolicyVersion: 'taslak-1',
} as const;

export type LegalVersionKey = keyof typeof LEGAL_VERSIONS;
