// İki proje: `unit` (ağsız; turbo `test`) ve `db` (gerçek PostgreSQL; `test:db`, make test içinde
// infra/scripts/dev/test-db.sh TEST yığınında koşturur). DB testleri sıralı koşar: denetim sorguları
// (Q/E) tüm kümeyi taradığı için başka dosyanın geçici nesnesini görmemelidir.
import { defineConfig } from 'vitest/config';

const DB_TESTS = [
  'test/roles/**/*.test.ts',
  'test/schema/auth.test.ts',
  'test/schema/live-schema.test.ts',
  'test/schema/canon.test.ts',
  'test/schema/constraints.test.ts',
  'test/rls/**/*.test.ts',
  'test/audit/**/*.test.ts',
  'test/tenant/**/*.test.ts',
  'test/migrate/runner.test.ts',
  'test/migrate/backfill.test.ts',
  'test/migrate/preflight.test.ts',
  'test/migrate/audit-extra.test.ts',
  'test/seed/seed.test.ts',
  'test/seed/dev-sample.test.ts',
  'test/perf/**/*.test.ts',
  'test/email/**/*.test.ts',
  'test/schema/corpus-retrieval.test.ts',
  'test/seats/**/*.test.ts',
];

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['**/node_modules/**', ...DB_TESTS],
          testTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          include: DB_TESTS,
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
          globalSetup: ['test/fixtures/global-setup.ts'],
          provide: {
            pg: {
              host: process.env.PG_HOST ?? 'postgres',
              port: Number(process.env.PG_PORT ?? '5432'),
              database: process.env.PG_DATABASE ?? 'eda',
            },
          },
        },
      },
    ],
  },
});
