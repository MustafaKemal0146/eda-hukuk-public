// İki proje: `unit` (ağsız; `pnpm test`; @eda/config Node ön ayarını genişletir, entegrasyon dizinini
// her ortamda dışlar) ve `integration` (gerçek Valkey; `pnpm test:int`; VALKEY_URL / VALKEY_USERNAME /
// VALKEY_PASSWORD_FILE ile TEST yığınında koşar).
import { defineConfig } from 'vitest/config';

const INTEGRATION = 'test/integration/**/*.test.ts';

export default defineConfig({
  test: {
    projects: [
      {
        extends: './node_modules/@eda/config/vitest/node.ts',
        test: { name: 'unit', exclude: ['**/node_modules/**', INTEGRATION] },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: [INTEGRATION],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Bağlantı hedefi testlere `inject('valkey')` ile verilir; parola yalnız dosya yoludur.
          provide: {
            // PG ve Mailpit hedefleri test-db.sh'tan (TEST yığını, data ağı); sırlar yalnız dosya yolu.
            pg: {
              host: process.env.PG_HOST ?? 'postgres',
              port: Number(process.env.PG_PORT ?? '5432'),
              database: process.env.PG_DATABASE ?? 'eda',
              secretsDir: process.env.EDA_TEST_SECRETS_DIR ?? '/workspace/infra/secrets/dev',
            },
            mailpit: {
              smtpUrl: process.env.SMTP_URL ?? 'smtp://mailpit:1025',
              apiUrl: process.env.MAILPIT_API_URL ?? 'http://mailpit:8025',
            },
            valkey: {
              url: process.env.VALKEY_URL ?? '',
              username: process.env.VALKEY_USERNAME ?? '',
              passwordFile: process.env.VALKEY_PASSWORD_FILE ?? '',
            },
          },
        },
      },
    ],
  },
});
