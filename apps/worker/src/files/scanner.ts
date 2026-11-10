// Virüs tarayıcı portu (033 §7.6): gerçek adaptör clamd INSTREAM (`clamd.ts`), testler sahte tarayıcı
// kullanır. Sonuç üç değerden biridir; altyapı hatası `ScannerUnavailableError` ile bildirilir ve
// evrak durumunu DEĞİŞTİRMEZ (fail-closed: taranmamış dosya işlenmez, indirilemez).
export type ScanResult =
  | { readonly status: 'clean' }
  /** İmza adı yalnız günlüğe gider (dosya adı değil); DB'ye yazılmaz. */
  | { readonly status: 'infected'; readonly signature: string };

export class ScannerUnavailableError extends Error {
  override name = 'ScannerUnavailableError';
  readonly reason: 'connect' | 'timeout' | 'protocol' | 'database_stale';
  constructor(reason: ScannerUnavailableError['reason']) {
    super(`virüs tarayıcı kullanılamıyor: ${reason}`);
    this.reason = reason;
  }
}

export interface VirusScanner {
  /** Düz metin akışını tarar; hata = `ScannerUnavailableError`. */
  scan(source: AsyncIterable<Uint8Array>): Promise<ScanResult>;
  /**
   * İmza veritabanı yaşı (gün). `files.clamavMaxDbAgeDays` aşımında yeni taramalar bekletilir
   * (fail-closed; 033 §7.6). Okunamazsa `ScannerUnavailableError`.
   */
  databaseAgeDays(now: Date): Promise<number>;
}
