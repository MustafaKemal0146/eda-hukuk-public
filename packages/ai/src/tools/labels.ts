// data-pipeline araç etiketleri (021 §4.16; 003 §4.2). Etiketler sunucudan gelir; istemci yalnız gösterir.
export const TOOL_LABELS: Record<string, string> = {
  search_decisions: 'Emsal kararlar aranıyor',
  get_decision: 'Karar metni inceleniyor',
  search_legislation: 'Mevzuat aranıyor',
  get_legislation_article: 'Madde metni getiriliyor',
  search_case_files: 'Dosya evrakında aranıyor',
  calculate_deadline: 'Süre hesaplanıyor',
  create_document: 'Belge planı hazırlanıyor',
  edit_document: 'Düzenleme önerileri hazırlanıyor',
  submit_outline: 'Plan oluşturuluyor',
};

/** Canlı portal adları (021 §4.13 araç gövdesi `Canlı: <portal>`; 021 §4.16 boru hattı etiketi). */
// Kullanıcıya görünen ad "UYAP" (iç kaynak anahtarı `bedesten` değişmez).
export const PORTAL_LABELS = {
  bedesten: 'UYAP',
  anayasa: 'AYM Kararlar Bilgi Bankası',
  uyusmazlik: 'Uyuşmazlık Mahkemesi',
  mevzuat: 'Mevzuat Bilgi Sistemi',
} as const;

export const LIVE_SEARCH_LABEL = 'Resmî kaynakta aranıyor (UYAP)';

/** Kapsamdaki canlı karar portallarına göre etiket; UYAP (bedesten) tek başınaysa sabit etiket. */
export function liveSearchLabel(portals: readonly (keyof typeof PORTAL_LABELS)[]): string {
  if (portals.length === 0 || (portals.length === 1 && portals[0] === 'bedesten')) {
    return LIVE_SEARCH_LABEL;
  }
  return `Resmî kaynakta aranıyor (${portals.map((p) => PORTAL_LABELS[p]).join(', ')})`;
}

export const STAGE_LABELS = {
  masking: 'Kişisel veriler maskeleniyor',
  synthesis: 'Yanıt yazılıyor',
  verification: 'Künyeler doğrulanıyor',
} as const;
