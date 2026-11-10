// DOM ortamı Vitest ön ayarı (happy-dom); Testing Library P05'te eklenir.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
    // Push kancası tüm paketleri paralel koşar; CPU yoğun birim testleri 5 sn varsayılanını haksız aşıyordu.
    testTimeout: 20_000,
  },
});
