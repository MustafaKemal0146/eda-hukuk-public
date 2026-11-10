// ADRES algılayıcısı (026 §6.3): anahtar sözcük kümeleme + sabit pencere. Kabul: (anahtar + sayı öğesi)
// VEYA (>= 2 farklı anahtar) VEYA (anahtar + İlçe/İl çifti). "cadde ve sokaklarda ..." gibi genel hukuki
// kullanım dışlanır.
import { PROVINCES } from '../data/provinces.tr.ts';
import { Automaton } from '../dictionary/compile.ts';
import { foldChars, isTrUpper, isWordChar } from '../fold.ts';
import { type ScanText, scanToNfc } from '../normalize.ts';
import { type Candidate, PRIORITY } from './candidate.ts';
import { isLegalTermWord } from './legal-terms.ts';

/** 026 §6.3 anahtar sözcükleri (katlanmış) + yaygın çekimli biçimler. */
export const ADDRESS_KEYWORDS: readonly string[] = [
  'mahallesi',
  'mah.',
  'sokak',
  'sok.',
  'sk.',
  'cadde',
  'cad.',
  'cd.',
  'bulvari',
  'bulv.',
  'apartmani',
  'apt.',
  'blok',
  'site',
  'sitesi',
  'koyu',
  'mevkii',
  'kat:',
  'no:',
  'daire:',
  'd:',
  'caddesi',
  'sokagi',
];

const AUTOMATON = new Automaton(ADDRESS_KEYWORDS);
const PROVINCE = new Set(PROVINCES.map((p) => foldChars(p)));
const CLUSTER_GAP = 60;
const LEFT_MAX_WORDS = 4;
const RIGHT_MAX_TOKENS = 12;

interface Hit {
  start: number;
  end: number;
  kw: number;
}

function keywordHits(f: string): Hit[] {
  const hits: Hit[] = [];
  AUTOMATON.scan(f, (s, e, kw) => {
    if (s > 0 && isWordChar(f.charAt(s - 1))) return;
    const last = f.charAt(e - 1);
    if (last !== '.' && last !== ':' && e < f.length && isWordChar(f.charAt(e))) return;
    hits.push({ start: s, end: e, kw });
  });
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Hit[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.start < last.end) continue;
    out.push(h);
  }
  return out;
}

const NUMBER = /^\d{1,5}[A-Za-z]?[.,]?$/u;
const DOOR = /^[Dd]\.\d{1,4}[.,]?$/u;

function isNumberToken(t: string): boolean {
  return NUMBER.test(t) || DOOR.test(t);
}

function isProvincePair(t: string): boolean {
  const slash = t.indexOf('/');
  if (slash <= 0) return false;
  const right = foldChars(t.slice(slash + 1)).replace(/[.,;]{1,3}$/u, '');
  return PROVINCE.has(right);
}

function isProvinceWord(t: string): boolean {
  return PROVINCE.has(foldChars(t).replace(/[.,;]{1,3}$/u, ''));
}

interface Tok {
  start: number;
  end: number;
  text: string;
}

function tokensAfter(orig: string, pos: number, limit: number): Tok[] {
  const out: Tok[] = [];
  let i = pos;
  while (i < orig.length && out.length < RIGHT_MAX_TOKENS && i - pos <= limit) {
    const ch = orig.charAt(i);
    if (ch === '\n') break;
    if (ch === ' ') {
      i += 1;
      continue;
    }
    let j = i;
    while (j < orig.length && orig.charAt(j) !== ' ' && orig.charAt(j) !== '\n') j += 1;
    out.push({ start: i, end: j, text: orig.slice(i, j) });
    i = j;
  }
  return out;
}

export function detectAddresses(scan: ScanText, opts: { addressMaxChars: number }): Candidate[] {
  const f = scan.fold;
  const o = scan.orig;
  const hits = keywordHits(f);
  const hitAt = new Map<number, Hit>(hits.map((x) => [x.start, x] as const));
  const out: Candidate[] = [];
  let h = 0;
  while (h < hits.length) {
    // Aynı satırda 60 karakter içindeki isabetleri kümele.
    const first = hits[h] as Hit;
    let lastHit = first;
    const kws = new Set<number>([first.kw]);
    let k = h + 1;
    while (k < hits.length) {
      const nx = hits[k] as Hit;
      if (nx.start - lastHit.end > CLUSTER_GAP || o.slice(lastHit.end, nx.start).includes('\n'))
        break;
      lastHit = nx;
      kws.add(nx.kw);
      k += 1;
    }
    h = k;
    let start = first.start;
    // Sola en çok 4 Title/BÜYÜK sözcük veya sayı (anahtara bitişik ad: "Gül Sokak", "1453. Sokak").
    for (let n = 0; n < LEFT_MAX_WORDS; n += 1) {
      if (start < 2 || o.charAt(start - 1) !== ' ') break;
      let s = start - 1;
      while (s > 0 && o.charAt(s - 1) !== ' ' && o.charAt(s - 1) !== '\n') s -= 1;
      const w = o.slice(s, start - 1);
      if (w.length === 0 || /[,;:)(]/u.test(w)) break;
      // Nokta ile biten sözcük (cümle sonu, unvan kısaltması) sola genişlemeyi durdurur; "1453." hariç.
      if (w.endsWith('.') && !/^\d{1,5}\.$/u.test(w)) break;
      if (!(isTrUpper(w.charAt(0)) || /^\d{1,5}\.?$/u.test(w)) || isLegalTermWord(w)) break;
      start = s;
    }
    let end = lastHit.end;
    let numbers = 0;
    let pair = false;
    // Küme içindeki sayılar.
    for (const t of tokensAfter(o, first.start, lastHit.end - first.start)) {
      if (t.end > lastHit.end) break;
      if (isNumberToken(t.text)) numbers += 1;
      if (isProvincePair(t.text)) pair = true;
    }
    let prevProvinceCandidate = false;
    for (const t of tokensAfter(o, lastHit.end, opts.addressMaxChars)) {
      if (t.end - start > opts.addressMaxChars) break;
      const prevChar = o.charAt(t.start - 2);
      // Cümle sonu: nokta + boşluk + Büyük harf (sayıdan sonraki nokta dahil).
      const kwHit = hitAt.get(t.start);
      if (prevChar === '.' && isTrUpper(t.text.charAt(0)) && !/^[Dd]\./u.test(t.text) && !kwHit) {
        break;
      }
      if (kwHit) {
        kws.add(kwHit.kw);
        end = t.end;
        continue;
      }
      if (isNumberToken(t.text) || /^\d{5}$/u.test(t.text)) {
        numbers += 1;
        end = t.end;
        continue;
      }
      if (isProvincePair(t.text)) {
        pair = true;
        end = t.end;
        continue;
      }
      if (isTrUpper(t.text.charAt(0)) && !isLegalTermWord(t.text)) {
        if (prevProvinceCandidate && isProvinceWord(t.text)) pair = true;
        prevProvinceCandidate = true;
        end = t.end;
        continue;
      }
      if (/^[,/-]$/u.test(t.text)) continue;
      break;
    }
    if (!(numbers > 0 || kws.size >= 2 || pair)) continue;
    // Sondaki noktalama atılır.
    while (end > start && /[,;:.\-/]/u.test(o.charAt(end - 1))) {
      const tail = o.slice(Math.max(start, end - 4), end);
      if (/(?:mah|sok|sk|cad|cd|bulv|apt)\.$/u.test(foldChars(tail))) break;
      end -= 1;
    }
    if (end - start > opts.addressMaxChars) end = start + opts.addressMaxChars;
    const [ns, ne] = scanToNfc(scan, start, end);
    out.push({
      start: ns,
      end: ne,
      tip: 'ADRES',
      source: 'heuristic',
      confidence: 'medium',
      priority: PRIORITY.ADRES,
    });
  }
  return out;
}
