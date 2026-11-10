// İki proje: `unit` (ağsız; `pnpm test`; @eda/config Node ön ayarını genişletir, entegrasyon dizinini
// her ortamda dışlar) ve `integration` (gerçek valkey-cache ve ACL; `pnpm test:int`; TEST yığınında
// infra/scripts/dev/test-db.sh koşturur). Bağlantı hedefi testlere `inject('valkeyCache')` ile verilir;
// parolalar yalnız dosya yoludur.
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
          provide: {
            valkeyCache: {
              url: process.env.VALKEY_CACHE_URL ?? '',
              mcpPasswordFile: process.env.VALKEY_CACHE_MCP_PASSWORD_FILE ?? '',
              apiPasswordFile: process.env.VALKEY_CACHE_API_PASSWORD_FILE ?? '',
            },
          },
        },
      },
    ],
  },
});
