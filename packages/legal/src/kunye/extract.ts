// Künye ve madde atfı çıkarıcı (025 §5, §8.1). Saf: "bugün" parametredir. Desenler yalnız `tr_normalize`
// çıktısı üzerinde çalışır; bulunan aralıklar ofset haritasıyla özgün metne çevrilir (`raw` özgün dilim).
// Sayılar ve adlar test örneklerinde uydurmadır (Y-83).
import { normalizeWithMap } from '../text/normalize.ts';
import { type CanonNo, canonicalizeCaseNo, isoDate, TR_MONTHS } from './canonical.ts';
import { isKnownChamber } from './chambers.ts';
import { abbrPatternSource, lawByAbbr } from './law-aliases.ts';
import type {
  ArticleRef,
  CourtClass,
  ExcludedCitation,
  Impossible,
  ParsedArticle,
  ParsedCitation,
  ParsedKunye,
} from './types.ts';

const YEAR = '(?:19|20)\\d{2}';
const NOT_L = '(?<![\\p{L}])';
const AFTER_WINDOW = 80;
const GAP_MAX = 60;
const DATE_AFTER = 40;
const CUE_WINDOW = 60;

type Header = {
  start: number;
  end: number;
  courtClass: CourtClass;
  chamberCode: string | null;
  courtLabel: string | null;
  lowConfidence: boolean;
  /** Genel kurul başlığı: N2 (daire-sıra) numaraları yalnız bunlarla geçerlidir. */
  plenary: boolean;
};

type HeaderCtx = {
  norm: string;
  /** Normalize ofset aralığının özgün metin dilimi (görünen ad için). */
  orig: (start: number, end: number) => string;
};

type HeaderRule = {
  re: RegExp;
  build: (m: RegExpExecArray, ctx: HeaderCtx) => Omit<Header, 'start' | 'end'> | null;
};

const base = (
  courtClass: CourtClass,
  chamberCode: string | null,
  extra: Partial<Omit<Header, 'start' | 'end'>> = {},
): Omit<Header, 'start' | 'end'> => ({
  courtClass,
  chamberCode,
  courtLabel: null,
  lowConfidence: false,
  plenary: false,
  ...extra,
});

const YARGITAY = "(?:yargıtay(?:'?(?:ın|nın))?|yarg\\.|y\\.)";
const DANISTAY = "(?:danıştay(?:'?(?:ın|nın))?|dn\\.?)";

/** 025 §5.3 tablosu; öncelik sırası yukarıdan aşağıdır. */
const HEADER_RULES: readonly HeaderRule[] = [
  {
    re: new RegExp(
      `${NOT_L}(?:anayasa\\s+mahkemesi|aym)(?:'?nin)?(?=[\\s,.(]*(?:\\([^)]{0,30}\\)[\\s,]*)?(?:b\\.?\\s*no|başvuru\\s+(?:no|numarası|numaralı)))`,
      'gu',
    ),
    build: () => base('aym_bireysel', null),
  },
  {
    re: new RegExp(
      `${NOT_L}(?:anayasa\\s+mahkemesi|aym)(?:'?nin)?(?:\\s+genel\\s+kurulu?)?(?![\\p{L}])`,
      'gu',
    ),
    build: () => base('aym_norm', null),
  },
  {
    re: new RegExp(
      `${NOT_L}(?:yargıtay\\s+)?(?:içtihad[ıi]\\s+birleştirme\\s+(?:büyük\\s+genel\\s+kurulu|kurulu|kararı)|yibbgk|ibbgk|ibk)(?![\\p{L}])`,
      'gu',
    ),
    build: () => base('yargitay', 'IBK', { plenary: true }),
  },
  {
    re: new RegExp(`${NOT_L}(?:yargıtay\\s+)?(?:hukuk\\s+genel\\s+kurulu|hgk)(?![\\p{L}])`, 'gu'),
    build: () => base('yargitay', 'HGK', { plenary: true }),
  },
  {
    re: new RegExp(`${NOT_L}(?:yargıtay\\s+)?(?:ceza\\s+genel\\s+kurulu|cgk)(?![\\p{L}])`, 'gu'),
    build: () => base('yargitay', 'CGK', { plenary: true }),
  },
  {
    re: new RegExp(
      `${NOT_L}${YARGITAY}\\s*(\\d{1,2})\\s*\\.?\\s*(?:ceza\\s+dairesi|c\\.?\\s*d\\.?)(?![\\p{L}])`,
      'gu',
    ),
    build: (m) => base('yargitay', `C${Number(m[1])}`),
  },
  {
    re: new RegExp(
      `${NOT_L}${YARGITAY}\\s*(\\d{1,2})\\s*\\.?\\s*(?:hukuk\\s+dairesi|h\\.?\\s*d\\.?)(?![\\p{L}])`,
      'gu',
    ),
    build: (m) => base('yargitay', `H${Number(m[1])}`),
  },
  {
    re: new RegExp(
      `${NOT_L}(?:danıştay\\s+)?(?:idare\\s+dava\\s+daireleri\\s+kurulu|iddk)(?![\\p{L}])`,
      'gu',
    ),
    build: () => base('danistay', 'IDDK', { plenary: true }),
  },
  {
    re: new RegExp(
      `${NOT_L}(?:danıştay\\s+)?(?:vergi\\s+dava\\s+daireleri\\s+kurulu|vddk)(?![\\p{L}])`,
      'gu',
    ),
    build: () => base('danistay', 'VDDK', { plenary: true }),
  },
  {
    re: new RegExp(
      `${NOT_L}danıştay\\s+(?:(içtihatları\\s+birleştirme\\s+(?:büyük\\s+)?kurulu)|(?:dava\\s+daireleri\\s+)?(?:büyük\\s+)?genel\\s+kurulu?)(?![\\p{L}])`,
      'gu',
    ),
    build: (m) => base('danistay', m[1] ? 'IBK' : 'DBGK', { plenary: true }),
  },
  {
    re: new RegExp(
      `${NOT_L}${DANISTAY}\\s*(\\d{1,2})\\s*\\.?\\s*(?:daire(?:si)?|d\\.?)(?![\\p{L}])`,
      'gu',
    ),
    build: (m) => base('danistay', `D${Number(m[1])}`),
  },
  {
    re: /(?<city>\p{L}[\p{L}]{1,24})\s+(?:bölge\s+adliye\s+mahkemesi|bam)\s+(\d{1,2})\s*\.?\s*(?:(hukuk|ceza)\s+dairesi|(hd|cd))(?![\p{L}])/gu,
    build: (m, ctx) => {
      const ceza = (m[3] ?? m[4] ?? '').startsWith('c');
      const city = ctx.orig(m.index, m.index + (m.groups?.city ?? '').length);
      return base(ceza ? 'istinaf_ceza' : 'istinaf_hukuk', `${ceza ? 'C' : 'H'}${Number(m[2])}`, {
        courtLabel: `${city} Bölge Adliye Mahkemesi`,
        lowConfidence: true,
      });
    },
  },
  {
    re: new RegExp(`${NOT_L}(?:bölge\\s+idare\\s+mahkemesi|bim)(?![\\p{L}])`, 'gu'),
    build: () => base('bim', null, { lowConfidence: true }),
  },
  {
    re: new RegExp(
      `${NOT_L}uyuşmazlık\\s+(?:mahkemesi|mah\\.)(?:'?nin)?(?:\\s+(hukuk|ceza|genel)(?:\\s+(?:bölümü|kurulu))?)?(?![\\p{L}])`,
      'gu',
    ),
    build: (m) =>
      base(
        'uyusmazlik',
        m[1] === 'hukuk' ? 'HUKUK' : m[1] === 'ceza' ? 'CEZA' : m[1] ? 'GENEL' : null,
      ),
  },
  {
    re: new RegExp(
      `${NOT_L}sayıştay\\s+(?:\\d+\\s*\\.\\s*daire|genel\\s+kurul|temyiz\\s+kurulu)`,
      'gu',
    ),
    build: () => base('sayistay', null),
  },
  {
    re: /(?:(\p{L}{2,24})\s+)?(\d{1,3})\s*\.\s*((?:asliye|sulh|ağır\s+ceza|iş|aile|tüketici|icra|idare|vergi|kadastro|fikri\s+ve\s+sınai\s+haklar|çocuk)[\p{L}\s]{0,30}?)(?:mahkemesi|mah\.)/gu,
    build: (m, ctx) => {
      const kind = m[3] ?? '';
      const civil =
        /^(?:asliye\s+(?:hukuk|ticaret)|iş|aile|tüketici|sulh\s+hukuk|icra\s+hukuk|fikri|kadastro)/u.test(
          kind,
        );
      return base(civil ? 'yerel' : 'yerel_diger', null, {
        courtLabel: ctx.orig(m.index, m.index + m[0].length),
        lowConfidence: true,
      });
    },
  },
  {
    re: /(?<![\p{L}\d])(\d{1,2})\s*\.\s*(?:(hukuk\s+dairesi|hd)|(ceza\s+dairesi|cd))(?![\p{L}])/gu,
    // Başlıksız daire: önceki 40 karakterde BAM/ilk derece ipucu varsa Yargıtay sayılmaz.
    build: (m, ctx) =>
      /bölge|bam|istinaf|asliye|mahkemesi/u.test(ctx.norm.slice(Math.max(0, m.index - 40), m.index))
        ? null
        : base('yargitay', `${m[2] ? 'H' : 'C'}${Number(m[1])}`),
  },
];

const N2 = new RegExp(
  `(?<![\\d/])(${YEAR})\\/\\(?(\\d{1,2})\\)?\\s*-\\s*(\\d{1,6})(?![\\d/])`,
  'gu',
);
const N1 = new RegExp(`(?<![\\d/])(${YEAR})\\/(\\d{1,6})(?![\\d/])`, 'gu');
const DATE_N = new RegExp(`(?<!\\d)(\\d{1,2})[./-](\\d{1,2})[./-](${YEAR})(?!\\d)`, 'gu');
const DATE_T = new RegExp(
  `(?<!\\d)(\\d{1,2})\\s+(${TR_MONTHS.join('|')})\\s+(${YEAR})(?!\\d)`,
  'gu',
);
const E_SUF = /^\s*(?:e|esas)(?:\s+(?:no|sayılı))?(?![\p{L}])\.?/u;
const K_SUF = /^\s*(?:k|karar)(?:\s+(?:no|sayılı))?(?![\p{L}])\.?/u;
const E_PRE = /(?<![\p{L}])(?:e|esas(?:\s+no)?)\s*[:.-]?\s*$/u;
const K_PRE = /(?<![\p{L}])(?:k|karar(?:\s+no)?)\s*[:.-]?\s*$/u;
const B_PRE = /(?<![\p{L}])(?:b\.?\s*no|başvuru\s+(?:no|numarası|numaralı))\s*[:.-]?\s*$/u;
const OWN_FILE_CUE =
  /(?:mahkememizin|mahkemenizin|dosyamız|dosyanın|sayılı dosya|derdest|işbu dava|ilgili dosya|dosya no)/u;
const MASK = /\[[a-zçğıöşü]+_[a-z2-7]{4,6}\]/gu;
const URL = /https?:\/\/\S+/gu;

type Num = {
  start: number;
  end: number;
  no: CanonNo;
  role: 'esas' | 'karar' | 'basvuru' | null;
  used: boolean;
  /** Sonek etiketi ("2024/1234 E.") dahil bitiş; `raw` aralığı buraya uzar. */
  tailEnd: number;
};

type DateHit = { start: number; end: number; iso: string };

function scanNumbers(norm: string): Num[] {
  const out: Num[] = [];
  const taken = new Set<number>();
  for (const m of norm.matchAll(N2)) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      no: canonicalizeCaseNo(Number(m[1]), Number(m[3]), Number(m[2]), m[0]),
      role: null,
      used: false,
      tailEnd: m.index + m[0].length,
    });
    for (let i = m.index; i < m.index + m[0].length; i++) taken.add(i);
  }
  for (const m of norm.matchAll(N1)) {
    if (taken.has(m.index)) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      no: canonicalizeCaseNo(Number(m[1]), Number(m[2]), null, m[0]),
      role: null,
      used: false,
      tailEnd: m.index + m[0].length,
    });
  }
  out.sort((a, b) => a.start - b.start);
  for (const n of out) {
    const after = norm.slice(n.end, n.end + 16);
    const before = norm.slice(Math.max(0, n.start - 24), n.start);
    const eSuf = E_SUF.exec(after);
    const kSuf = eSuf ? null : K_SUF.exec(after);
    n.tailEnd = n.end + (eSuf?.[0].length ?? kSuf?.[0].length ?? 0);
    if (eSuf) n.role = 'esas';
    else if (kSuf) n.role = 'karar';
    else if (B_PRE.test(before)) n.role = 'basvuru';
    else if (E_PRE.test(before)) n.role = 'esas';
    else if (K_PRE.test(before)) n.role = 'karar';
  }
  return out;
}

function scanDates(norm: string): DateHit[] {
  const out: DateHit[] = [];
  for (const m of norm.matchAll(DATE_N)) {
    const iso = isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
    if (iso) out.push({ start: m.index, end: m.index + m[0].length, iso });
  }
  for (const m of norm.matchAll(DATE_T)) {
    const month = TR_MONTHS.indexOf(m[2] as (typeof TR_MONTHS)[number]) + 1;
    const iso = isoDate(Number(m[3]), month, Number(m[1]));
    if (iso) out.push({ start: m.index, end: m.index + m[0].length, iso });
  }
  return out.sort((a, b) => a.start - b.start);
}

function scanHeaders(norm: string, ctx: HeaderCtx): Header[] {
  const all: (Header & { rank: number })[] = [];
  HEADER_RULES.forEach((rule, rank) => {
    rule.re.lastIndex = 0;
    for (const m of norm.matchAll(rule.re)) {
      const built = rule.build(m, ctx);
      if (built) all.push({ ...built, start: m.index, end: m.index + m[0].length, rank });
    }
  });
  // Öncelik sırası, sonra en uzun; çakışan alt sıradaki eşleşmeler düşer.
  all.sort((a, b) => a.rank - b.rank || b.end - b.start - (a.end - a.start));
  const chosen: Header[] = [];
  for (const h of all) {
    if (chosen.some((c) => h.start < c.end && c.start < h.end)) continue;
    chosen.push(h);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

export type ExtractOptions = {
  /** Europe/Istanbul günü (ISO); `future_date` için. */
  today: string;
  /** Künye Kontrolü / editör: belgenin başındaki kendi dosya numarası bölgesi (025 §5.4 `header_zone`). */
  headerZoneChars?: number;
};

export type ExtractResult = { citations: ParsedCitation[]; excluded: ExcludedCitation[] };

function impossibleOf(k: ParsedKunye, today: string): Impossible[] {
  const out: Impossible[] = [];
  if (k.date !== null && k.date > today) out.push('future_date');
  if (k.esas && k.karar && k.karar.year < k.esas.year) out.push('karar_before_esas');
  if (k.chamberCode && /^[HCD]\d+$/.test(k.chamberCode) && !isKnownChamber(k.chamberCode)) {
    out.push('unknown_chamber');
  }
  if ([k.esas, k.karar, k.basvuruNo].some((n) => n !== null && n.seq === 0)) out.push('zero_seq');
  return out;
}

/** Maskeleme işaretleri, URL'ler aynı uzunlukta yer tutucuyla kapatılır (025 §5.1-3). */
function blank(norm: string): { text: string; ownFile: { start: number; end: number }[] } {
  const ownFile: { start: number; end: number }[] = [];
  let text = norm.replace(MASK, (m, offset: number) => {
    if (m.startsWith('[dosya_')) ownFile.push({ start: offset, end: offset + m.length });
    return '￼'.repeat(m.length);
  });
  text = text.replace(URL, (m) => '￼'.repeat(m.length));
  return { text, ownFile };
}

/**
 * Yalnız madde atıfları (025 §8.1 A1–A7): `extractAll` ile aynı normalizasyon, maskeleme ve desenler;
 * künye taraması yapılmaz. Korpus `cited_articles` ve getirim yönlendiricisi (R2) bunu kullanır
 * (`articles-basic.ts`; P14 K6).
 */
export function extractArticleCitations(text: string): ParsedCitation[] {
  const { norm: rawNorm, map } = normalizeWithMap(text);
  const { text: norm } = blank(rawNorm);
  return extractArticles(norm, text, (s, e) => {
    const start = map[s] ?? 0;
    const end = (map[Math.max(s, e - 1)] ?? start) + 1;
    return { start, end };
  });
}

export function extractAll(text: string, opts: ExtractOptions): ExtractResult {
  const { norm: rawNorm, map } = normalizeWithMap(text);
  const { text: norm, ownFile } = blank(rawNorm);
  const toSpan = (s: number, e: number) => {
    const start = map[s] ?? 0;
    const end = (map[Math.max(s, e - 1)] ?? start) + 1;
    return { start, end };
  };
  const nums = scanNumbers(norm);
  const dates = scanDates(norm);
  const headers = scanHeaders(norm, {
    norm,
    orig: (s, e) => {
      const span = toSpan(s, e);
      return text.slice(span.start, span.end);
    },
  });
  const citations: ParsedCitation[] = [];
  const excluded: ExcludedCitation[] = [];

  headers.forEach((h, i) => {
    const limit = Math.min(h.end + AFTER_WINDOW, headers[i + 1]?.start ?? norm.length);
    const cluster: Num[] = [];
    let cursor = h.end;
    for (const n of nums) {
      if (n.used || n.start < h.end || n.start > limit) continue;
      if (n.start - cursor > GAP_MAX) break;
      if (n.no.group !== null && !h.plenary) continue;
      cluster.push(n);
      cursor = n.end;
    }
    let esas = cluster.find((n) => n.role === 'esas') ?? null;
    let karar = cluster.find((n) => n.role === 'karar') ?? null;
    let basvuru =
      h.courtClass === 'aym_bireysel' ? (cluster.find((n) => n.role === 'basvuru') ?? null) : null;
    let inferred = false;
    const unclassified = cluster.filter((n) => n.role === null);
    if (!esas && !karar && !basvuru && unclassified.length === 2) {
      const [a, b] = unclassified as [Num, Num];
      const between = norm.slice(a.end, b.start);
      if (/^\s*(?:,|-|ve)\s*$/u.test(between) && b.no.year >= a.no.year) {
        esas = a;
        karar = b;
        inferred = true;
      }
    }
    if (h.courtClass === 'aym_bireysel' && !basvuru && unclassified.length >= 1) {
      basvuru = unclassified[0] ?? null;
    }
    const used = [esas, karar, basvuru].filter((n): n is Num => n !== null);
    if (used.length === 0) return;
    for (const n of used) n.used = true;
    const lastEnd = Math.max(...used.map((n) => n.tailEnd));
    const date =
      dates.find((d) => d.start >= h.end && d.start <= lastEnd + DATE_AFTER) ??
      dates.find(
        (d) =>
          d.end <= h.start &&
          /^\s*tarih(?:li|inde)?\s*(?:ve\s*)?$/u.test(norm.slice(d.end, h.start)),
      ) ??
      null;
    const start = Math.min(h.start, date?.start ?? h.start);
    const end = Math.max(lastEnd, date && date.start > lastEnd ? date.end : lastEnd);
    const span = toSpan(start, end);

    // İpucu penceresi kümenin önündeki 60 karakterdir; virgül/noktalı virgül başka bir yan cümleyi
    // ayırdığı için pencere orada kesilir ("…sayılı dosyası, Yargıtay 9. HD …" künyedir).
    const windowText = norm.slice(Math.max(0, start - CUE_WINDOW), start);
    const cue = windowText.slice(
      Math.max(windowText.lastIndexOf(','), windowText.lastIndexOf(';')) + 1,
    );
    if (ownFile.some((r) => r.start < end && start < r.end)) {
      excluded.push({ reason: 'own_file_mask', span });
      return;
    }
    if (OWN_FILE_CUE.test(cue)) {
      excluded.push({ reason: 'own_file_cue', span });
      return;
    }
    if (h.lowConfidence && !(esas && karar) && !(date && (esas || karar))) {
      excluded.push({ reason: 'file_only_lower', span });
      return;
    }
    if (
      opts.headerZoneChars !== undefined &&
      span.start < opts.headerZoneChars &&
      esas &&
      !karar &&
      !date
    ) {
      excluded.push({ reason: 'header_zone', span });
      return;
    }
    const kunye: ParsedKunye = {
      courtClass: h.courtClass,
      courtLabel: h.courtLabel,
      chamberCode: h.chamberCode,
      esas: esas?.no ?? null,
      karar: karar?.no ?? null,
      basvuruNo: basvuru?.no ?? null,
      date: date?.iso ?? null,
      authorityNo: null,
      inferred,
      lowConfidence: h.lowConfidence,
    };
    citations.push({
      kind: 'decision_free',
      kunye,
      article: null,
      span,
      raw: text.slice(span.start, span.end),
      impossible: impossibleOf(kunye, opts.today),
    });
  });

  // Başlıksız AYM bireysel başvuru numarası (025 §5.4 istisnası).
  for (const n of nums) {
    if (n.used || n.role !== 'basvuru') continue;
    n.used = true;
    const date = dates.find((d) => d.start >= n.end && d.start <= n.end + DATE_AFTER) ?? null;
    const span = toSpan(n.start, date?.end ?? n.end);
    const kunye: ParsedKunye = {
      courtClass: 'aym_bireysel',
      courtLabel: null,
      chamberCode: null,
      esas: null,
      karar: null,
      basvuruNo: n.no,
      date: date?.iso ?? null,
      authorityNo: null,
      inferred: false,
      lowConfidence: false,
    };
    citations.push({
      kind: 'decision_free',
      kunye,
      article: null,
      span,
      raw: text.slice(span.start, span.end),
      impossible: impossibleOf(kunye, opts.today),
    });
  }

  citations.push(...extractAuthorities(norm, text, toSpan, opts.today));
  citations.push(...extractArticles(norm, text, toSpan));
  citations.sort((a, b) => a.span.start - b.span.start);
  return { citations, excluded };
}

// ---------------------------------------------------------------- kapsam dışı kurumlar (025 §5.7)

const AUTHORITY_RULES: readonly {
  cls: CourtClass;
  re: RegExp;
  no: (m: RegExpExecArray) => string;
}[] = [
  {
    cls: 'kik',
    re: new RegExp(
      `kamu\\s+ihale\\s+kurul\\p{L}*[^.]{0,80}?(${YEAR}\\/(?:uh|um|uy|mk|dk)(?:\\.(?:[iı]{1,3}|[iı]v|v[iı]{0,3}))?-\\d{1,5})`,
      'gu',
    ),
    no: (m) => m[1] ?? '',
  },
  {
    cls: 'rekabet',
    re: /rekabet\s+kurul\p{L}*[^.]{0,80}?((?<![\d-])\d{2}-\d{1,3}\/\d{1,4}-\d{1,4}(?![\d-]))/gu,
    no: (m) => m[1] ?? '',
  },
  {
    cls: 'gib',
    re: /(e-\d{6,10}-\d{3}(?:\[[\d.]+\])?-\d{3,8})[^.]{0,40}?özelge/gu,
    no: (m) => m[1] ?? '',
  },
  {
    cls: 'resmi_gazete',
    re: new RegExp(
      `(?:r\\.?\\s*g\\.?|resm[iî]\\s+gazete)\\s*[:,]?\\s*(?:t\\.?:?\\s*)?(\\d{1,2}[./]\\d{1,2}[./]${YEAR})\\s*[/,]?\\s*(?:s\\.?:?\\s*|sayı\\s*)?(\\d{4,6})`,
      'gu',
    ),
    no: (m) => `${m[1] ?? ''}/${m[2] ?? ''}`,
  },
];

function extractAuthorities(
  norm: string,
  text: string,
  toSpan: (s: number, e: number) => { start: number; end: number },
  today: string,
): ParsedCitation[] {
  const out: ParsedCitation[] = [];
  for (const rule of AUTHORITY_RULES) {
    for (const m of norm.matchAll(rule.re)) {
      const span = toSpan(m.index, m.index + m[0].length);
      const kunye: ParsedKunye = {
        courtClass: rule.cls,
        courtLabel: null,
        chamberCode: null,
        esas: null,
        karar: null,
        basvuruNo: null,
        date: null,
        authorityNo: rule.no(m),
        inferred: false,
        lowConfidence: true,
      };
      out.push({
        kind: 'authority_other',
        kunye,
        article: null,
        span,
        raw: text.slice(span.start, span.end),
        impossible: impossibleOf(kunye, today),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- madde atıfları (025 §8.1)

const ART =
  '(\\d{1,4})(?:\\s*\\/\\s*(\\d{1,3}|[a-zçğıöşü])(?:\\s*[/-]\\s*([a-zçğıöşü]|\\d{1,2}))?)?';
const ART_LIST = `${ART}(?:\\s*(?:,|ve|-)\\s*${ART})*`;
const M_MARK = '(?:m\\.?|madde)';
const SUFFIX = "(?:'?(?:nın|nin|nun|nün|ın|in|un|ün))?";

function articleRegexes(): { re: RegExp; kind: 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' }[] {
  const abbr = abbrPatternSource(false);
  const strict = abbrPatternSource(true);
  return [
    {
      kind: 'A7',
      re: new RegExp(
        `${NOT_L}(${abbr})\\s+(geçici|ek|mükerrer)\\s+${M_MARK}\\s*(${ART_LIST})`,
        'gu',
      ),
    },
    {
      kind: 'A5',
      re: new RegExp(`${NOT_L}(?:anayasa(?:'?nın)?|ay)\\s*${M_MARK}\\s*(${ART_LIST})`, 'gu'),
    },
    {
      kind: 'A1',
      // Kuyrukta "(mükerrer)" biçimleyici gösterimidir (081 §4.3): "TBK m. 18 (mükerrer)".
      re: new RegExp(
        `${NOT_L}(${abbr})\\s*${SUFFIX}\\s*${M_MARK}\\s*(${ART_LIST})(?:\\s*\\(mükerrer\\))?(\\s*vd\\.?)?`,
        'gu',
      ),
    },
    {
      kind: 'A6',
      re: new RegExp(
        `${NOT_L}(${abbr})\\s*'?(?:nın|nin|nun|nün)\\s+(${ART})\\s*\\.?\\s*(?:inci\\s+)?madde(?:si)?`,
        'gu',
      ),
    },
    {
      kind: 'A4',
      re: new RegExp(`(?<!\\d)(\\d{3,5})\\s+sayılı\\s+kanun\\s+${M_MARK}\\s*(${ART_LIST})`, 'gu'),
    },
    {
      kind: 'A3',
      re: new RegExp(
        `(?<!\\d)(\\d{3,5})\\s+sayılı\\s+(?:[\\p{L}\\s]{2,60}?\\s+)?kanun(?:'?(?:un|ın|nun|ün))?\\s+(${ART})\\s*\\.?\\s*(?:inci\\s+)?madde(?:si)?`,
        'gu',
      ),
    },
    {
      kind: 'A2',
      re: new RegExp(`${NOT_L}(${strict})\\s+(${ART_LIST})(?![\\p{L}\\d/])`, 'gu'),
    },
  ];
}

let ARTICLE_RES: ReturnType<typeof articleRegexes> | null = null;

function parseArticleList(
  list: string,
  prefix: '' | 'G' | 'E' | 'M',
): {
  articles: ArticleRef[];
  range: boolean;
} {
  const items = [...list.matchAll(new RegExp(ART, 'gu'))];
  const isRange = /\d\s*-\s*\d/u.test(list) && !/\/\s*\d+\s*-/u.test(list) && items.length === 2;
  const toRef = (m: RegExpMatchArray): ArticleRef => {
    const n = m[1] ?? '';
    const a = m[2];
    const b = m[3];
    if (a === undefined) return { key: `${prefix}${n}`, paragraph: null, sub: null };
    if (/^\d+$/.test(a)) return { key: `${prefix}${n}`, paragraph: Number(a), sub: b ?? null };
    // Harfli madde ile bent belirsiz (025 §8.1): madde anahtarı harfle taşınır, çözümleyici karar verir.
    return { key: `${prefix}${n}`, paragraph: null, sub: a };
  };
  if (isRange) {
    const from = Number(items[0]?.[1]);
    const to = Number(items[1]?.[1]);
    if (to > from && to - from < 10) {
      const articles: ArticleRef[] = [];
      for (let i = from; i <= to; i++)
        articles.push({ key: `${prefix}${i}`, paragraph: null, sub: null });
      return { articles, range: true };
    }
  }
  return { articles: items.map(toRef), range: false };
}

function extractArticles(
  norm: string,
  text: string,
  toSpan: (s: number, e: number) => { start: number; end: number },
): ParsedCitation[] {
  ARTICLE_RES ??= articleRegexes();
  const out: ParsedCitation[] = [];
  const taken: { start: number; end: number }[] = [];
  for (const { re, kind } of ARTICLE_RES) {
    re.lastIndex = 0;
    for (const m of norm.matchAll(re)) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (taken.some((t) => start < t.end && t.start < end)) continue;
      let lawNo: string | null;
      let abbr: string | null = null;
      let list: string;
      let prefix: '' | 'G' | 'E' | 'M' = '';
      let open = false;
      if (kind === 'A5') {
        lawNo = '2709';
        abbr = 'AY';
        list = m[1] ?? '';
      } else if (kind === 'A3' || kind === 'A4') {
        lawNo = m[1] ?? null;
        list = m[2] ?? '';
      } else {
        const law = lawByAbbr(m[1] ?? '');
        if (!law) continue;
        lawNo = law.lawNo;
        abbr = law.display ?? m[1] ?? null;
        if (kind === 'A7') {
          const k = m[2];
          prefix = k === 'geçici' ? 'G' : k === 'ek' ? 'E' : 'M';
          list = m[3] ?? '';
        } else {
          list = m[2] ?? '';
          open = kind === 'A1' && Boolean(m[m.length - 1]);
          // "vd." kuyruğu gösterimi bölmez: "TBK m. 18 (mükerrer) vd." (#46).
          if (kind === 'A1' && /\(mükerrer\)(?:\s*vd\.?)?$/u.test(m[0])) prefix = 'M';
        }
      }
      const { articles } = parseArticleList(list, prefix);
      if (articles.length === 0) continue;
      taken.push({ start, end });
      const span = toSpan(start, end);
      const article: ParsedArticle = { lawNo, abbr, articles, open };
      out.push({
        kind: 'article',
        kunye: null,
        article,
        span,
        raw: text.slice(span.start, span.end),
        impossible: [],
      });
    }
  }
  return out;
}
