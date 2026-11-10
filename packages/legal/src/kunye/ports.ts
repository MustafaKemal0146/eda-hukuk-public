// Künye / atıf portları (P14 K6). Korpus alımı (P14b `cited_articles`) ve getirim yönlendiricisi (P14c
// R2) madde atfı çıkarıcısını bu tür üzerinden alır; uygulama `articles-basic.ts`'tedir. P15 tam madde
// ayrıştırıcısı (aralık, fıkra çözümü) aynı türü karşılar.
import type { LawType } from '@eda/contracts/enums';

/** `corpus.decisions.cited_articles` öğesi (034 §3.2): `{"lawNo":"6098","articleNo":"49"}` + tür. */
export type CitedArticleRef = {
  lawNo: string;
  lawType: Extract<LawType, 'law' | 'constitution'>;
  /** 034 §9.3 anahtarı: `49`, `49/A`, `G5`, `E3`, `M18`. */
  articleNo: string;
};

export type ArticleCitationExtractor = (text: string) => readonly CitedArticleRef[];
