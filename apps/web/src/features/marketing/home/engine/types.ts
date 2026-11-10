// Sahne motorunun ihtiyaç duyduğu çalışma zamanı metinleri (tr.json `marketing` kataloğundan).
// Sunucu bileşeni `buildEngineText` ile üretip istemci bileşenine düz nesne olarak geçirir.
export type AnswerPart = { t: string } | { b: string } | { chip: string };
export type AnswerBlock = { h3: string } | { p: AnswerPart[] } | { ul: AnswerPart[][] };

export type EngineText = {
  question: string;
  answer: AnswerBlock[];
  chips: Record<string, { k: string; meta: string }>;
  /** Yanıt hazırlık çubuğu başlıkları ve sayaçları. */
  pipe: {
    title: string;
    meta0: string;
    parallel: string;
    parallelRest: string;
    meta: string[];
    done: string;
    rows: string[];
    times: string[];
  };
  sources: { none: string; found: string };
  studio: { saved: string; unsaved: string; words: string; fills: string };
  cal: { sumCap: string; sumCapSel: string; sumDay: string; sumDaySel: string };
};
