// Sentetik Türkçe metin (032 §12): gerçek kişi, büro, künye, madde veya süre YOK. Her dize "Örnek
// veri" ibaresi taşır; katlanmış (`*_fold`) karşılıklar ASCII küçük harf olarak elle verilir (test
// verisi; uygulama katlaması @eda/legal text modülündedir).

export interface SyntheticTitle {
  readonly text: string;
  readonly fold: string;
}

const TITLES: readonly SyntheticTitle[] = [
  { text: 'Örnek veri alacak davası', fold: 'ornek veri alacak davasi' },
  { text: 'Örnek veri kira uyuşmazlığı', fold: 'ornek veri kira uyusmazligi' },
  { text: 'Örnek veri iş davası', fold: 'ornek veri is davasi' },
  { text: 'Örnek veri tespit dosyası', fold: 'ornek veri tespit dosyasi' },
  { text: 'Örnek veri icra takibi', fold: 'ornek veri icra takibi' },
];

/** Sıra numarasına göre döngüsel sentetik başlık (deterministik). */
export function syntheticTitle(seq: number): SyntheticTitle {
  return TITLES[Math.abs(seq) % TITLES.length] ?? { text: 'Örnek veri', fold: 'ornek veri' };
}

/** Sentetik mesaj gövdesi (UI mesaj parçası biçimi; içerik anlamsızdır). */
export function syntheticParts(seq: number): string {
  return JSON.stringify([{ type: 'text', text: `Örnek veri mesaj ${seq}` }]);
}

/** Sentetik evrak parçası metni. */
export function syntheticChunk(seq: number): SyntheticTitle {
  return { text: `Örnek veri evrak parçası ${seq}`, fold: `ornek veri evrak parcasi ${seq}` };
}
