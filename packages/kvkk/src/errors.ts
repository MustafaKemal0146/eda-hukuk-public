// Maskeleme hata sınıfı (026 §12.2). Mesaj yalnız kod, segment kimliği ve sayı taşır; içerik, görünen
// değer veya istisna zinciri (cause) taşımaz (026 §7.6.4). Katman sınırında KVKK_MASKING_FAILED'e eşlenir.

export const KVKK_MASKING_ERROR_CODES = [
  'TOKEN_COLLISION',
  'DICTIONARY_UNAVAILABLE',
  'DETECTOR_FAILED',
  'VERIFY_FAILED',
  'INPUT_TOO_LARGE',
  'BUDGET_EXCEEDED',
  'INTERNAL',
] as const;
export type KvkkMaskingErrorCode = (typeof KVKK_MASKING_ERROR_CODES)[number];

export class KvkkMaskingError extends Error {
  readonly code: KvkkMaskingErrorCode;
  readonly segmentId: string | null;
  readonly count: number | null;

  constructor(code: KvkkMaskingErrorCode, detail: { segmentId?: string; count?: number } = {}) {
    const parts = [`kvkk maskeleme hatası: ${code}`];
    if (detail.segmentId !== undefined) parts.push(`segment=${detail.segmentId}`);
    if (detail.count !== undefined) parts.push(`sayı=${detail.count}`);
    super(parts.join(' '));
    this.name = 'KvkkMaskingError';
    this.code = code;
    this.segmentId = detail.segmentId ?? null;
    this.count = detail.count ?? null;
  }

  toJSON(): { name: string; code: KvkkMaskingErrorCode; segmentId: string | null } {
    return { name: this.name, code: this.code, segmentId: this.segmentId };
  }
}

/** Beklenmeyen istisnayı içerik taşımayan koda çevirir (fail-closed; kısmi çıktı yok). */
export function asMaskingError(
  e: unknown,
  fallback: KvkkMaskingErrorCode,
  segmentId?: string,
): KvkkMaskingError {
  if (e instanceof KvkkMaskingError) return e;
  return new KvkkMaskingError(fallback, segmentId === undefined ? {} : { segmentId });
}
