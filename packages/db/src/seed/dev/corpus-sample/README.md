# Örnek korpus (ÖRNEK VERİ)

Bu dizindeki her kayıt **sentetiktir**: taraflar, esas/karar numaraları, tarihler ve metinler uydurmadır;
gerçek bir karara veya kanun metnine karşılık gelmez. Yalnız `SEED_PROFILE=dev` ile yüklenir (034 §15);
üretimde bulunmaz. Gerçek karar fixture'ları yalnız birim testlerindedir ve buraya girmez.

| Dosya | İçerik |
|---|---|
| `decisions.ndjson` | 034 §5.4 satır şekli (`@eda/contracts/corpus-dataset` `CorpusDatasetRecord`) |
| `laws.ndjson` | Kanun başına bir satır; madde anahtarları 034 §9.3 biçiminde, metinler `[ÖRNEK METİN]` ile başlar |
| `VERSION` | Örnek veri, parçalayıcı, önek ve bölümleyici sürümleri |

Tabakalama: 8 MVP `court_type` için kısa ve uzun örnek, bir `text_unavailable` kabuk, bir başlıksız
(fallback) karar, bir mükerrer çift (aynı künye, farklı `document_id`). Yükleyici P14b'dedir.
