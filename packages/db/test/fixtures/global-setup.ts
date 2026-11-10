// DB test projesinin globalSetup'ı (032 §12): PostgreSQL eda_owner ile erişilebilir olana dek bekler.
// migrate'in boş veritabanında koşup çıkış 0 verdiği test-db.sh'ta doğrulanmıştır (KK-P03a-4).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

export default async function setup(project: TestProject): Promise<void> {
  const target = project.config.provide.pg;
  const password = readFileSync(
    fileURLToPath(new URL('../../../../infra/secrets/dev/pg_owner_password', import.meta.url)),
    'utf8',
  ).trim();
  const deadline = Date.now() + 60_000;
  for (;;) {
    const client = new pg.Client({ ...target, user: 'eda_owner', password });
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (err) {
      await client.end().catch(() => undefined);
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
