// Konsolide mevzuat metni → madde listesi (021 §5.7.4). Ayrıştırma `@eda/legal/sections`
// `parseLawArticles` ile yapılır (034 §9.3: "yargi-mcp aynı fonksiyonu kullanır"); bu dosya yalnız
// turndown çıktısını ayrıştırıcı girdisine çevirir, MCP madde görünümünü ve aralık seçimini sağlar.
// Madde anahtarı 034 §9.3 biçimindedir: `49`, `4/A`, geçici `G5`, ek `E3`, mükerrer `M18`.
// Anahtar ayrıştırma (`parseArticleKey`) api / ai tüketicileriyle ortaktır: `@eda/legal/kunye`.
import { articleKeyText, parseArticleKey } from '@eda/legal/kunye';
import { type ParsedLawArticle, parseLawArticles } from '@eda/legal/sections';

/** MCP `get_legislation_live` madde görünümü (belge tamponunda tutulur; fıkra listesi tutulmaz). */
export type LawArticle = {
  /** 034 §9.3 anahtarı: `352`, `352/A`, `G1`, `E3`, `M18`. */
  articleNo: string;
  heading: string | null;
  /** İşaretçiden ("MADDE n –") sonraki madde metni. */
  markdown: string;
  repealed: boolean;
  /** Madde notlarındaki ("Değişik: …", "Ek: …") en geç tarih (ISO); yoksa null. */
  amendedAt: string | null;
};

/**
 * turndown çıktısındaki kalın vurgu ve ATX başlık işaretlerini atar: mevzuat belgesinde madde işaretçisi
 * `**Madde 1 –**`, kenar başlığı `**Amaç**` / `## Amaç` biçimindedir; ayrıştırıcı işaretçiyi satır başında
 * ve ardından boşlukla bekler.
 */
export function lawTextFromMarkdown(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, ''))
    .join('\n');
}

function toView(a: ParsedLawArticle): LawArticle {
  return {
    articleNo: a.key,
    heading: a.title,
    markdown: a.text,
    repealed: a.status === 'repealed',
    amendedAt: a.amendedAt,
  };
}

/** Getirilen maddelerin en geç değişiklik tarihi (`get_legislation_live.last_amended_at`); yoksa null. */
export function latestAmendedAt(articles: readonly LawArticle[]): string | null {
  let latest: string | null = null;
  for (const a of articles) {
    if (a.amendedAt !== null && (latest === null || a.amendedAt > latest)) latest = a.amendedAt;
  }
  return latest;
}

/** Konsolide metnin Markdown'ını maddelere böler. */
export function splitLawArticles(markdown: string): LawArticle[] {
  return parseLawArticles(lawTextFromMarkdown(markdown)).map(toView);
}

/** Girdiyi 034 §9.3 anahtarına çevirir; çözülemezse kırpılmış girdi (eşleşmez, `SOURCE_DOCUMENT_NOT_FOUND`). */
export function normalizeArticleNo(input: string): string {
  const k = parseArticleKey(input);
  return k ? articleKeyText(k) : input.trim();
}

/**
 * Tek madde veya aralık. Aralık yalnız aynı türde (önek) ve harfsiz uçlarla kurulur ("1"–"8", "G1"–"G5");
 * harfli maddeler (352/A) aralığa sayı parçasıyla girer. Aralık kurulamazsa yalnız başlangıç maddesi.
 * En çok `max` madde; fazlası `truncated`.
 */
export function selectArticles(
  all: LawArticle[],
  from: string,
  to: string | null,
  max: number,
): { articles: LawArticle[]; truncated: boolean } {
  const exact = (key: string) => ({
    articles: all.filter((a) => a.articleNo === key).slice(0, 1),
    truncated: false,
  });
  const f = parseArticleKey(from);
  if (!f) return exact(from.trim());
  const t = to === null ? null : parseArticleKey(to);
  if (t === null || articleKeyText(t) === articleKeyText(f)) return exact(articleKeyText(f));
  if (f.letter !== null || t.letter !== null || f.prefix !== t.prefix || t.number < f.number) {
    return exact(articleKeyText(f));
  }
  const picked = all.filter((a) => {
    const k = parseArticleKey(a.articleNo);
    return k !== null && k.prefix === f.prefix && k.number >= f.number && k.number <= t.number;
  });
  return { articles: picked.slice(0, max), truncated: picked.length > max };
}
