// Modelin gördüğü hata ve not metinleri (021 §4.14).
export const TOOL_MESSAGES = {
  budgetExhausted: 'Hata: Bu turdaki araç sınırına ulaşıldı. Elinizdeki kaynaklarla yanıtlayın.',
  notEnabled: 'Hata: Bu özellik henüz etkin değil.',
  documentToolsOff:
    'Hata: Belge araçları bu sürümde kapalı. Belgeyi sohbet yanıtında ```belge çitli tek bir blokla yaz; araç çağırma, özür dileme.',
  documentForbidden:
    'Hata: Kullanıcı belge veya taslak istemedi. Belge aracı çağırma; soruyu sohbette yanıtla.',
  documentNotRequested:
    'Hata: Kullanıcı belge hazırlanmasını açıkça istemedi. Belge başlatma; "Belge mi hazırlayayım, yoksa görüş mü istersiniz?" diye tek soru sor.',
  noCase:
    'Hata: Bu sohbete bağlı dava dosyası veya ek yok. Kullanıcıdan sohbeti bir dosyaya bağlamasını isteyin.',
  unknownRef: (ref: string) =>
    `Hata: ${ref} bu sohbette verilmiş bir kaynak etiketi değil. Önce search_decisions veya search_legislation ile arayın.`,
  wrongKindLegislation: (ref: string) =>
    `Hata: ${ref} bir mevzuat kaynağı; get_legislation_article kullanın.`,
  wrongKindDecision: (ref: string) => `Hata: ${ref} bir karar kaynağı; get_decision kullanın.`,
  sectionOut: (n: number) => `Hata: Bu kararda ${n} bölüm var; section 1–${n} arasında olmalı.`,
  unavailable: "Not: UYAP'a şu an ulaşılamıyor. Bu, kararın bulunmadığı anlamına gelmez.",
  busy: 'Not: Resmî kaynak şu an yoğun; daha sonra yeniden deneyin.',
  noDecision:
    'Sonuç yok: Bu ölçütlerle doğrulanmış karar bulunamadı. Künye veya esas/karar numarası uydurma; kullanıcıya bulunamadığını açıkça söyle.',
  noLegislation: 'Sonuç yok: Mevzuat kaynağında bu ölçütlerle madde bulunamadı.',
  articleNotFound: 'Sonuç yok: İstenen madde resmî mevzuat kaynağında bulunamadı.',
  outOfScopeDecisions:
    'Not: İstenen mahkeme türü kullanıcının seçtiği kaynak kapsamında değil; arama yapılmadı. Kapsamdaki kaynaklarla yanıtla veya kullanıcıya kapsamı genişletmesini öner.',
  outOfScopeLegislation:
    'Not: Mevzuat kullanıcının seçtiği kaynak kapsamında değil; mevzuat araması yapılmadı. Kullanıcıya kapsamı genişletmesini öner.',
} as const;
