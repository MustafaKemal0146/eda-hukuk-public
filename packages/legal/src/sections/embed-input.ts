// Gömme girdisi ve bağlam öneki (034 §7.3–§7.4; `corpus.prefixVersion` = 1). Önek YALNIZ gömme
// girdisidir: gösterimde, LLM'e giden metinde ve `text_norm`'da kullanılmaz. Gömme girdisi tam olarak
// `tr_normalize(context_prefix + text)`; sorgu tarafına önek eklenmez. Biçim değişirse `prefixVersion`
// artar ve `corpus.reembed` gerekir. Saf; token sayacı enjekte edilir.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { DecisionSectionRole, SearchCourtType } from '@eda/contracts/enums';
import { articleHeadingText, parseArticleKey } from '../kunye/article-key.ts';
import { formatDateTr } from '../kunye/canonical.ts';
import { chamberInfo } from '../kunye/chambers.ts';
import { tr_normalize } from '../text/normalize.ts';

/** 023 §4.9 rol etiketleriyle aynı; `kunye` bölümü (künye ve heyet bloğu) için `KÜNYE`. */
export const ROLE_PREFIX_LABELS: Readonly<Record<DecisionSectionRole, string>> = {
  kunye: 'KÜNYE',
  istem: 'İSTEM',
  taraf_iddiasi: 'TARAF İDDİASI',
  gerekce: 'GEREKÇE',
  hukum: 'HÜKÜM',
  karsi_oy: 'KARŞI OY',
  tetkik_hakimi: 'TETKİK HÂKİMİ DÜŞÜNCESİ',
  diger: 'DİĞER',
};

/** Önek alanları `corpus.decisions` kolonlarıdır (034 §7.3 "Alanın kaynağı"). */
export type PrefixDecision = {
  courtType: SearchCourtType;
  /** `court_name`: "Yargıtay", "İstanbul Bölge Adliye Mahkemesi" … */
  courtName: string;
  chamberCode: string | null;
  chamberRaw: string | null;
  esasNo: string | null;
  kararNo: string | null;
  /** ISO gün. */
  decisionDate: string | null;
};

export type ArticleCitation = { lawNo: string; articleNo: string };

/**
 * Önek atıfları: en sık geçen en çok `max` madde; eşitlikte ilk görülme sırası (034 §7.3). Girdi
 * metindeki geçiş listesidir (yinelemeli; `articleOccurrences`).
 */
export function selectPrefixCitations(
  occurrences: readonly ArticleCitation[],
  max: number = CONFIG_DEFAULTS['corpus.prefixMaxCitedArticles'],
): ArticleCitation[] {
  const stats = new Map<string, { ref: ArticleCitation; count: number; first: number }>();
  occurrences.forEach((ref, i) => {
    const key = `${ref.lawNo}|${ref.articleNo}`;
    const s = stats.get(key);
    if (s) s.count += 1;
    else stats.set(key, { ref, count: 1, first: i });
  });
  return [...stats.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, max)
    .map((s) => s.ref);
}

/** "4857 s.K. m.17, m.32; 6098 s.K. m.49" — aynı kanun birleşik, kanun sırası ilk görülme sırası. */
export function formatPrefixCitations(refs: readonly ArticleCitation[]): string {
  const groups = new Map<string, string[]>();
  for (const r of refs) groups.set(r.lawNo, [...(groups.get(r.lawNo) ?? []), `m.${r.articleNo}`]);
  return [...groups.entries()].map(([law, arts]) => `${law} s.K. ${arts.join(', ')}`).join('; ');
}

function chamberShort(d: PrefixDecision): string | null {
  if (d.chamberCode) return chamberInfo(d.chamberCode)?.short ?? d.chamberCode;
  return d.chamberRaw;
}

const SEP = ' | ';
const END = ' — ';

/**
 * Önek adayları, uzundan kısaya (034 §7.3): tam; atıflar 3'e indirilmiş; atıfsız; tarihsiz. Künye
 * çekirdeği (`mahkeme daire | E. K. | [ROL]`) hiçbir adayda atılmaz. Boş alan ve ayırıcısı atlanır.
 */
export function contextPrefixCandidates(
  d: PrefixDecision,
  role: DecisionSectionRole,
  citations: readonly ArticleCitation[],
): string[] {
  const court = [d.courtName, chamberShort(d)].filter(Boolean).join(' ');
  const nums =
    d.courtType === 'aym_bireysel'
      ? d.esasNo
        ? `B. No: ${d.esasNo}`
        : ''
      : [d.esasNo ? `E. ${d.esasNo}` : '', d.kararNo ? `K. ${d.kararNo}` : '']
          .filter(Boolean)
          .join(' ');
  const date = d.decisionDate ? formatDateTr(d.decisionDate) : '';
  const roleTag = `[${ROLE_PREFIX_LABELS[role]}]`;
  const cites = (refs: readonly ArticleCitation[]) =>
    refs.length > 0 ? `atıflar: ${formatPrefixCitations(refs)}` : '';
  const build = (withDate: boolean, refs: readonly ArticleCitation[]) =>
    `${[court, nums, withDate ? date : '', roleTag, cites(refs)].filter(Boolean).join(SEP)}${END}`;
  const all = [
    build(true, citations),
    build(true, citations.slice(0, 3)),
    build(true, []),
    build(false, []),
  ];
  return all.filter((p, i) => all.indexOf(p) === i);
}

/**
 * `corpus.prefixMaxTokens` (60) içine sığan ilk aday ve ondan kısa olanlar (parçalayıcının 512
 * denetiminde kullanması için). Hiçbiri sığmazsa yalnız künye çekirdeği (son aday) döner.
 */
export async function buildContextPrefix(
  d: PrefixDecision,
  role: DecisionSectionRole,
  citations: readonly ArticleCitation[],
  countTokens: (texts: readonly string[]) => Promise<number[]>,
  maxTokens: number = CONFIG_DEFAULTS['corpus.prefixMaxTokens'],
): Promise<{ prefix: string; candidates: string[] }> {
  const all = contextPrefixCandidates(d, role, citations);
  const n = await countTokens(all);
  const fit = n.findIndex((x) => x <= maxTokens);
  const from = fit < 0 ? all.length - 1 : fit;
  const candidates = all.slice(from);
  return { prefix: candidates[0] ?? '', candidates };
}

export type LawPrefixInput = {
  lawNo: string;
  /** `corpus.laws.title`. */
  lawTitle: string;
  /** Kısa ad (`short_name` / kısaltma); yoksa parantez yazılmaz. */
  lawShort: string | null;
  /** 034 §9.3 anahtarı: `49`, `49/A`, `G5`, `E3`, `M18`. */
  articleKey: string;
  /** Parçanın kapsadığı fıkra numaraları; tek parça maddede `null`. */
  paragraphs: readonly number[] | null;
};

/**
 * 034 §7.4: `6098 sayılı Türk Borçlar Kanunu (TBK) m. 49/1 — `; çok fıkrada `m. 49/1-2`; geçici / ek /
 * mükerrer maddede `Geçici Madde 5` biçimi.
 */
export function buildLawContextPrefix(a: LawPrefixInput): string {
  const k = parseArticleKey(a.articleKey);
  const ref = k && k.prefix !== '' ? articleHeadingText(a.articleKey) : `m. ${a.articleKey}`;
  const ps = a.paragraphs ?? [];
  const first = ps[0];
  const last = ps.at(-1);
  const para =
    first === undefined
      ? ''
      : last !== undefined && last !== first
        ? `/${first}-${last}`
        : `/${first}`;
  const short = a.lawShort ? ` (${a.lawShort})` : '';
  return `${a.lawNo} sayılı ${a.lawTitle}${short} ${ref}${para}${END}`;
}

/** 034 §7.3: `embed_input = tr_normalize(context_prefix + text)`. */
export function buildEmbedInput(prefix: string, text: string): string {
  return tr_normalize(prefix + text);
}
