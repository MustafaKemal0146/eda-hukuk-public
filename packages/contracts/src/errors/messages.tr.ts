// Türkçe hata metinleri: tek metin kaynağı (044 §1.3, §6). Metin değişken içermez; sayı, süre,
// kimlik `meta`'dadır ve istemci biçimlendirir. `TOOL_*` metinleri modele döner (021 §4.14).
import type { ErrorCode, ReasonOf } from './catalog.ts';

export type ErrorMessageEntry<C extends ErrorCode> = {
  readonly message: string;
  readonly byReason?: Readonly<Partial<Record<ReasonOf<C>, string>>>;
};

export const ERROR_MESSAGES_TR = {
  // §6.1 AUTH_
  AUTH_UNAUTHENTICATED: { message: 'Bu işlem için giriş yapmanız gerekiyor.' },
  AUTH_SESSION_EXPIRED: { message: 'Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.' },
  AUTH_FORBIDDEN: {
    message: 'Bu işlem için yetkiniz yok.',
    byReason: {
      origin_mismatch: 'İstek güvenlik denetiminden geçemedi. Sayfayı yenileyip yeniden deneyin.',
      staff_on_app_surface: 'Platform personeli hesabı bu uygulamayı kullanamaz.',
      verification_rejected:
        'Mesleki doğrulama başvurunuz kabul edilmediği için bu özellik kullanılamıyor.',
      mfa_required_role:
        'Bu rolde en az bir ikinci adım doğrulama yönteminiz bulunmalıdır; son yöntemi kaldıramazsınız.',
      supervision_disabled: 'Stajyer sohbetlerini görüntüleme büro ayarlarında kapalı.',
      approval_required:
        'Stajyer dışa aktarımı için onay gerekiyor; bu özellik henüz kullanılamıyor.',
      policy_denied: 'Bu işlem büro veya platform politikası nedeniyle yapılamıyor.',
    },
  },
  AUTH_MFA_REQUIRED: {
    message: 'Bu işlem için iki adımlı doğrulamayı etkinleştirmeniz gerekiyor.',
    byReason: {
      mfa_required_org: 'Büronuz tüm üyeler için iki adımlı doğrulamayı zorunlu kılıyor.',
      mfa_required_client_data:
        'Müvekkil verisiyle çalışmadan önce iki adımlı doğrulamayı etkinleştirmeniz gerekiyor.',
    },
  },
  AUTH_STEP_UP_REQUIRED: { message: 'Güvenlik için kimliğinizi yeniden doğrulayın.' },
  AUTH_PENDING_VERIFICATION: {
    message:
      'Mesleki doğrulamanız tamamlanınca bu özelliği kullanabilirsiniz. Künye Kontrolü şimdiden kullanılabilir.',
  },
  AUTH_SUSPENDED: {
    message: 'Hesabınız askıya alınmış. Destekle iletişime geçin.',
    byReason: {
      org_suspended: 'Büronuz askıya alınmış. Büro yöneticisiyle veya destekle iletişime geçin.',
    },
  },
  AUTH_ERASURE_BLOCKED: {
    message: 'Hesap silme işlemi, önce tamamlanması gereken adımlar nedeniyle başlatılamadı.',
  },

  // §6.2 ORG_, SEAT_
  ORG_NO_ACTIVE: {
    message: 'Etkin bir büro seçili değil.',
    byReason: {
      active_org_changed:
        'Başka bir sekmede büro değiştirildi. Devam etmek için sayfayı yenileyin.',
    },
  },
  ORG_NOT_MEMBER: { message: 'Bu büronun etkin üyesi değilsiniz.' },
  ORG_ROLE_INSUFFICIENT: { message: 'Rolünüz bu işlem için yeterli değil.' },
  ORG_MEMBER_TRANSFER_REQUIRED: {
    message:
      'Bu üyenin devredilmesi gereken kayıtları var. Önce kayıtları başka bir üyeye devredin.',
  },
  ORG_CLOSING: {
    message:
      'Büro kapanış sürecinde; yeni kayıt oluşturulamaz. Mevcut verilerinizi dışa aktarabilirsiniz.',
  },
  ORG_FROZEN: { message: 'Büro dondurulmuş durumda; yalnızca büro sahibi erişebilir.' },
  ORG_CLOSURE_BLOCKED: { message: 'Büro kapanışı şu anda başlatılamıyor.' },
  SEAT_LIMIT_REACHED: {
    message: 'Paketinizdeki koltuk sınırına ulaşıldı. Koltuk ekleyin veya bir üyeyi çıkarın.',
    byReason: {
      seats_in_use: 'Mevcut üye sayısı yeni koltuk sayısından fazla. Önce üye sayısını azaltın.',
    },
  },

  // §6.3 CASE_
  CASE_NOT_FOUND: { message: 'Dosya bulunamadı veya erişiminiz yok.' },
  CASE_ACCESS_DENIED: { message: 'Dosya bulunamadı veya erişiminiz yok.' },
  CASE_DELETE_BLOCKED: {
    message: 'Bu kayıt silinemez.',
    byReason: {
      legal_hold: 'Yasal saklama nedeniyle bu kayıt silinemez.',
      client_in_use: 'Bu müvekkile bağlı dosya veya vekâletname olduğu için silinemez.',
      case_archived: 'Arşivlenmiş dosyaya bağlı kayıt silinemez.',
    },
  },

  // §6.4 FILE_
  FILE_NOT_FOUND: { message: 'Evrak bulunamadı veya erişiminiz yok.' },
  FILE_TOO_LARGE: { message: 'Dosya izin verilen boyutu aşıyor.' },
  FILE_TYPE_NOT_ALLOWED: {
    message: 'Bu dosya türü desteklenmiyor.',
    byReason: {
      type_mismatch: 'Dosya içeriği uzantısıyla uyuşmuyor.',
      preview_unsupported: 'Bu dosya türü için önizleme yok; indirebilirsiniz.',
      kunye_check_type: 'Künye Kontrolü için bu dosya türü kabul edilmiyor.',
    },
  },
  FILE_PAGE_LIMIT: {
    message:
      'Dosya sayfa sınırını aştığı için metni çıkarılmadı. Dosya saklandı; bölerek yeniden yükleyebilirsiniz.',
  },
  FILE_QUARANTINED: {
    message:
      'Dosya güvenlik taramasında sorun bulduğu için karantinaya alındı; içeriği kullanılamaz.',
  },
  FILE_UPLOAD_DISABLED: { message: 'Bu ortamda dosya yükleme kapalıdır.' },
  FILE_DUPLICATE: { message: 'Bu dosya aynı dava dosyasında zaten yüklü.' },
  FILE_NOT_READY: {
    message:
      'Dosya henüz hazır değil; güvenlik taraması veya işleme sürüyor. Biraz sonra tekrar deneyin.',
  },
  FILE_DELETE_BLOCKED: { message: 'Yasal saklama veya arşiv nedeniyle bu evrak silinemez.' },
  FILE_NO_TEXT_LAYER: {
    message: 'Bu belgede metin katmanı yok. Metin içeren PDF, UDF veya DOCX yükleyin.',
  },

  // §6.5 CHAT_, LLM_, AI_POLICY_
  CHAT_STREAM_IN_PROGRESS: {
    message: 'Önceki yanıt üretiliyor. Durdurup yeni mesaj gönderebilirsiniz.',
  },
  CHAT_TURN_TIMEOUT: { message: 'Yanıt süresi aşıldı. Kredi düşülmedi; lütfen tekrar deneyin.' },
  CHAT_PII_IN_PUBLIC_MODE: {
    message:
      'Genel araştırma modunda kişisel veri veya hassas konu içeren metin gönderilemez. Kişisel veriyi çıkarın.',
  },
  CHAT_CONVERSATION_NOT_FOUND: { message: 'Sohbet bulunamadı veya erişiminiz yok.' },
  CHAT_DELETE_BLOCKED: { message: 'Yasal saklama nedeniyle bu sohbet silinemez.' },
  LLM_PROVIDER_ERROR: {
    message: 'Yapay zekâ hizmetine şu an ulaşılamıyor. Kredi düşülmedi; lütfen tekrar deneyin.',
  },
  LLM_TIMEOUT: {
    message: 'Yapay zekâ yanıtı zamanında gelmedi. Kredi düşülmedi; lütfen tekrar deneyin.',
  },
  LLM_OUTPUT_INVALID: {
    message: 'Yapay zekâ geçerli bir yanıt üretemedi. Kredi düşülmedi; lütfen tekrar deneyin.',
  },
  LLM_TASK_CAP_REACHED: {
    message: 'Yanıt, bu işlem için belirlenen uzunluk sınırında kesildi.',
  },
  AI_POLICY_NO_PROVIDER: {
    message:
      'Bu büro için müvekkil verisi işleyebilecek yurt içi/AB sağlayıcısı henüz etkin değil.',
    byReason: {
      residency_blocks:
        'Büronuzun veri yerleşimi tercihi, uygun bir yapay zekâ sağlayıcısı kullanılmasına izin vermiyor.',
      case_authorization_missing:
        'Dava dosyası verisinin AB sağlayıcısında işlenmesi için büro sahibinin yazılı yetkilendirmesi gerekiyor.',
      sensitive_policy:
        'Bu dosya hassas olarak işaretli ve büro politikası yapay zekâ kullanımına izin vermiyor.',
      org_key_missing:
        'Büro/baroya tanımlanmış API anahtarı yok. Büro yöneticisinden anahtar tanımlamasını isteyin veya Ayarlar’dan kendi anahtarınızı ekleyin.',
      own_key_missing:
        'Kendi API anahtarınız tanımlı değil. Ayarlar’dan anahtarınızı ekleyin veya büro/baro anahtarını seçin.',
    },
  },
  AI_POLICY_CASE_AI_DISABLED: {
    message: 'Bu dosyada yapay zekâ kullanımı kapalı.',
    byReason: {
      consent_refused:
        'Müvekkil yapay zekâ kullanımını kabul etmediği için bu dosyada yapay zekâ kapalı.',
    },
  },
  AI_POLICY_PUBLIC_MODE_DISABLED: {
    message: 'Genel araştırma modu bu büroda kapalı. Büro sahibi açabilir.',
  },
  AI_POLICY_ROLE_DISABLED: {
    message: 'Rolünüz için yapay zekâ sohbeti kapalı. Büro yöneticisine başvurun.',
  },

  // §6.6 TOOL_ (modele döner; 021 §4.14)
  TOOL_INVALID_INPUT: {
    message: 'Hata: Araç girdisi geçersiz; alanları beklenen biçimde düzeltip yeniden çağırın.',
  },
  TOOL_NO_CASE_BOUND: {
    message:
      'Hata: Bu sohbete bağlı dava dosyası veya ek yok. Kullanıcıdan sohbeti bir dosyaya bağlamasını isteyin.',
  },
  TOOL_NO_DOCUMENT_OPEN: {
    message:
      'Hata: Açık belge yok. Yeni taslak için create_document çağırın veya kullanıcıdan belgeyi açmasını isteyin.',
  },
  TOOL_NOT_ENABLED: { message: 'Hata: Bu özellik henüz etkin değil.' },
  TOOL_BUDGET_EXHAUSTED: {
    message: 'Hata: Bu turdaki araç sınırına ulaşıldı. Elinizdeki kaynaklarla yanıtlayın.',
  },

  // §6.7 SOURCE_
  SOURCE_UNAVAILABLE: {
    message: 'Resmî kaynağa şu an ulaşılamıyor. Bu, kaydın bulunmadığı anlamına gelmez.',
  },
  SOURCE_BUSY: { message: 'Resmî kaynak şu an yoğun. Biraz sonra tekrar deneyin.' },
  SOURCE_RATE_LIMITED: {
    message: 'Resmî kaynakta arama hakkınız şu an dolu. Biraz sonra tekrar deneyin.',
  },
  SOURCE_NOT_IN_COVERAGE: {
    message: 'Bu kurum E.D.A. kapsamında değil. Resmî portalda arayabilirsiniz.',
  },
  SOURCE_PII_BLOCKED: {
    message:
      'Sorguda kişisel veri olabileceği için resmî kaynakta canlı arama yapılmadı. Kişisel veriyi çıkarın.',
  },
  SOURCE_DOCUMENT_NOT_FOUND: { message: 'Karar resmî kaynakta bulunamadı.' },

  // §6.8 DOC_, EXPORT_, CITATION_
  DOC_NOT_FOUND: { message: 'Belge bulunamadı veya erişiminiz yok.' },
  DOC_VERSION_CONFLICT: {
    message: 'Belge başka bir yerde değiştirilmiş. Değişiklikleri karşılaştırıp birleştirin.',
  },
  DOC_SUGGESTION_STALE: {
    message: 'Öneri, belgede sonradan değişen bir bloğa ait olduğu için eskidi.',
  },
  DOC_SCHEMA_INVALID: {
    message: 'Belge yapısı geçersiz olduğu için değişiklik kaydedilmedi.',
  },
  DOC_LOCKED: {
    message: 'Belge şu anda düzenlenemiyor.',
    byReason: {
      generation_in_progress: 'Belge şu anda üretiliyor; bitince tekrar deneyin.',
      archived: 'Arşivlenmiş belge düzenlenemez.',
      status_locked: 'Onaylanmış veya dışa aktarılmış belgede taslak yazımı yapılamaz.',
    },
  },
  DOC_DELETE_BLOCKED: { message: 'Yasal saklama veya arşiv nedeniyle bu belge silinemez.' },
  EXPORT_BLOCKED_UNVERIFIED_CITATION: {
    message:
      'Resmî kaynakta bulunamayan atıf var. Düzeltin, kaldırın veya sorumluluğu üstlenerek beyan edin.',
  },
  EXPORT_PENDING_VERIFICATION: {
    message: 'Bazı atıfların doğrulaması sürüyor. Tamamlanınca dışa aktarabilirsiniz.',
  },
  EXPORT_FAILED: { message: 'Dışa aktarım tamamlanamadı. Lütfen tekrar deneyin.' },
  EXPORT_EXPIRED: { message: 'Dışa aktarım dosyasının süresi doldu. Yeniden oluşturun.' },
  EXPORT_NOT_FOUND: { message: 'Dışa aktarım kaydı bulunamadı veya erişiminiz yok.' },
  CITATION_NOT_FOUND: { message: 'Atıf bulunamadı veya erişiminiz yok.' },
  CITATION_ATTESTATION_REQUIRED: {
    message: 'Kaynağa ulaşılamayan atıflar için avukat beyanı gerekiyor.',
  },
  CITATION_NOT_ATTESTABLE: {
    message: 'Bu atıf için beyan verilemez.',
    byReason: {
      pending: 'Atıfın doğrulaması sürüyor; beyan verilemez.',
      already_verified: 'Atıf zaten doğrulanmış; beyan gerekmez.',
      already_attested: 'Bu atıf için beyan zaten verilmiş.',
    },
  },
  CITATION_USER_SOURCE_MISMATCH: {
    message: 'Eklediğiniz belgenin künyesi atıfla eşleşmiyor.',
  },
  CITATION_USER_SOURCE_UNPARSEABLE: {
    message: 'Belgede künye başlığı bulunamadı; atfı beyanla geçebilirsiniz.',
  },

  // §6.9 CAL_, DEADLINE_
  CAL_INVALID_RANGE: { message: 'Bitiş zamanı başlangıçtan önce olamaz.' },
  CAL_EVENT_NOT_FOUND: { message: 'Takvim kaydı bulunamadı veya erişiminiz yok.' },
  DEADLINE_RULE_UNVERIFIED: {
    message: 'Bu işlem için doğrulanmış süre kuralı yok; süreyi elle kontrol edin.',
  },
  DEADLINE_HOLIDAY_DATA_MISSING: {
    message: 'Tatil verisi eksik olabilir; hesaplanan süreyi elle kontrol edin.',
  },
  DEADLINE_NOT_FOUND: { message: 'Süre kaydı bulunamadı veya erişiminiz yok.' },

  // §6.10 BILLING_, QUOTA_, PARTNER_, ADMIN_
  BILLING_PAYMENT_FAILED: {
    message: 'Ödeme alınamadı. Kart bilgilerinizi kontrol edin veya başka bir kart deneyin.',
  },
  BILLING_WEBHOOK_INVALID: { message: 'Geçersiz ödeme bildirimi.' },
  BILLING_COUPON_INVALID: {
    message: 'Kupon kodu geçersiz veya bu paket için kullanılamıyor.',
  },
  BILLING_SUBSCRIPTION_EXISTS: {
    message:
      'Büronuzun etkin bir ücretli aboneliği var. Paket değişikliği için abonelik ekranını kullanın.',
  },
  BILLING_SUBSCRIPTION_REQUIRED: {
    message:
      'Bu işlem için etkin bir abonelik gerekiyor. Mevcut evraklarınıza erişmeye devam edebilirsiniz.',
  },
  BILLING_PLAN_NOT_AVAILABLE: {
    message: 'Seçtiğiniz paket, dönem veya koltuk sayısı şu anda kullanılamıyor.',
  },
  BILLING_PROFILE_REQUIRED: { message: 'Ödeme için fatura bilgilerinizi tamamlayın.' },
  BILLING_PROVIDER_UNAVAILABLE: {
    message: 'Ödeme hizmetine şu anda ulaşılamıyor. Biraz sonra tekrar deneyin.',
  },
  BILLING_SEATS_IN_USE: {
    message: 'Koltuk sayısı, kullanımdaki üye sayısından az olamaz.',
  },
  BILLING_CHECKOUT_EXPIRED: { message: 'Ödeme oturumunun süresi doldu. Yeniden başlatın.' },
  QUOTA_INSUFFICIENT_CREDITS: {
    message: 'Krediniz yetersiz. Paketinizi yükseltin veya ek kredi alın.',
  },
  QUOTA_CONCURRENCY_LIMIT: {
    message: 'Aynı anda çok fazla yükleme var. Birkaçı bitince tekrar deneyin.',
  },
  QUOTA_PAGE_QUOTA_EXCEEDED: { message: 'Bu ayki OCR sayfa kotanız doldu.' },
  QUOTA_STORAGE_EXCEEDED: {
    message: 'Depolama kotanız doldu. Mevcut evraklarınıza erişmeye devam edebilirsiniz.',
  },
  QUOTA_DAILY_COST_CAP: {
    message:
      'Bu büro için günlük kullanım güvenlik sınırına ulaşıldı. Sınır yarın otomatik yenilenir; acil ihtiyaçta destekle iletişime geçin.',
    byReason: {
      platform_key_user_day:
        'Günlük ortak anahtar sınırına ulaşıldı. Ayarlar bölümünden kendi anahtarınızı ekleyin ya da yarın tekrar deneyin.',
      platform_key_user_month:
        'Aylık ortak anahtar sınırına ulaşıldı. Ayarlar bölümünden kendi anahtarınızı ekleyin ya da ay başında tekrar deneyin.',
      platform_key_org_day:
        'Büronun günlük ortak anahtar maliyet sınırına ulaşıldı. Ayarlar bölümünden büro ya da kendi anahtarınızı ekleyin ya da yarın tekrar deneyin.',
      platform_key_platform_day:
        'Ortak anahtarın günlük platform kullanım sınırına ulaşıldı. Ayarlar bölümünden kendi ya da büro anahtarınızı ekleyin ya da yarın tekrar deneyin.',
    },
  },
  PARTNER_NOT_ENABLED: { message: 'Sayfa bulunamadı.' },
  ADMIN_FORBIDDEN: { message: 'Bu yönetim işlemi için yetkiniz yok.' },

  // §6.11 KVKK_
  KVKK_MASKING_FAILED: {
    message:
      'Kişisel veriler maskelenemediği için istek yapay zekâ hizmetine gönderilmedi. Lütfen tekrar deneyin.',
  },
  KVKK_PREVIEW_FAILED: { message: 'Maskeleme önizlemesi şu anda oluşturulamadı.' },
  KVKK_REQUEST_INVALID_STATE: { message: 'Başvuru bu durumda bu işleme uygun değil.' },

  // §6.12 VALIDATION_, RATE_, INTERNAL_
  VALIDATION_FAILED: {
    message: 'Gönderilen bilgilerde düzeltilmesi gereken alanlar var.',
    byReason: {
      profession_required:
        'Bu rol için önce baro ve sicil bilgilerinizi girin, ardından daveti kabul edin.',
      api_key_rejected:
        'Anahtar sağlayıcı tarafından kabul edilmedi. Anahtarı kontrol edip yeniden deneyin.',
    },
  },
  VALIDATION_MALFORMED_BODY: { message: 'İstek okunamadı.' },
  VALIDATION_PAYLOAD_TOO_LARGE: { message: 'İstek boyutu izin verilen sınırı aşıyor.' },
  VALIDATION_UNSUPPORTED_MEDIA_TYPE: { message: 'Desteklenmeyen içerik türü.' },
  VALIDATION_ROUTE_NOT_FOUND: { message: 'Aradığınız sayfa veya işlem bulunamadı.' },
  VALIDATION_CURSOR_INVALID: { message: 'Liste konumu geçersiz; listeyi baştan yükleyin.' },
  VALIDATION_IDEMPOTENCY_KEY_REUSED: {
    message: 'Bu istek anahtarı farklı bir işlem için kullanılmış.',
  },
  VALIDATION_IDEMPOTENCY_IN_PROGRESS: { message: 'Aynı istek şu anda işleniyor.' },
  VALIDATION_CONFLICT: {
    message: 'İşlem mevcut durumla çakışıyor.',
    byReason: {
      already_member: 'Bu e-posta adresi zaten büro üyesi.',
      invitation_pending: 'Bu e-posta adresine bekleyen bir davet var.',
      registry_in_use: 'Bu sicil bilgisi başka bir hesapta kayıtlı. Destekle iletişime geçin.',
      reapply_cooldown:
        'Başvurunuz yakın zamanda reddedildi; bir süre sonra yeniden başvurabilirsiniz.',
      export_not_ready: 'Dışa aktarım henüz hazır değil.',
      already_exists: 'Bu kayıt zaten var.',
      state_changed: 'Kayıt başka bir işlemle değişti. Yenileyip tekrar deneyin.',
      // AS önerisi: 044 metnindeki gün sayısı `eval.modelGateFreshnessDays` değeridir; mesaja
      // gömülmez (044 §3), süre `meta`/arayüzden verilir.
      eval_gate_missing: 'Model değişikliği için yakın zamanda geçen bir değerlendirme koşusu yok.',
    },
  },
  VALIDATION_RESOURCE_NOT_FOUND: { message: 'Kayıt bulunamadı veya erişiminiz yok.' },
  RATE_LIMITED: { message: 'Çok sık deneme yaptınız. Biraz bekleyip tekrar deneyin.' },
  INTERNAL_ERROR: {
    message: 'Beklenmeyen bir hata oluştu. Sorun sürerse destek kodunu paylaşın.',
  },
  INTERNAL_DEPENDENCY_UNAVAILABLE: {
    message: 'Hizmet şu anda geçici olarak kullanılamıyor. Biraz sonra tekrar deneyin.',
  },
  INTERNAL_MAINTENANCE: {
    message: 'Sistem güncelleniyor veya bakımda. Birkaç dakika sonra tekrar deneyin.',
    byReason: {
      maintenance_mode: 'Bakım çalışması sürüyor; şimdilik yalnızca görüntüleme yapılabilir.',
    },
  },
} as const satisfies { readonly [C in ErrorCode]: ErrorMessageEntry<C> };
