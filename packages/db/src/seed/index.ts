// Seed çalıştırıcısı (032 §10.1): `runSeed` migrate'in son adımında (bin/migrate.ts) ve `bin/seed.ts`
// ile tek başına koşar. Her seed kendi işleminde yazar ve `public.seed_runs`'a (seed_name, profile,
// content_sha256, inserted, updated, skipped, duration_ms) satır ekler; içerik özeti son kayıtla aynıysa
// atlanır (`--force` yeniden uygular; değişmeyen satırlar bayt düzeyinde aynı kalır). `--dry-run`
// işlemi geri alır. Dış çağrı yoktur. Doğrulanmış kuralın taslağı değişmişse çıkış 41; diğer seed
// hataları çıkış 40. Günlükte yalnız seed adı ve sayılar bulunur.
import { createHash } from 'node:crypto';
import type { EdaEnv } from '@eda/contracts/config/env';
import type { ClientBase } from 'pg';
import { canonicalJson } from '../audit/merkle.ts';
import { EXIT, MigrateError } from '../migrate/exit-codes.ts';
import { ledgerSchemaIdent } from '../migrate/ledger.ts';
import { type MigrateLogger, pgErrorFields } from '../migrate/log.ts';
import { devBaseSeed, devFixtureRulesSeed } from './dev/dev-base.ts';
import { type DevSampleSecrets, devSampleIdentitySeed } from './dev/dev-sample-identity.ts';
import {
  caseTypesSeed,
  deadlineRulesSeed,
  holidaysSeed,
  judicialRecessesSeed,
} from './prod/catalogs.ts';
import { featureFlagsSeed, plansSeed, sourceStatusSeed } from './prod/platform.ts';
import { devStagesFor, type SeedProfile } from './profile.ts';
import type { SeedDef } from './types.ts';
import type { SeedCounts } from './upsert.ts';

export type { DevSampleSecrets } from './dev/dev-sample-identity.ts';
export { type DevStage, devStagesFor, profileGateViolated, type SeedProfile } from './profile.ts';
export type { SeedDef } from './types.ts';

/**
 * Kayıt defteri: prod seed'leri (her profil) + dev aşamaları. Sıra bağımlılık sırasıdır. Dev örnek
 * dünyasının sır dosyası yolları migrate env'inden (`DEV_SEED_PASSWORD_FILE`, `KEK_MASTER_FILE`) gelir.
 */
export function defaultSeeds(devSecrets: DevSampleSecrets = {}): SeedDef[] {
  return [
    plansSeed(),
    featureFlagsSeed(),
    sourceStatusSeed(),
    caseTypesSeed(),
    holidaysSeed(),
    judicialRecessesSeed(),
    deadlineRulesSeed(),
    devBaseSeed(),
    devFixtureRulesSeed(),
    devSampleIdentitySeed(devSecrets),
  ];
}

export type SeedStatus = 'applied' | 'skipped' | 'dry_run';

export interface SeedOutcome extends SeedCounts {
  readonly name: string;
  readonly status: SeedStatus;
}

export interface RunSeedOptions {
  readonly client: ClientBase;
  readonly profile: SeedProfile;
  readonly edaEnv: EdaEnv;
  readonly log: MigrateLogger;
  readonly only?: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
  /** Test: seed listesi ve defter şeması. */
  readonly seeds?: readonly SeedDef[];
  readonly ledgerSchema?: string;
}

export function contentSha256(seed: Pick<SeedDef, 'name' | 'content'>): Buffer {
  return createHash('sha256')
    .update(canonicalJson({ seed: seed.name, content: seed.content }), 'utf8')
    .digest();
}

/** Profil ve ortama göre çalışacak seed'ler (prod seed'leri + izinli dev aşamaları). */
export function seedsFor(
  profile: SeedProfile,
  edaEnv: EdaEnv,
  seeds: readonly SeedDef[] = defaultSeeds(),
): SeedDef[] {
  const stages = new Set<string>(devStagesFor(profile, edaEnv));
  return seeds.filter((s) => s.stage === 'prod' || stages.has(s.stage));
}

async function lastDigest(
  client: ClientBase,
  schema: string,
  name: string,
  profile: SeedProfile,
): Promise<Buffer | undefined> {
  const r = await client.query<{ content_sha256: Buffer }>(
    `SELECT content_sha256 FROM ${schema}.seed_runs WHERE seed_name = $1 AND profile = $2
     ORDER BY id DESC LIMIT 1`,
    [name, profile],
  );
  return r.rows[0]?.content_sha256;
}

/** Tüm seed'leri sırayla uygular; her biri için sonucu döner. Hata MigrateError (40/41) fırlatır. */
export async function runSeed(opts: RunSeedOptions): Promise<SeedOutcome[]> {
  const { client, profile, edaEnv, log } = opts;
  const schema = ledgerSchemaIdent(opts.ledgerSchema ?? 'public');
  const selected = seedsFor(profile, edaEnv, opts.seeds ?? defaultSeeds()).filter(
    (s) => opts.only === undefined || s.name === opts.only,
  );
  if (opts.only !== undefined && selected.length === 0) {
    throw new MigrateError(EXIT.seed, `seed bulunamadı veya bu profilde çalışmaz: ${opts.only}`);
  }
  const outcomes: SeedOutcome[] = [];
  for (const seed of selected) {
    const started = Date.now();
    const digest = contentSha256(seed);
    const previous = await lastDigest(client, schema, seed.name, profile);
    if (!opts.force && !opts.dryRun && previous?.equals(digest)) {
      log.write({ level: 'info', event: 'seed.skipped', id: seed.name, reason: 'unchanged' });
      outcomes.push({ name: seed.name, status: 'skipped', inserted: 0, updated: 0, skipped: 0 });
      continue;
    }
    await client.query('BEGIN');
    let counts: SeedCounts;
    try {
      counts = await seed.apply(client);
      const ms = Date.now() - started;
      if (opts.dryRun) {
        await client.query('ROLLBACK');
      } else {
        await client.query(
          `INSERT INTO ${schema}.seed_runs
             (seed_name, profile, content_sha256, inserted, updated, skipped, duration_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [seed.name, profile, digest, counts.inserted, counts.updated, counts.skipped, ms],
        );
        await client.query('COMMIT');
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      log.write({ level: 'error', event: 'seed.failed', id: seed.name, ...pgErrorFields(err) });
      if (err instanceof MigrateError) throw err;
      throw new MigrateError(EXIT.seed, `seed başarısız: ${seed.name}`);
    }
    log.write({
      level: 'info',
      event: opts.dryRun ? 'seed.dry_run' : 'seed.applied',
      id: seed.name,
      inserted: counts.inserted,
      updated: counts.updated,
      skipped: counts.skipped,
      ms: Date.now() - started,
    });
    outcomes.push({ name: seed.name, status: opts.dryRun ? 'dry_run' : 'applied', ...counts });
  }
  return outcomes;
}
