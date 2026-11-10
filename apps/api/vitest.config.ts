// İki proje: `unit` (ağsız; `pnpm test`; @eda/config Node ön ayarını genişletir, entegrasyon dizinini
// her ortamda dışlar) ve `integration` (gerçek PG + Valkey; `pnpm test:int`; TEST yığınında
// infra/scripts/dev/test-db.sh koşturur). Havuz env'i (PG_*, PG_AUTH_*, PG_ADMIN_RO_*) test-db.sh'tan
// gelir; sırlar yalnız dosya yoludur.
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
          testTimeout: 120_000,
          hookTimeout: 60_000,
          provide: {
            pg: {
              host: process.env.PG_HOST ?? 'postgres',
              port: Number(process.env.PG_PORT ?? '5432'),
              database: process.env.PG_DATABASE ?? 'eda',
              secretsDir: process.env.EDA_TEST_SECRETS_DIR ?? '/workspace/infra/secrets/dev',
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
