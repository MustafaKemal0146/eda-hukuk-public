// Mevzuat madde ve fıkra ayrıştırıcı (034 §9.3; P11 K2). Ayrıştırma satıra değil işaretçiye dayanır
// (PDF'te madde içinde satır sonu olmayabilir): işaretçiler `tr_normalize` edilmiş metinde aranır, madde
// gövdesi ofset haritasıyla özgün metinden kesilir. Anahtarlar: `49`, `4/A`, geçici `G5`, ek `E3`,
// mükerrer `M18` ("Madde 5" ile "Geçici Madde 5" ayrı anahtar uzayıdır). Saf işlev.
// yargi-mcp `get_legislation_live` / `search_legislation_live` aynı işlevi kullanır (034 §9.3).
import { normalizeWithMap, tr_normalize, tr_upper } from '../text/normalize.ts';

export type LawArticleKind = 'madde' | 'gecici' | 'ek' | 'mukerrer';

export type LawParagraph = { no: number; text: string };

export type ParsedLawArticle = {
  /** `49`, `4/A`, `G5`, `E3`, `M18`. */
  key: string;
  kind: LawArticleKind;
  number: number;
  letter: string | null;
  /** MADDE satırından hemen önceki kısa satır (≤ 100 karakter, nokta ile bitmeyen); yoksa null. */
  title: string | null;
  /** İşaretçiden sonraki özgün madde metni (sonraki maddenin başlık satırları hariç). */
  text: string;
  status: 'active' | 'repealed';
  /** `(Değişik: …)`, `(Ek: …)`, `(İptal: …)`, `(Mülga: …)`, `(Yeniden düzenleme …)` notları. */
  amendedNote: string | null;
  /** Notlardaki en geç tarih (ISO); yoksa null. */
  amendedAt: string | null;
  paragraphs: LawParagraph[];
};

/** 034 §9.3 madde başlığı kalıpları (tr_normalize edilmiş metin; tireler `-`'ye katlanmış). */
const MARKER =
  /(geçici madde|ek madde|mükerrer madde|madde)\s+(\d{1,4})(?:\s*\/\s*([a-zçğıöşü]))?\s*[-.](?=\s|$)/gu;

const KIND: Readonly<Record<string, LawArticleKind>> = {
  madde: 'madde',
  'geçici madde': 'gecici',
  'ek madde': 'ek',
  'mükerrer madde': 'mukerrer',
};
const PREFIX: Readonly<Record<LawArticleKind, string>> = {
  madde: '',
  gecici: 'G',
  ek: 'E',
  mukerrer: 'M',
};

const TITLE_MAX = 100;
/** Kısım / bölüm / ayrım / kitap başlıkları madde sınırı değildir ve atılır (034 §9.3). */
const SECTION_HEADING = /(^|\s)(kısım|bölüm|ayrım|kitap)$/u;
/** Fıkra işaretçisinden önceki 40 karakterde bu sözcükler varsa işaretçi atıftır (034 §9.3). */
const REFERENCE_BEFORE = /(madde|maddenin|maddesinin|fıkra|fıkrasının|bendi|bendinin)\s*$/u;
const REFERENCE_WINDOW = 40;
const NOTE = /\((değişik|ek|iptal|mülga|yeniden düzenleme)[^()]*\)/gu;
const DATE = /(\d{1,2})[./](\d{1,2})[./](\d{4})/g;

type Marker = {
  start: number;
  end: number;
  kind: LawArticleKind;
  number: number;
  letter: string | null;
};

/** İşaretçi metin başında, satır başında veya cümle sonu noktalamasından sonra olmalıdır. */
function atBoundary(original: string, norm: string, normIdx: number, origIdx: number): boolean {
  if (normIdx === 0) return true;
  for (let i = origIdx - 1; i >= 0; i--) {
    const ch = original[i];
    if (ch === '\n') return true;
    if (ch !== ' ' && ch !== '\t' && ch !== '\r') break;
  }
  return /[.:;)]\s$/u.test(norm.slice(Math.max(0, normIdx - 2), normIdx));
}

function findMarkers(original: string): { markers: Marker[]; map: number[]; norm: string } {
  const { norm, map } = normalizeWithMap(original);
  const markers: Marker[] = [];
  MARKER.lastIndex = 0;
  for (let m = MARKER.exec(norm); m !== null; m = MARKER.exec(norm)) {
    const kind = KIND[m[1] ?? ''];
    if (kind === undefined) continue;
    if (!atBoundary(original, norm, m.index, map[m.index] ?? 0)) continue;
    const letter = m[3] && kind !== 'mukerrer' ? tr_upper(m[3]) : null;
    markers.push({
      start: m.index,
      end: m.index + m[0].length,
      kind,
      number: Number(m[2]),
      letter,
    });
  }
  return { markers, map, norm };
}

const origAt = (map: number[], normIdx: number, fallback: number): number =>
  normIdx < map.length ? (map[normIdx] ?? fallback) : fallback;

const cleanTitle = (line: string): string =>
  line
    .replace(/(\s*\[\d{1,3}\])+$/u, '')
    .replace(/\s*:$/u, '')
    .trim();

/**
 * Bölgenin sonundaki başlık satırlarını ayırır: noktalama ile bitmeyen kısa satırlar başlıktır;
 * işaretçiden hemen önceki satır (kısım/bölüm başlığı değilse) sonraki maddenin başlığıdır.
 */
function splitTrailingHeadings(
  region: string,
  keepFirstLine: boolean,
): { body: string; title: string | null } {
  const lines = region.split('\n');
  // Madde bölgesinin ilk dolu satırı işaretçi satırının devamıdır: başlık sayılmaz (kısa, noktasız tek
  // cümlelik madde gövdesi sonraki maddenin başlığına dönüşmesin).
  const floor = keepFirstLine ? lines.findIndex((l) => l.trim() !== '') + 1 : 0;
  let title: string | null = null;
  let first = true;
  while (lines.length > floor) {
    const raw = lines[lines.length - 1] ?? '';
    const line = raw.trim();
    if (line === '') {
      lines.pop();
      continue;
    }
    // 034 §9.3: başlık nokta ile bitmez; ":" ile biten kenar başlığı ("Yürürlükten kaldırılan kanun:")
    // başlıktır. Dipnot işareti ("Yasaklar:[5]") ve sondaki ":" başlıktan atılır.
    const isHeading = line.length <= TITLE_MAX && !/[.;,)]$/u.test(line);
    if (!isHeading) break;
    if (first && !SECTION_HEADING.test(tr_normalize(line))) title = cleanTitle(line);
    first = false;
    lines.pop();
  }
  return { body: lines.join('\n').trim(), title };
}

function amendments(norm: string, original: string, map: number[]) {
  const notes: string[] = [];
  let latest: string | null = null;
  NOTE.lastIndex = 0;
  for (let m = NOTE.exec(norm); m !== null; m = NOTE.exec(norm)) {
    const from = map[m.index] ?? 0;
    const to = (map[m.index + m[0].length - 1] ?? from) + 1;
    notes.push(original.slice(from, to));
    DATE.lastIndex = 0;
    for (let d = DATE.exec(m[0]); d !== null; d = DATE.exec(m[0])) {
      const iso = `${d[3]}-${(d[2] ?? '').padStart(2, '0')}-${(d[1] ?? '').padStart(2, '0')}`;
      if (latest === null || iso > latest) latest = iso;
    }
  }
  return { amendedNote: notes.length > 0 ? notes.join(' ') : null, amendedAt: latest };
}

/** Fıkra bölme: `(N)` yalnız gövde/satır başında veya `.`, `:`, `;` + boşluk sonrasında; ardışık. */
export function splitParagraphs(body: string): LawParagraph[] {
  const { norm, map } = normalizeWithMap(body);
  const cuts: { no: number; normAt: number }[] = [];
  const re = /\((\d{1,3})\)/g;
  for (let m = re.exec(norm); m !== null; m = re.exec(norm)) {
    const no = Number(m[1]);
    const expected = (cuts.at(-1)?.no ?? 0) + 1;
    if (no !== expected) continue;
    const before = norm.slice(Math.max(0, m.index - REFERENCE_WINDOW), m.index);
    if (REFERENCE_BEFORE.test(before)) continue;
    if (!atBoundary(body, norm, m.index, map[m.index] ?? 0)) continue;
    cuts.push({ no, normAt: m.index });
  }
  if (cuts.length === 0) return body.trim() === '' ? [] : [{ no: 1, text: body.trim() }];
  return cuts.map((c, i) => {
    const from = origAt(map, c.normAt, body.length);
    const next = cuts[i + 1];
    const to = next ? origAt(map, next.normAt, body.length) : body.length;
    return { no: c.no, text: body.slice(from, to).trim() };
  });
}

export function parseLawArticles(text: string): ParsedLawArticle[] {
  const { markers, map } = findMarkers(text);
  const out: ParsedLawArticle[] = [];
  let pendingTitle = splitTrailingHeadings(
    text.slice(0, origAt(map, markers[0]?.start ?? 0, text.length)),
    false,
  ).title;
  markers.forEach((mk, i) => {
    const from = origAt(map, mk.end, text.length);
    const next = markers[i + 1];
    const to = next ? origAt(map, next.start, text.length) : text.length;
    const { body, title: nextTitle } = next
      ? splitTrailingHeadings(text.slice(from, to), true)
      : { body: text.slice(from, to).trim(), title: null };
    const bodyNorm = normalizeWithMap(body);
    const repealed =
      /^\(mülga\b/u.test(bodyNorm.norm) || bodyNorm.norm.includes('ilgili kanunlara işlenmiştir');
    const key = `${PREFIX[mk.kind]}${mk.number}${mk.letter ? `/${mk.letter}` : ''}`;
    out.push({
      key,
      kind: mk.kind,
      number: mk.number,
      letter: mk.letter,
      title: pendingTitle,
      text: body,
      status: repealed ? 'repealed' : 'active',
      ...amendments(bodyNorm.norm, body, bodyNorm.map),
      paragraphs: splitParagraphs(body),
    });
    pendingTitle = nextTitle;
  });
  return out;
}
