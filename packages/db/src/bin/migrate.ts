// migrate servisinin girişi (032 §6; `node dist/bin/migrate.js`). Rol eda_owner; tek bağlantı.
// Akış ve çıkış kodları src/migrate/index.ts. Günlük JSON satırlarıdır ve SQL/parola içermez.
import { readFileSync } from 'node:fs';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { EnvOf } from '@eda/contracts/config/env';
import { load, seedProfileGateViolated } from '../config/load.ts';
import { connectOwner } from '../migrate/connect.ts';
import { EXIT, type ExitCode, type MigrateS3, runMigrate, stdoutLogger } from '../migrate/index.ts';
import { createS3Client } from '../s3/client.ts';

const readSecret = (path: string): string => readFileSync(path, 'utf8').replace(/\r?\n$/, '');

/** Kova adları üçü de verilmişse S3 bootstrap kurulur; aksi hâlde atlanır (günlükte görünür). */
function s3Of(env: EnvOf<'migrate'>): MigrateS3 | undefined {
  const { S3_BUCKET_FILES: files, S3_BUCKET_EXPORTS: exports, S3_BUCKET_AUDIT: audit } = env;
  if (files === undefined || exports === undefined || audit === undefined) return undefined;
  return {
    client: createS3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? 'tr-1',
      credentials: {
        accessKeyId: readSecret(env.S3_ADMIN_ACCESS_KEY_ID_FILE),
        secretAccessKey: readSecret(env.S3_ADMIN_SECRET_ACCESS_KEY_FILE),
      },
    }),
    config: {
      buckets: { files, exports, audit },
      exportsDays: CONFIG_DEFAULTS['retention.exportsDays'],
      auditLockYears: CONFIG_DEFAULTS['retention.auditLogYears'],
    },
  };
}

async function main(): Promise<ExitCode> {
  if (seedProfileGateViolated()) {
    stdoutLogger.write({ level: 'error', event: 'profile.gate', code: EXIT.profileGate });
    return EXIT.profileGate;
  }
  const env = load('migrate');
  const s3 = s3Of(env);
  const client = await connectOwner(env, stdoutLogger);
  if (client === undefined) return EXIT.preflight;
  try {
    return await runMigrate({
      client,
      edaEnv: env.EDA_ENV,
      log: stdoutLogger,
      ...(s3 === undefined ? {} : { s3 }),
      seed: {
        profile: env.SEED_PROFILE,
        devSecrets: { passwordFile: env.DEV_SEED_PASSWORD_FILE, kekFile: env.KEK_MASTER_FILE },
      },
    });
  } finally {
    await client.end().catch(() => undefined);
  }
}

process.exitCode = await main();
