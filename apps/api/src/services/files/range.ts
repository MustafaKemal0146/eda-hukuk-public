// Tek aralıklı `Range: bytes=…` ayrıştırıcı (033 §10.3): çoklu aralık yok sayılır (tam yanıt), geçersiz
// veya gövde dışı aralık `unsatisfiable` (416). Uçlar dahildir.
export type RangeSpec =
  | { readonly kind: 'none' }
  | { readonly kind: 'range'; readonly start: number; readonly end: number }
  | { readonly kind: 'unsatisfiable' };

export function parseRange(header: string | undefined, size: number): RangeSpec {
  if (header === undefined || header.trim() === '') return { kind: 'none' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Çoklu aralık ("a-b,c-d") veya bilinmeyen birim: yok sayılır, tam içerik verilir.
  if (m === null) return /^bytes=.*,/.test(header) ? { kind: 'none' } : { kind: 'unsatisfiable' };
  const [, from = '', to = ''] = m;
  if (from === '' && to === '') return { kind: 'unsatisfiable' };
  let start: number;
  let end: number;
  if (from === '') {
    // Sondan N bayt.
    const n = Number(to);
    if (!Number.isSafeInteger(n) || n <= 0) return { kind: 'unsatisfiable' };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    return { kind: 'unsatisfiable' };
  }
  return { kind: 'range', start, end };
}
