// Node ortamı Vitest ön ayarı: entegrasyon testleri yalnız EDA_ENV=test iken koşar (013 §10.1).
import { defineConfig } from 'vitest/config';

const integrationEnabled = process.env.EDA_ENV === 'test';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: integrationEnabled
      ? ['**/node_modules/**']
      : ['**/node_modules/**', 'test/integration/**'],
    passWithNoTests: false,
    // Push kancası tüm paketleri paralel koşar; CPU yoğun birim testleri 5 sn varsayılanını haksız aşıyordu.
    testTimeout: 20_000,
  },
});
