// Künye biçimleyici (081 §4, §9). Saf: yalnız kayıt alanları girer; model çıktısı veya kullanıcı metni
// girmez. Kısa stil çip etiketi, tam stil kopyalama/dilekçe, indeks stil `kunye_norm` girdisidir.
import type { SearchCourtType } from '@eda/contracts/enums';
import { formatDateTr } from './canonical.ts';
import { chamberInfo } from './chambers.ts';
import { lawDisplay } from './law-aliases.ts';
import type { ArticleRef, CourtClass } from './types.ts';

export type KunyeStyle = 'short' | 'full' | 'index';

/**
 * Korpus / MCP `court_type` (082 §2.2, `SEARCH_COURT_TYPES`) → biçimleyici sınıfı (025 `CourtClass`).
 * Tek eşleme: korpus, araç katmanı ve künye kontrolü bunu kullanır (P14 K3). İlk derece
 * hukuk mahkemesi 025 ayrıştırıcı sınıfında `yerel`dir; `court_type` olarak `yerel` yazılmaz.
 */
export const COURT_CLASS_BY_TYPE: Readonly<Record<SearchCourtType, CourtClass>> = {
  yargitay: 'yargitay',
  danistay: 'danistay',
  istinaf_hukuk: 'istinaf_hukuk',
  ilk_derece_hukuk: 'yerel',
  kyb: 'kyb',
  aym_bireysel: 'aym_bireysel',
  aym_norm: 'aym_norm',
  uyusmazlik: 'uyusmazlik',
  kik: 'kik',
  rekabet: 'rekabet',
  gib: 'gib',
};

export function courtClassOf(courtType: SearchCourtType): CourtClass {
  return COURT_CLASS_BY_TYPE[courtType];
}

export type KunyeRecord = {
  courtClass: CourtClass;
  /** Görünen ad: BAM/ilk derecede mahkeme adı ("İstanbul Bölge Adliye Mahkemesi"). */
  courtName: string | null;
  chamberCode: string | null;
  chamberName: string | null;
  chamberShort: string | null;
  esasNo: string | null;
  kararNo: string | null;
  decisionDate: string | null;
  /** AYM bölüm/genel kurul; Uyuşmazlık bölümü. */
  unitLabel: string | null;
  rgText: string | null;
};

export type KunyeMissing = 'court' | 'chamber' | 'esas' | 'karar' | 'date';

export type FormattedKunye = { text: string; complete: boolean; missing: KunyeMissing[] };

const COURT_FULL: Partial<Record<CourtClass, string>> = {
  yargitay: 'Yargıtay',
  kyb: 'Yargıtay',
  danistay: 'Danıştay',
  aym_norm: 'Anayasa Mahkemesi',
  aym_bireysel: 'Anayasa Mahkemesi',
  uyusmazlik: 'Uyuşmazlık Mahkemesi',
};

const COURT_SHORT: Partial<Record<CourtClass, string>> = {
  yargitay: 'Y.',
  kyb: 'Y.',
  danistay: 'Dn.',
  aym_norm: 'AYM',
  aym_bireysel: 'AYM',
  uyusmazlik: 'Uyuşmazlık Mah.',
};

function chamber(rec: KunyeRecord): { name: string | null; short: string | null } {
  const info = rec.chamberCode ? chamberInfo(rec.chamberCode) : null;
  return {
    name: rec.chamberName ?? info?.name ?? null,
    short: rec.chamberShort ?? info?.short ?? null,
  };
}

/** "İstanbul Bölge Adliye Mahkemesi" → "İstanbul BAM"; ilk derecede "Mahkemesi" → "Mah." (081 §4.2-2). */
function shortCourtName(name: string, cls: CourtClass): string {
  if (cls === 'istinaf_hukuk' || cls === 'istinaf_ceza') {
    return name.replace(/\s*Bölge Adliye Mahkemesi$/u, ' BAM');
  }
  return name.replace(/Mahkemesi$/u, 'Mah.');
}

function missingOf(rec: KunyeRecord): KunyeMissing[] {
  const out: KunyeMissing[] = [];
  const needsChamber = ['yargitay', 'danistay', 'kyb', 'istinaf_hukuk', 'uyusmazlik'].includes(
    rec.courtClass,
  );
  if (!COURT_FULL[rec.courtClass] && !rec.courtName) out.push('court');
  if (needsChamber && !rec.chamberCode && !rec.chamberName) out.push('chamber');
  if (!rec.esasNo) out.push('esas');
  if (!rec.kararNo && rec.courtClass !== 'aym_bireysel') out.push('karar');
  if (!rec.decisionDate) out.push('date');
  return out;
}

export function formatKunye(rec: KunyeRecord, style: KunyeStyle): FormattedKunye {
  const missing = missingOf(rec);
  const ch = chamber(rec);
  const kyb = rec.courtClass === 'kyb';
  if (style === 'full') {
    const court = COURT_FULL[rec.courtClass] ?? rec.courtName ?? '';
    const parts: string[] = [];
    if (rec.courtClass === 'aym_bireysel') {
      const unit = rec.unitLabel ? ` (${rec.unitLabel})` : '';
      parts.push(`${court}${unit}`);
      if (rec.esasNo) parts.push(`B. No: ${rec.esasNo}`);
    } else {
      const unit = rec.courtClass === 'uyusmazlik' ? (rec.unitLabel ?? ch.name) : ch.name;
      parts.push([court, unit].filter(Boolean).join(' '));
      if (rec.esasNo) parts.push(`E. ${rec.esasNo}`);
      if (rec.kararNo) parts.push(`K. ${rec.kararNo}`);
    }
    if (rec.decisionDate) parts.push(`T. ${formatDateTr(rec.decisionDate)}`);
    if (rec.courtClass === 'aym_norm' && rec.rgText) parts.push(`RG ${rec.rgText}`);
    const text = `${parts.join(', ')}${kyb ? ' (kanun yararına bozma)' : ''}`;
    return { text, complete: missing.length === 0, missing };
  }
  const courtShort =
    COURT_SHORT[rec.courtClass] ??
    (rec.courtName ? shortCourtName(rec.courtName, rec.courtClass) : '');
  const chShort = rec.courtClass === 'uyusmazlik' ? null : ch.short;
  const head = [courtShort, chShort, kyb ? 'KYB' : null].filter(Boolean).join(' ');
  let nums: string;
  if (rec.courtClass === 'aym_bireysel') {
    nums = rec.esasNo ? `B. No: ${rec.esasNo}` : '';
  } else if (style === 'index') {
    nums = [rec.esasNo ? `${rec.esasNo} E.` : null, rec.kararNo ? `${rec.kararNo} K.` : null]
      .filter(Boolean)
      .join(' ');
  } else {
    nums = rec.esasNo ? `${rec.esasNo} E.` : rec.kararNo ? `${rec.kararNo} K.` : '';
  }
  const text = [head, nums].filter(Boolean).join(' ');
  return { text, complete: missing.length === 0 && nums !== '', missing };
}

/** Madde anahtarı (023 §8): 49, 49/A, G5, E3, M18 → gösterim parçası. */
function articleText(a: ArticleRef): string {
  let base: string;
  if (a.key.startsWith('G')) base = `geçici m. ${a.key.slice(1)}`;
  else if (a.key.startsWith('E')) base = `ek m. ${a.key.slice(1)}`;
  else if (a.key.startsWith('M')) base = `m. ${a.key.slice(1)} (mükerrer)`;
  else base = `m. ${a.key}`;
  if (a.paragraph !== null) base += `/${a.paragraph}${a.sub ? `-${a.sub}` : ''}`;
  else if (a.sub) base += `/${a.sub}`;
  return base;
}

/**
 * 081 §4.3: "TBK m. 352", "6098 s. K. m. 49/A", "TBK m. 344, 345", "TBK m. 344-346", "TBK m. 344 vd.".
 * Aralık `range` ile verilir (ilk ve son madde).
 */
export function formatArticleRef(ref: {
  lawNo: string;
  lawShort?: string | null;
  articles: readonly ArticleRef[];
  open?: boolean;
  range?: boolean;
}): string {
  const law = ref.lawShort ?? lawDisplay(ref.lawNo);
  const [first, ...rest] = ref.articles;
  if (!first) return law;
  let text = `${law} ${articleText(first)}`;
  const last = rest[rest.length - 1];
  if (ref.range && last) {
    // Aynı türde aralıkta tür öneki bir kez yazılır: "TBK geçici m. 1-5" (G1-G5).
    const kind = /^[GEM]/.exec(first.key)?.[0] ?? '';
    const sameKind = (/^[GEM]/.exec(last.key)?.[0] ?? '') === kind;
    text += `-${sameKind ? last.key.slice(kind.length) : articleText(last)}`;
  } else if (rest.length > 0) {
    text += `, ${rest.map((a) => articleText(a).replace(/^m\. /, '')).join(', ')}`;
  }
  if (ref.open) text += ' vd.';
  return text;
}

/**
 * "Kaynaklar" satırı (081 §5.3): `{tam künye} — Kaynak: {kaynak adı}, erişim tarihi: GG.AA.YYYY`.
 * `retrievedAt` (ISO gün) `null` ise erişim tarihi kısmı tümüyle çıkarılır; tarih uydurulmaz. Kaynak
 * adı çağırandan gelir (`SOURCE_LABELS`, 053-ekranlar/04); "Yerel korpus" yazılmaz.
 */
export function formatSourceLine(line: {
  kunye: string;
  sourceLabel: string;
  retrievedAt: string | null;
}): string {
  const access = line.retrievedAt ? `, erişim tarihi: ${formatDateTr(line.retrievedAt)}` : '';
  return `${line.kunye} — Kaynak: ${line.sourceLabel}${access}`;
}
