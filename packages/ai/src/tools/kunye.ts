// Künye biçimi (025 §4.5, 081): çip etiketi ve KAYNAK DİZİNİ satırı. Tek biçimleyici `@eda/legal/kunye`
// (081 §9); burada yalnız NormalizedDecision → KunyeRecord eşlemesi yapılır. Künye kayıttan render edilir.
import {
  articleSpanText,
  courtClassOf,
  formatArticleRef,
  formatKunye,
  type KunyeRecord,
  lawDisplay,
  parseArticleSpan,
} from '@eda/legal/kunye';
import type { DecisionHit, LawHit } from './context.ts';

/** "9. Hukuk Dairesi" → "9. HD"; "Hukuk Genel Kurulu" → "HGK"; "3. Ceza Dairesi" → "3. CD". */
export function chamberAbbr(chamber: string | null): string | null {
  if (!chamber) return null;
  const c = chamber.trim();
  const genel = /^(Hukuk|Ceza)\s+Genel\s+Kurulu$/iu.exec(c);
  if (genel) return genel[1]?.startsWith('H') ? 'HGK' : 'CGK';
  const daire = /^(\d+)\.\s*(Hukuk|Ceza)?\s*Daire(?:si)?$/iu.exec(c);
  if (daire) {
    const kind = daire[2] ? (daire[2].startsWith('H') ? 'HD' : 'CD') : 'D.';
    return `${daire[1]}. ${kind}`;
  }
  return c;
}

export function isoToTr(d: string | null): string | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function recordOf(h: DecisionHit): KunyeRecord {
  const cls = courtClassOf(h.court_type);
  const named = cls === 'istinaf_hukuk' || cls === 'yerel';
  // AYM bölümü daire değil birimdir: tam stilde parantez içinde, kısa stilde yazılmaz (081 §4.2).
  const aym = cls === 'aym_bireysel' || cls === 'aym_norm';
  return {
    courtClass: cls,
    courtName: named ? h.court : null,
    chamberCode: null,
    chamberName: aym ? null : h.chamber,
    chamberShort: aym ? null : chamberAbbr(h.chamber),
    esasNo: h.esas_no,
    kararNo: h.karar_no,
    decisionDate: h.decision_date,
    unitLabel: cls === 'uyusmazlik' || cls === 'aym_bireysel' ? h.chamber : null,
    rgText: null,
  };
}

/** Çip etiketi (081 kısa stil): "Y. 9. HD 2024/1234 E.", "AYM B. No: 2019/12345". */
export function decisionShortKunye(h: DecisionHit): string {
  return formatKunye(recordOf(h), 'short').text || h.title;
}

/** Tam künye (081 tam stil): "Yargıtay 9. Hukuk Dairesi, E. 2024/1234, K. 2025/5678, T. 12.03.2025". */
export function decisionLongKunye(h: DecisionHit): string {
  return formatKunye(recordOf(h), 'full').text || h.title;
}

/**
 * Madde girdisi veya yargi-mcp anahtarı → 034 §9.3 kanonik metni: "Geçici 1" → "G1", "344 - 346" →
 * "344-346", "geçici 1-5" → "G1-G5". Çözülemeyen girdi kırpılmış hâliyle döner.
 */
export function canonicalArticleNo(articleNo: string): string {
  const span = parseArticleSpan(articleNo);
  return span ? articleSpanText(span) : articleNo.trim();
}

/** Madde atfı (081 §4.3); `lawLabel` yoksa 081 §6 kısaltması. */
function articleRefText(lawNo: string, lawLabel: string | null, articleNo: string): string {
  const span = parseArticleSpan(articleNo);
  if (!span) return `${lawLabel ?? lawDisplay(lawNo)} m. ${articleNo.trim()}`;
  const keys = span.to === null ? [span.from] : [span.from, span.to];
  return formatArticleRef({
    lawNo,
    lawShort: lawLabel,
    articles: keys.map((key) => ({ key, paragraph: null, sub: null })),
    range: span.to !== null,
  });
}

/**
 * "TBK m. 352", "TBK m. 352/A", "TBK geçici m. 1", "TBK ek m. 3", "TBK m. 18 (mükerrer)",
 * "TBK m. 344-346" (081 §4.3; kısaltma sözlüğü 081 §6). Anahtar 034 §9.3 biçimindedir (G1, E3, M18).
 */
export function lawShortKunye(lawNo: string, _lawName: string, articleNo: string | null): string {
  if (!articleNo) return lawDisplay(lawNo);
  return articleRefText(lawNo, null, articleNo);
}

/** Kaynak başlığı: "6098 sayılı Türk Borçlar Kanunu geçici m. 1". */
export function lawArticleTitle(lawNo: string, lawName: string, articleNo: string): string {
  return articleRefText(lawNo, `${lawNo} sayılı ${lawName}`, articleNo);
}

/** Kaynak anahtarı `mevzuat:<kanun>:<kanonik madde>`: aynı madde her girdi biçiminde aynı anahtarı alır. */
export function lawSourceKey(lawNo: string, articleNo: string | null): string {
  return `mevzuat:${lawNo}:${articleNo === null ? '' : canonicalArticleNo(articleNo)}`;
}

export function lawHitKey(h: LawHit): string {
  return lawSourceKey(h.law_no, h.article_no);
}
