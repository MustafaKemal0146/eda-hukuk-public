// Sezgisel karar bölümleyici (034 §6, 021 §5.8; P11 K1). Satır başı başlıklar `patterns.ts` kalıplarıyla
// rol alır; tanınmayan metin "diger" değil öncesinin rolüne eklenir; başlıksız metin tek `kunye` bölümüdür
// (fallback). yargi-mcp `get_decision` ve korpus alımı (P14) aynı işlevi kullanır. Saf işlev.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { DecisionSectionRole, SearchCourtType } from '@eda/contracts/enums';
import { tr_normalize, tr_upper } from '../text/normalize.ts';
import { splitSentences, type TextSpan } from '../text/sentences.ts';
import {
  GEREKCE_TAIL,
  GEREKCE_TAIL_LINE_MAX,
  HEADING_MAX,
  PROFILE_MARKERS,
  SECTION_MARKERS,
  type SectionProfile,
  SIGNATURE_LINE_MAX_CHARS,
  SIGNATURE_LINE_MAX_WORDS,
} from './patterns.ts';

export type DecisionSection = { role: DecisionSectionRole; text: string };

function headingKey(line: string): { head: string; hasValue: boolean } {
  const key = tr_upper(
    line
      .replace(/[*_#>]/g, '')
      .trim()
      .replace(/^([IVXLC]+|\d{1,2}|[A-Z])[.)-]\s*/, '')
      .trim(),
  );
  const colon = key.indexOf(':');
  if (colon < 0) return { head: key, hasValue: false };
  return { head: key.slice(0, colon).trim(), hasValue: key.slice(colon + 1).trim().length > 0 };
}

/** Satır bir bölüm başlığıysa rolünü, değilse null döner. */
export function roleOfLine(
  line: string,
  profile: SectionProfile = 'default',
): DecisionSectionRole | null {
  const trimmed = line.replace(/[*_]/g, '').trim();
  if (trimmed.length <= GEREKCE_TAIL_LINE_MAX && GEREKCE_TAIL.test(tr_upper(trimmed))) {
    return 'gerekce';
  }
  const { head, hasValue } = headingKey(line);
  if (head.length === 0 || head.length > HEADING_MAX) return null;
  for (const m of [...PROFILE_MARKERS[profile], ...SECTION_MARKERS]) {
    if (m.re.test(head) && (!hasValue || m.withValue)) return m.role;
  }
  return null;
}

/** Metni rol etiketli ardışık bölümlere ayırır; ilk bölüm `kunye`. */
export function splitDecisionSections(
  text: string,
  profile: SectionProfile = 'default',
): DecisionSection[] {
  const lines = text.split('\n');
  const out: DecisionSection[] = [];
  let role: DecisionSectionRole = 'kunye';
  let buf: string[] = [];
  const flush = (): void => {
    const t = buf.join('\n').trim();
    if (t.length > 0) {
      const last = out.at(-1);
      if (last && last.role === role) last.text = `${last.text}\n\n${t}`;
      else out.push({ role, text: t });
    }
    buf = [];
  };
  for (const line of lines) {
    const r = roleOfLine(line, profile);
    if (r !== null && r !== role) {
      flush();
      role = r;
    }
    buf.push(line);
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- korpus bölümleme (034 §6; P14a.4)

export type SectionOutcome = 'patterned' | 'fallback';

/** `corpus.decision_sections` satırı (030 §13): `no` 1'den ardışık; `heading` yalnız bölmenin ilkinde. */
export type NumberedSection = {
  no: number;
  role: DecisionSectionRole;
  heading: string | null;
  text: string;
};

export type SectionedDecision = { outcome: SectionOutcome; sections: NumberedSection[] };

const PROFILE_BY_COURT: Readonly<Partial<Record<SearchCourtType, SectionProfile>>> = {
  aym_bireysel: 'aym',
  aym_norm: 'aym',
  uyusmazlik: 'uyusmazlik',
};

export function sectionProfileOf(courtType: SearchCourtType): SectionProfile {
  return PROFILE_BY_COURT[courtType] ?? 'default';
}

/** 034 §6.6 unvan satırları (`tr_normalize` biçimi, satır başı). */
const SIGNATURE_TITLES =
  /^(başkan|başkanvekili|başkan vekili|üye|üyeler|raportör|hakim|zabıt katibi|katip)(?!\p{L})/u;

function isSignatureLine(line: string): boolean {
  const t = line.replace(/[*_#]/g, '').trim();
  if (t.length === 0 || t.length > SIGNATURE_LINE_MAX_CHARS) return false;
  const norm = tr_normalize(t);
  if (/karar verildi|oy birliği|oy çokluğu/u.test(norm)) return false;
  if (SIGNATURE_TITLES.test(norm)) return true;
  if (/\d/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > SIGNATURE_LINE_MAX_WORDS) return false;
  return words.every((w) => /^[^\p{L}]*\p{Lu}/u.test(w));
}

/**
 * 034 §6.6: son bölümün sonundan geriye ardışık kısa / unvan satırları heyet-imza bloğudur ve ayrı
 * `kunye` bölümü olur (hâkim adları BM25 ve LLM dışında kalır). Bölümde en az bir satır kalır.
 */
function splitSignatureBlock(text: string): { body: string; block: string | null } {
  const lines = text.split('\n');
  let cut = lines.length;
  while (
    cut > 1 &&
    (isSignatureLine(lines[cut - 1] ?? '') || (lines[cut - 1] ?? '').trim() === '')
  ) {
    cut -= 1;
  }
  while (cut < lines.length && (lines[cut] ?? '').trim() === '') cut += 1;
  if (cut >= lines.length || lines.slice(cut).every((l) => l.trim() === '')) {
    return { body: text, block: null };
  }
  const body = lines.slice(0, cut).join('\n').trim();
  if (body === '') return { body: text, block: null };
  return { body, block: lines.slice(cut).join('\n').trim() };
}

/** Bölümün ilk satırı başlıksa ayırır (034 §6.2 adım 4: satır içi başlıkta kalan metin gövdeye). */
function takeHeading(
  text: string,
  profile: SectionProfile,
): { heading: string | null; text: string } {
  const nl = text.indexOf('\n');
  const first = nl < 0 ? text : text.slice(0, nl);
  const rest = nl < 0 ? '' : text.slice(nl + 1);
  if (roleOfLine(first, profile) === null) return { heading: null, text };
  const clean = first.replace(/[*_#]/g, '').trim();
  const colon = clean.indexOf(':');
  const label = (colon < 0 ? clean : clean.slice(0, colon)).trim();
  // "… gereği düşünüldü:" ile biten uzun cümle başlık değil gövdedir.
  if (label.length > HEADING_MAX) return { heading: null, text };
  const inline = colon < 0 ? '' : clean.slice(colon + 1).trim();
  const body = [inline, rest.trim()].filter((p) => p.length > 0).join('\n');
  if (body === '') return { heading: null, text };
  return { heading: label, text: body };
}

/**
 * 034 §6.5: uzun bölüm metnini önce boş satırdan, sonra cümle sınırından (`splitSentences`), sonra son
 * boşluktan bölen aralıklar. Aralıklar metnin birebir dilimleridir; aralar yalnız boşluktur (kayıpsız).
 */
export function splitLongText(text: string, maxChars: number): TextSpan[] {
  const out: TextSpan[] = [];
  let start = text.search(/\S/);
  if (start < 0) return out;
  const end = text.trimEnd().length;
  while (end - start > maxChars) {
    const limit = start + maxChars;
    const window = text.slice(start, limit + 1);
    let cut = -1;
    for (const m of window.matchAll(/\n[ \t]*\n/g)) {
      if (m.index > 0) cut = start + m.index;
    }
    if (cut < 0) {
      for (const s of splitSentences(text.slice(start, limit))) {
        const at = start + s.end;
        if (s.end < limit - start && at > start && /\s/.test(text[at - 1] ?? '')) cut = at;
      }
    }
    if (cut < 0) {
      const ws = window.slice(0, maxChars).search(/\s\S*$/);
      cut = ws > 0 ? start + ws : limit;
    }
    const pieceEnd = start + text.slice(start, cut).trimEnd().length;
    out.push({ start, end: pieceEnd });
    const next = text.slice(cut).search(/\S/);
    start = next < 0 ? end : cut + next;
  }
  if (start < end) out.push({ start, end });
  return out;
}

const FALLBACK_KUNYE_HINT = /(?<!\p{L})(esas|karar|daire|mahkeme)/u;

/**
 * Korpus bölümleme (034 §6): `splitDecisionSections` (yargi-mcp ile ortak kalıplar) + başlık ayırma,
 * heyet/imza bloğu (§6.6), fallback (§6.7), 6000 karakter bölme (§6.5) ve numaralama. `outcome`
 * `fallback` = `gerekce` ve `hukum` bölümü yok (`eda_corpus_segmentation_total`, 023 §4.5-3).
 */
export function sectionDecision(
  text: string,
  opts: { courtType: SearchCourtType; maxChars?: number },
): SectionedDecision {
  const profile = sectionProfileOf(opts.courtType);
  const maxChars = opts.maxChars ?? CONFIG_DEFAULTS['sources.decisionSectionMaxChars'];
  let raw: { role: DecisionSectionRole; text: string }[] = splitDecisionSections(text, profile);

  if (raw.length > 0 && raw.every((s) => s.role === 'kunye')) {
    // §6.7: hiçbir başlık tanınmadı. İlk paragraf künye ipucu taşıyorsa kunye, kalan gövde diger.
    const body = raw.map((s) => s.text).join('\n\n');
    const para = /\n[ \t]*\n/.exec(body);
    const firstEnd = para ? para.index : body.indexOf('\n') < 0 ? body.length : body.indexOf('\n');
    const first = body.slice(0, firstEnd).trim();
    const rest = body.slice(firstEnd).trim();
    if (FALLBACK_KUNYE_HINT.test(tr_normalize(first)) && rest !== '') {
      raw = [
        { role: 'kunye', text: first },
        { role: 'diger', text: rest },
      ];
    } else {
      raw = [{ role: 'diger', text: body }];
    }
  }

  const last = raw.at(-1);
  if (last && raw.length > 0) {
    const { body, block } = splitSignatureBlock(last.text);
    if (block !== null)
      raw = [...raw.slice(0, -1), { role: last.role, text: body }, { role: 'kunye', text: block }];
  }

  const sections: NumberedSection[] = [];
  for (const s of raw) {
    const { heading, text: body } =
      s.role === 'kunye' ? { heading: null, text: s.text } : takeHeading(s.text, profile);
    splitLongText(body, maxChars).forEach((span, i) => {
      sections.push({
        no: sections.length + 1,
        role: s.role,
        heading: i === 0 ? heading : null,
        text: body.slice(span.start, span.end),
      });
    });
  }
  const outcome: SectionOutcome = sections.some((s) => s.role === 'gerekce' || s.role === 'hukum')
    ? 'patterned'
    : 'fallback';
  return { outcome, sections };
}
