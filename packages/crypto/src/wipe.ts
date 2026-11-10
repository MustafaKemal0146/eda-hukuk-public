// Anahtar tamponlarını iş bitince sıfırlar (en iyi çaba; GC kopyaları için garanti yoktur, 033 §4.5).
export function wipe(...buffers: ReadonlyArray<Uint8Array | null | undefined>): void {
  for (const b of buffers) b?.fill(0);
}
