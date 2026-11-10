// Ön işleme (026 §2): NFC + ofset haritası, uzunluk koruyan katlama, sıfır genişlikli karakter atlama ve
// boşluk dizisi daraltma. Algılayıcılar `ScanText` üzerinde çalışır; aralıklar NFC ofsetine döner.
import { compatBase, confusableMask, homoglyphOf } from './compat.ts';
import { foldChars, isIgnorableCode, isIgnorableCodePoint, isWhitespaceCode } from './fold.ts';

export interface NormText {
  /** NFC metin (maskeli çıktı bunun üzerinden yazılır). */
  orig: string;
  /** `orig` ile aynı uzunlukta katlanmış metin. */
  fold: string;
  /** NFC ofseti -> ham girdi ofseti (metin değişmediyse yok); uzunluk orig.length + 1. */
  map?: Uint32Array;
}

const SEGMENT = /\P{M}\p{M}{0,32}|\p{M}{1,32}/gu;

/** NFC'ye getirir; değiştiyse NFC -> ham ofset haritası üretir (birleşen dizi başına). */
export function normalizeText(raw: string): NormText {
  const nfc = raw.normalize('NFC');
  if (nfc === raw) return { orig: raw, fold: foldChars(raw) };
  const pieces: string[] = [];
  const starts: number[] = [];
  for (const m of raw.matchAll(SEGMENT)) {
    pieces.push(m[0].normalize('NFC'));
    starts.push(m.index);
  }
  const joined = pieces.join('');
  const map = new Uint32Array(nfc.length + 1);
  if (joined === nfc) {
    let j = 0;
    for (let p = 0; p < pieces.length; p += 1) {
      const piece = pieces[p] ?? '';
      const s = starts[p] ?? 0;
      for (let k = 0; k < piece.length; k += 1) map[j + k] = s;
      j += piece.length;
    }
    map[nfc.length] = raw.length;
  } else {
    // Parça parça NFC bütünle eşit değilse (nadir: Hangul jamo gibi) güvenli yön: tüm aralıklar
    // ham metnin tamamına eşlenir (eksik değil fazla kapsama).
    map.fill(0);
    map[nfc.length] = raw.length;
  }
  return { orig: nfc, fold: foldChars(nfc), map };
}

/** NFC aralığını ham girdi aralığına çevirir (gidiş-dönüş sınaması ve belge adaptörü için). */
export function toRawRange(n: NormText, start: number, end: number): [number, number] {
  if (!n.map) return [start, end];
  const s = n.map[start] ?? 0;
  let e = n.map[end] ?? n.map[n.map.length - 1] ?? 0;
  // Birleşen dizinin içinde biten aralık, dizinin sonuna kadar genişletilir.
  if (end < n.orig.length && (n.map[end - 1] ?? 0) === e) {
    let k = end;
    while (k < n.orig.length && (n.map[k] ?? 0) === e) k += 1;
    e = n.map[k] ?? e;
  }
  return [s, e];
}

/**
 * Tarama akışı: sıfır genişlikli karakterler atlanır, ardışık boşluklar tek sembole iner.
 * `fold`: katlanmış (boşluk ' '); `orig`: NFC karakterleri (boşluk koşusu satır sonu içeriyorsa '\n',
 * değilse ' '); `pos[k]`: k. tarama karakterinin NFC ofseti.
 */
/** Maskelenmiş/korunan aralık yer tutucusu (U+FFFC): harf/rakam ya da boşluk değildir. */
export const BLANK = '\uFFFC';

export interface ScanText {
  fold: string;
  orig: string;
  pos: Uint32Array;
  nfcLength: number;
  /** NFC kaynak metin: yüksek vekil (surrogate) ortasında kesilen aralığı tamamlamak için. */
  src?: string;
}

/** Tarama karakterinin (uyumluluk katlanmış, büyük/küçük harfi korunmuş) katlanmış karşılığı. */
function foldOut(ch: string): string {
  return foldChars(ch);
}

/**
 * Tarama görünümü (026 §2 + KK-026-27): her NFC karakteri uyumluluk katlamasından (NFKC, Unicode rakam ->
 * ASCII, ayraç benzerleri, karışık yazıda Kiril/Yunan homoglif -> Latin) geçer; görünmeyen biçim
 * karakterleri atılır; boşluk koşuları tek sembole iner. `pos[k]`: k. tarama karakterinin NFC ofseti
 * (indeks haritası; özgün metin DEĞİŞMEZ, maskeleme bu haritayla özgün aralığa döner).
 */
export function buildScan(n: NormText, blanked?: Uint8Array): ScanText {
  const src = n.orig;
  const fsrc = n.fold;
  // Çıktı en çok girdi uzunluğunun birkaç katı olabilir (NFKC genişlemesi); pos tamponu büyütülür.
  let pos = new Uint32Array(src.length + 1);
  let k = 0;
  const ensure = (extra: number): void => {
    if (k + extra + 1 > pos.length) {
      const bigger = new Uint32Array(Math.max(pos.length * 2, k + extra + 1));
      bigger.set(pos);
      pos = bigger;
    }
  };
  const foldParts: string[] = [];
  const origParts: string[] = [];
  const mixed = confusableMask(src);
  let fold = '';
  let orig = '';
  const flush = (): void => {
    foldParts.push(fold);
    origParts.push(orig);
    fold = '';
    orig = '';
  };
  const CHUNK = 4096;
  let i = 0;
  while (i < src.length) {
    const c = src.charCodeAt(i);
    if (blanked && blanked[i] === 1) {
      // Maskelenmiş/korunan aralık: harf/rakam olmayan nötr yer tutucu (sınır kuralı korunur).
      ensure(1);
      fold += BLANK;
      orig += BLANK;
      pos[k] = i;
      k += 1;
      i += 1;
    } else if (isIgnorableCode(c)) {
      i += 1;
    } else if (isWhitespaceCode(c)) {
      let newline = false;
      const start = i;
      while (i < src.length) {
        const d = src.charCodeAt(i);
        if (blanked && blanked[i] === 1) break;
        if (isWhitespaceCode(d)) {
          if (d === 0x0a || d === 0x0d || d === 0x0b || d === 0x0c || d === 0x85) newline = true;
          i += 1;
        } else if (isIgnorableCode(d)) {
          i += 1;
        } else break;
      }
      ensure(1);
      fold += ' ';
      orig += newline ? '\n' : ' ';
      pos[k] = start;
      k += 1;
    } else if (c < 0x80) {
      ensure(1);
      fold += fsrc.charAt(i);
      orig += src.charAt(i);
      pos[k] = i;
      k += 1;
      i += 1;
    } else {
      const cp = src.codePointAt(i) ?? c;
      const width = cp > 0xffff ? 2 : 1;
      if (isIgnorableCodePoint(cp)) {
        i += width;
      } else {
        const h = mixed !== null && mixed[i] === 1 ? homoglyphOf(cp) : undefined;
        const piece = h ?? compatBase(cp);
        // NFKC bazı karakterleri boşluğa çevirir (ör. U+2002 zaten boşluktur); tek sembol olarak yaz.
        ensure(piece.length);
        if (piece.length === width && piece === src.slice(i, i + width)) {
          // Değişmeyen karakter: önceden katlanmış metinden al.
          for (let w = 0; w < width; w += 1) {
            fold += fsrc.charAt(i + w);
            orig += src.charAt(i + w);
            pos[k] = i + w;
            k += 1;
          }
        } else {
          for (let w = 0; w < piece.length; w += 1) {
            const ch = piece.charAt(w);
            orig += ch;
            fold += foldOut(ch);
            pos[k] = i;
            k += 1;
          }
        }
        i += width;
      }
    }
    if (fold.length >= CHUNK) flush();
  }
  flush();
  ensure(1);
  pos[k] = src.length;
  return {
    fold: foldParts.join(''),
    orig: origParts.join(''),
    pos: pos.subarray(0, k + 1),
    nfcLength: src.length,
    src,
  };
}

/** Tarama aralığını [a, b) NFC aralığına çevirir. */
export function scanToNfc(scan: ScanText, a: number, b: number): [number, number] {
  const s = scan.pos[a] ?? scan.nfcLength;
  let e = b <= a ? s : (scan.pos[b - 1] ?? scan.nfcLength) + 1;
  // Aralık bir vekil çiftinin ortasında bitiyorsa çift tamamlanır (astral karakter bölünmez).
  const src = scan.src;
  if (src !== undefined && e > 0 && e < src.length) {
    const hi = src.charCodeAt(e - 1);
    const lo = src.charCodeAt(e);
    if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) e += 1;
  }
  return [s, e];
}
