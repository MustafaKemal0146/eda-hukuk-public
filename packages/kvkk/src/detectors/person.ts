// Kişi adı algılayıcısı (026 §6.4; KISI, sözlük dışı üçüncü kişiler). Regex yerine doğrusal belirteç
// taraması. Kabul kuralları a-e, sağdan/soldan kırpma. Yapısal sınır: küçük harfli, ek almış, kısaltmalı
// adlar ve yalnız soyadı kaçabilir; ölçüm ayrı satırda raporlar (026 §13.6).
import { ACRONYMS } from '../data/acronyms.tr.ts';
import { COMMON_WORDS } from '../data/common-words.tr.ts';
import { GIVEN_NAMES } from '../data/given-names.tr.ts';
import { PROVINCES } from '../data/provinces.tr.ts';
import { foldChars, isAllUpper, trLower, trTitle } from '../fold.ts';
import { type ScanText, scanToNfc } from '../normalize.ts';
import { type Candidate, PRIORITY } from './candidate.ts';
import { isLegalTermWord } from './legal-terms.ts';
import { isNameShape, tokenizeWords, type Word } from './words.ts';

const GIVEN = new Set(GIVEN_NAMES.map((n) => foldChars(n)));
const ACRONYM = new Set(ACRONYMS.map((a) => foldChars(a)));
const PROVINCE = new Set(PROVINCES.map((p) => foldChars(p)));
const COMMON = new Set(COMMON_WORDS.map((w) => foldChars(w)));

/**
 * Küçük harf / karışık harf yazımda (kasıtlı atlatma dahil) soyadı olamayacak sık sözcükler (katlanmış):
 * bağlaç, zamir, hitap ve sık fiil biçimleri. Liste kısa tutulur; amaç "ahmet yılmaz" gibi biçimi
 * yakalarken "ahmet geldi" gibi cümleyi gereksiz maskelememektir (emin olunmayan yerde yakalama seçilir).
 */
const NOT_SURNAME: ReadonlySet<string> = new Set(
  [
    've',
    'ile',
    'de',
    'da',
    'ki',
    'mi',
    'mu',
    'icin',
    'gibi',
    'kadar',
    'daha',
    'cok',
    'bir',
    'bu',
    'su',
    'o',
    'ben',
    'sen',
    'biz',
    'siz',
    'onlar',
    'ama',
    'fakat',
    'veya',
    'ya',
    'hem',
    'yani',
    'sonra',
    'once',
    'simdi',
    'bugun',
    'dun',
    'yarin',
    'evet',
    'hayir',
    'tamam',
    'lutfen',
    'bey',
    'hanim',
    'efendi',
    'abi',
    'abla',
    'amca',
    'teyze',
    'dayi',
    'hala',
    'kardes',
    'usta',
    'hoca',
    'var',
    'yok',
    'olarak',
    'icin',
    'ise',
    'idi',
    'imis',
    'olan',
    'oldu',
    'olur',
    'gelir',
    'gider',
    'der',
    'dedi',
    'geldi',
    'gitti',
    'etti',
    'yapti',
    'verdi',
    'aldi',
    'bana',
    'sana',
    'ona',
    'bize',
    'size',
    'onu',
    'beni',
    'seni',
    'her',
    'hic',
    'ne',
    'nasil',
    'neden',
    'nerede',
    'kim',
    'hangi',
    'tarafindan',
    'hakkinda',
    'adina',
    'adli',
    'isimli',
    'ismindeki',
    'tc',
    'no',
    'tel',
    'telefon',
    'mail',
    'eposta',
    'iban',
    'adres',
  ].map((w) => foldChars(w)),
);
const VERB_TAIL = /(?:di|du|ti|tu|mis|mus|yor|acak|ecek|mak|mek|ydi|ydu)$/u;

/** Unvan/rol ipuçları (026 §6.4 b), katlanmış ve noktasız. */
export const PERSON_HINTS: ReadonlySet<string> = new Set([
  'sayin',
  'bay',
  'bayan',
  'sn',
  'av',
  'avukat',
  'dr',
  'prof',
  'doc',
  'muvekkil',
  'davaci',
  'davali',
  'vekili',
  'sanik',
  'supheli',
  'magdur',
  'musteki',
  'tanik',
  'katilan',
  'ilgili',
  'borclu',
  'alacakli',
  'kefil',
  'mirasci',
]);

/** Satır başı etiketleri (026 §6.4 c). */
const LINE_LABELS: ReadonlySet<string> = new Set([
  'davaci',
  'davali',
  'vekili',
  'sanik',
  'supheli',
  'musteki',
  'katilan',
  'tanik',
  'borclu',
  'alacakli',
]);

const key = (w: Word): string => foldChars(w.body).replace(/\./gu, '');

export function isGivenName(word: string): boolean {
  return GIVEN.has(foldChars(word));
}

function isHint(w: Word): boolean {
  return PERSON_HINTS.has(key(w));
}

/** Konum/kurum durdurması: il adı (verilen ad değilse), kısaltma, LEGAL_TERMS kökü. */
function isStop(w: Word): boolean {
  const k = key(w);
  if (ACRONYM.has(k)) return true;
  if (PROVINCE.has(k) && !GIVEN.has(k)) return true;
  return isLegalTermWord(w.body, { calendar: false });
}

/** Ad dizisini bitiren sözcük: kesmeli ek veya cümle sonu noktası (ipucu kısaltmaları hariç). */
function isTerminal(w: Word): boolean {
  if (w.suffix !== '') return true;
  return w.shape !== 'INITIAL' && w.text.endsWith('.') && !isHint(w);
}

function gapIsSingleSpace(scan: ScanText, a: Word, b: Word): boolean {
  return b.start === a.end + 1 && scan.orig.charAt(a.end) === ' ';
}

/** Ipucu ile ad arasında ' ' veya ': ' / ' : ' (aynı satır). */
function gapIsHintGap(scan: ScanText, a: Word, b: Word): boolean {
  const gap = scan.orig.slice(a.end, b.start);
  return gap === ' ' || gap === ': ' || gap === ' : ' || gap === ', ';
}

function atLineStart(scan: ScanText, w: Word): boolean {
  return w.start === 0 || scan.orig.charAt(w.start - 1) === '\n';
}

function countNonInitial(ws: readonly Word[]): number {
  return ws.filter((w) => w.shape !== 'INITIAL').length;
}

/** Sağdan/soldan kırpma; kalan < 2 (INITIAL hariç) ise null. */
function trim(ws: Word[]): Word[] | null {
  let a = 0;
  let b = ws.length;
  while (a < b) {
    const w = ws[a] as Word;
    if (isHint(w) || isLegalTermWord(w.body)) a += 1;
    else break;
  }
  while (b > a) {
    const w = ws[b - 1] as Word;
    if (isLegalTermWord(w.body, { calendar: false }) || isHint(w)) b -= 1;
    else break;
  }
  const out = ws.slice(a, b);
  // INITIAL yalnız başta/ortada; sonda INITIAL kalmaz.
  while (out.length > 0 && out[out.length - 1]?.shape === 'INITIAL') out.pop();
  if (out.filter((w) => w.shape === 'INITIAL').length > 2) return null;
  if (countNonInitial(out) < 2) return null;
  return out;
}

function toCandidate(scan: ScanText, ws: readonly Word[], reorderedIdentity?: string): Candidate {
  const first = ws[0] as Word;
  const last = ws[ws.length - 1] as Word;
  const [start, end] = scanToNfc(scan, first.start, last.bodyEnd);
  const c: Candidate = {
    start,
    end,
    tip: 'KISI',
    source: 'heuristic',
    confidence: 'medium',
    priority: PRIORITY.KISI,
    learnable: { words: ws.map((w) => w.body) },
  };
  if (last.suffix.length > 1) {
    const [ss, se] = scanToNfc(scan, last.bodyEnd, last.end);
    c.suffix = { start: ss, end: se };
  }
  // Görünen değer ÖZGÜN (NFC) metinden alınır: geri çözme, homoglif/biçim karakterli yazımı bayt eşit korur.
  const [ds, de] = scanToNfc(scan, first.start, last.bodyEnd);
  const sliced = scan.src !== undefined ? scan.src.slice(ds, de) : '';
  const joined = ws.map((w) => w.body).join(' ');
  const text = sliced !== '' && !/[\n\r]/u.test(sliced) ? sliced : joined;
  const display = isAllUpper(text) ? trTitle(text) : text;
  if (reorderedIdentity !== undefined) {
    c.identitySurface = reorderedIdentity;
    c.displaySurface = isAllUpper(reorderedIdentity)
      ? trTitle(reorderedIdentity)
      : reorderedIdentity;
  } else {
    c.displaySurface = display;
  }
  return c;
}

export interface PersonOptions {
  nameMaxWords: number;
}

const SURNAME_TAIL = /(?:oglu|zade|soy|gil|tas|han|kaya|can)$/u;
/** Çekim ekiyle biten (yer/ayrılma/ilgi/çoğul) sözcük soyadı sayılmaz (yalnız tam küçük harf dizisinde). */
const INFLECTED_TAIL =
  /(?:da|de|ta|te|dan|den|tan|ten|la|le|yla|yle|nin|nun|nin|nun|lar|ler|ya|ye|na|ne)$/u;

function relaxedSurname(w: Word, lowerRun: boolean): boolean {
  const k = key(w);
  if (k.length < 3 || !/^\p{L}+$/u.test(k)) return false;
  if (NOT_SURNAME.has(k) || VERB_TAIL.test(k)) return false;
  if (isHint(w) || isStop(w)) return false;
  // Soyadı gibi duran: bilinen ad/yaygın soyad sözcüğü veya soyadı kuyruğu (her büyük/küçük harfte).
  if (GIVEN.has(k) || COMMON.has(k) || SURNAME_TAIL.test(k)) return true;
  // Tam küçük harfli koşuda (kasıtlı küçük harf yazımı) bilinmeyen soyadı da yakalanır; çekimli sözcükler değil.
  return lowerRun && k.length >= 4 && !INFLECTED_TAIL.test(k);
}

export function detectPersons(scan: ScanText, opts: PersonOptions): Candidate[] {
  const words = tokenizeWords(scan.orig);
  const out: Candidate[] = [];
  const used = new Uint8Array(words.length);
  const max = opts.nameMaxWords;
  const covered = new Uint8Array(words.length);
  const wordIndex = new Map<number, number>();
  words.forEach((w, idx) => {
    wordIndex.set(w.start, idx);
  });
  const mark = (ws: readonly Word[]): void => {
    for (const w of ws) {
      const idx = wordIndex.get(w.start);
      if (idx !== undefined) covered[idx] = 1;
    }
  };

  // (d) "SOYAD, Ad" mahkeme yazımı.
  for (let i = 0; i + 1 < words.length; i += 1) {
    const w = words[i] as Word;
    const n = words[i + 1] as Word;
    if (w.shape !== 'UPPER' || isTerminal(w) || isStop(w)) continue;
    if (scan.orig.slice(w.end, n.start) !== ', ') continue;
    if (n.shape !== 'TITLE' || !GIVEN.has(key(n))) continue;
    const given: Word[] = [n];
    for (let j = i + 2; j < words.length && given.length < max - 1; j += 1) {
      const g = words[j] as Word;
      const prev = given[given.length - 1] as Word;
      if (isTerminal(prev) || !gapIsSingleSpace(scan, prev, g)) break;
      if (g.shape !== 'TITLE' || !GIVEN.has(key(g))) break;
      given.push(g);
    }
    const seq = [w, ...given];
    const reordered = `${given.map((g) => g.body).join(' ')} ${w.body}`;
    out.push(toCandidate(scan, seq, reordered));
    mark(seq);
    for (let k = i; k < i + seq.length; k += 1) used[k] = 1;
  }

  let i = 0;
  while (i < words.length) {
    // Ad biçimli ardışık sözcük koşusu (tek boşlukla, satır sonu yok).
    if (!isNameShape((words[i] as Word).shape) || used[i]) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < words.length) {
      const prev = words[j - 1] as Word;
      const cur = words[j] as Word;
      if (isTerminal(prev) || used[j] || !isNameShape(cur.shape)) break;
      if (!gapIsSingleSpace(scan, prev, cur)) break;
      j += 1;
    }
    const run = words.slice(i, j);
    const before = i > 0 ? (words[i - 1] as Word) : null;
    const hintBefore =
      before !== null && isHint(before) && gapIsHintGap(scan, before, run[0] as Word);
    const labelBefore =
      before !== null &&
      atLineStart(scan, before) &&
      LINE_LABELS.has(key(before)) &&
      /^ {0,2}[:-] {0,2}$/u.test(scan.orig.slice(before.end, (run[0] as Word).start));
    let p = 0;
    while (p < run.length) {
      const w = run[p] as Word;
      const prevInRun = p > 0 ? (run[p - 1] as Word) : null;
      const hinted =
        (p === 0 && (hintBefore || labelBefore)) || (prevInRun !== null && isHint(prevInRun));
      const gazetteer = w.shape !== 'INITIAL' && GIVEN.has(key(w));
      if (
        !hinted &&
        !gazetteer &&
        !(w.shape === 'INITIAL' && prevInRun !== null && isHint(prevInRun))
      ) {
        p += 1;
        continue;
      }
      if (isHint(w) || isStop(w)) {
        p += 1;
        continue;
      }
      const limit = hinted && !gazetteer ? Math.min(3, max) : max;
      const seq: Word[] = [];
      for (let q = p; q < run.length && seq.length < limit; q += 1) {
        const cand = run[q] as Word;
        if (q > p && (isStop(cand) || isHint(cand))) break;
        seq.push(cand);
        if (isTerminal(cand)) break;
      }
      const trimmed = trim(seq);
      if (trimmed) {
        out.push(toCandidate(scan, trimmed));
        mark(trimmed);
        p += seq.length;
      } else {
        p += 1;
      }
    }
    i = j;
  }

  // (f) Büyük/küçük harf duyarsız geçiş: verilen ad sözlüğünde olan sözcük + soyadı gibi duran sözcük(ler).
  // "ahmet yılmaz", "ahmet Yılmaz", "ahmet yilmaz" biçimleri (kasıtlı küçük harfle atlatma dahil).
  // Genel kelime olarak da kullanılan ad (can, deniz ...) küçük harfle tek başına ad sayılmaz.
  for (let a = 0; a + 1 < words.length; a += 1) {
    const w = words[a] as Word;
    if (covered[a] === 1 || isTerminal(w) || w.shape === 'INITIAL') continue;
    const k = key(w);
    if (!GIVEN.has(k) || isStop(w) || isHint(w)) continue;
    if (COMMON.has(k) && w.shape !== 'TITLE' && w.shape !== 'UPPER') continue;
    const lowerRun = w.shape === 'OTHER' && w.body === trLower(w.body);
    const seq: Word[] = [w];
    for (let b = a + 1; b < words.length && seq.length < max; b += 1) {
      const prev = seq[seq.length - 1] as Word;
      const cur = words[b] as Word;
      if (covered[b] === 1 || isTerminal(prev) || !gapIsSingleSpace(scan, prev, cur)) break;
      if (!relaxedSurname(cur, lowerRun && cur.body === trLower(cur.body))) break;
      seq.push(cur);
    }
    if (seq.length < 2) continue;
    out.push(toCandidate(scan, seq));
    mark(seq);
    a += seq.length - 1;
  }
  return out;
}
