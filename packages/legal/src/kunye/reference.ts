// Sohbet mesajındaki doğrudan atıflar: karar numarası ("2023/1234 E., 2024/567 K.", "Yargıtay 3. HD
// 2022/5000 E. 2023/100 K.") ve kanun maddesi ("TBK 125", "HMK m. 119", "6098 sayılı Kanun 27. madde").
// Saf: 025 §5 künye çıkarıcısını ve §8.1 madde desenlerini yeniden kullanır; ikinci desen kümesi
// yazılmaz. Başlıksız (mahkemesiz) numara yalnız E./K. etiketi varsa karar atfı sayılır: etiketsiz tek
// "2023/1234" dosya, dilekçe veya sözleşme numarası da olabilir. Sayılar test örneklerinde uydurmadır.
import { normalizeWithMap } from '../text/normalize.ts';
import { canonicalizeCaseNo } from './canonical.ts';
import { extractAll, extractArticleCitations } from './extract.ts';
import { lawDisplay } from './law-aliases.ts';
import type { CourtClass } from './types.ts';

export type DecisionReference = {
  /** Başlıktan çözülen mahkeme sınıfı; başlıksız numarada null. */
  courtClass: CourtClass | null;
  /** 025 daire kodu (H3, C4, D10, HGK …); yalnız Yargıtay/Danıştay başlığında anlamlıdır. */
  chamberCode: string | null;
  /** Kanonik `YYYY/N`. */
  esasNo: string | null;
  kararNo: string | null;
  raw: string;
};

export type ArticleReference = {
  lawNo: string;
  /** Görüntü kısaltması (TBK, HMK …); sözlükte yoksa "6098 s. K.". */
  lawShort: string;
  /** 034 §9.3 anahtarı: `125`, `344/A`, `G1`, `E3`, `M18`. */
  articleNo: string;
  raw: string;
};

/** Uzak gelecek: `extractAll` "bugün"ü yalnız olanaksızlık işareti için kullanır; burada gerekmez. */
const FAR_TODAY = '2099-12-31';
const NUM = /(?<![\d/])((?:19|20)\d{2})\s*\/\s*(\d{1,7})(?![\d/])/gu;
// Sonek etiketi ("2024/567 K.") ardında "no" varsa bir sonraki numaranın öneki sayılır ("… Karar No: 2022/9").
const E_SUF = /^\s*(?:e|esas)(?:\s+sayılı)?(?![\p{L}])\.?(?!\s*no(?![\p{L}]))/u;
const K_SUF = /^\s*(?:k|karar)(?:\s+sayılı)?(?![\p{L}])\.?(?!\s*no(?![\p{L}]))/u;
const E_PRE = /(?<![\p{L}])(?:e|esas(?:\s+no)?)\s*[:.-]?\s*$/u;
const K_PRE = /(?<![\p{L}])(?:k|karar(?:\s+no)?)\s*[:.-]?\s*$/u;
const CHAMBER_COURTS: ReadonlySet<CourtClass> = new Set(['yargitay', 'danistay']);

/** Başlıksız "2023/1234 E., 2024/567 K." biçimi: en az bir etiket şart, etiketsiz ikinci numara karar. */
function headerless(text: string): DecisionReference | null {
  const { norm, map } = normalizeWithMap(text);
  const nums: { canon: string; role: 'esas' | 'karar' | null; start: number; end: number }[] = [];
  // Önek penceresi bir önceki numaranın (soneki dahil) bittiği yerden başlar: "2023/1234 E. 2024/567"
  // içindeki "E." ikinci numaranın öneki değildir.
  let prevEnd = 0;
  for (const m of norm.matchAll(NUM)) {
    const end = m.index + m[0].length;
    const after = norm.slice(end, end + 16);
    const before = norm.slice(Math.max(prevEnd, m.index - 16), m.index);
    const tail = E_SUF.exec(after) ?? K_SUF.exec(after);
    const role = E_SUF.test(after)
      ? 'esas'
      : K_SUF.test(after)
        ? 'karar'
        : E_PRE.test(before)
          ? 'esas'
          : K_PRE.test(before)
            ? 'karar'
            : null;
    const canon = canonicalizeCaseNo(Number(m[1]), Number(m[2])).canon;
    prevEnd = end + (tail?.[0].length ?? 0);
    nums.push({ canon, role, start: m.index, end: prevEnd });
  }
  if (nums.length === 0 || nums.every((n) => n.role === null)) return null;
  const labelledEsas = nums.find((n) => n.role === 'esas') ?? null;
  const labelledKarar = nums.find((n) => n.role === 'karar') ?? null;
  const free = nums.filter((n) => n.role === null);
  const esas =
    labelledEsas ??
    (labelledKarar ? (free.find((n) => n.end < labelledKarar.start) ?? null) : null);
  const karar =
    labelledKarar ?? (labelledEsas ? (free.find((n) => n.start > labelledEsas.end) ?? null) : null);
  const used = [esas, karar].filter((n) => n !== null);
  const start = Math.min(...used.map((n) => n.start));
  const end = Math.max(...used.map((n) => n.end));
  const origStart = map[start] ?? 0;
  const origEnd = (map[Math.max(start, end - 1)] ?? origStart) + 1;
  return {
    courtClass: null,
    chamberCode: null,
    esasNo: esas?.canon ?? null,
    kararNo: karar?.canon ?? null,
    raw: text.slice(origStart, origEnd),
  };
}

/**
 * Metindeki karar atıfları (geçiş sırası). Başlıklı atıflar (mahkeme/daire + numara) 025 çıkarıcısından;
 * hiç yoksa başlıksız etiketli numara çifti. Yalnız başvuru numaralı (AYM bireysel) atıf dahil edilmez:
 * esas/karar alanıyla sorgulanamaz.
 */
export function parseDecisionReferences(text: string): DecisionReference[] {
  const out: DecisionReference[] = [];
  for (const c of extractAll(text, { today: FAR_TODAY }).citations) {
    const k = c.kunye;
    if (c.kind !== 'decision_free' || !k || (k.esas === null && k.karar === null)) continue;
    out.push({
      courtClass: k.courtClass,
      chamberCode: CHAMBER_COURTS.has(k.courtClass) ? k.chamberCode : null,
      esasNo: k.esas?.canon ?? null,
      kararNo: k.karar?.canon ?? null,
      raw: c.raw,
    });
  }
  if (out.length > 0) return out;
  const h = headerless(text);
  return h ? [h] : [];
}

/** Metindeki madde atıfları (geçiş sırası, tekil): kısaltma sözlüğü `law-aliases.ts`; bilinmeyen kısaltma atılır. */
export function parseArticleReferences(text: string): ArticleReference[] {
  const seen = new Set<string>();
  const out: ArticleReference[] = [];
  const cites = extractArticleCitations(text).sort((a, b) => a.span.start - b.span.start);
  for (const c of cites) {
    const lawNo = c.article?.lawNo;
    if (!c.article || !lawNo) continue;
    for (const a of c.article.articles) {
      const id = `${lawNo}|${a.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ lawNo, lawShort: lawDisplay(lawNo), articleNo: a.key, raw: c.raw });
    }
  }
  return out;
}
