// Nesne deposu portu (033 §3, §6.2, §10.2): api/worker bu arayüzü kullanır; gerçek adaptör `client.ts`,
// testler `memory.ts` sahte deposunu kullanır. Presigned URL ve nesne listeleme bu arayüzde YOKTUR
// (033 D1: tarayıcı objstore'a erişmez; listeleme yalnız `orphans.sweep`).
import type { Readable } from 'node:stream';

export const OBJECT_STORE_ERROR_KINDS = ['not_found', 'unavailable'] as const;
export type ObjectStoreErrorKind = (typeof OBJECT_STORE_ERROR_KINDS)[number];

/** Depo hatası: nesne anahtarı ve sağlayıcı ayrıntısı İÇERMEZ (iç ayrıntı sızmaz). */
export class ObjectStoreError extends Error {
  override name = 'ObjectStoreError';
  readonly kind: ObjectStoreErrorKind;

  constructor(kind: ObjectStoreErrorKind) {
    super(kind === 'not_found' ? 'nesne bulunamadı' : 'nesne deposu kullanılamıyor');
    this.kind = kind;
  }
}

export interface ObjectRange {
  /** Dahil. */
  readonly start: number;
  /** Dahil. */
  readonly end: number;
}

export interface ObjectStore {
  /**
   * Akışı tek nesne olarak yazar. Parça boyutundan büyükse çok parçalı yükleme (sıralı, tek parça
   * bellekte); hata veya kesintide yarım yükleme iptal edilir. Yazılan bayt sayısını döner.
   */
  put(key: string, source: AsyncIterable<Uint8Array>): Promise<{ size: number }>;
  /** Nesne gövdesi; `range` verilirse yalnız o bayt aralığı. Yoksa `ObjectStoreError('not_found')`. */
  get(key: string, range?: ObjectRange): Promise<Readable>;
  /** Boyut; nesne yoksa `null`. */
  head(key: string): Promise<{ size: number } | null>;
  /** Yoksa da başarılıdır (idempotent). */
  delete(key: string): Promise<void>;
  /** Sunucu tarafı kopya (baytlar yeniden şifrelenmez; 033 §9). */
  copy(fromKey: string, toKey: string): Promise<void>;
}
