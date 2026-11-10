// Seed girişi (032 §10.1; `node dist/bin/seed.js`): `--profile prod|dev` (varsayılan SEED_PROFILE),
// `--only <seed_name>`, `--force`, `--dry-run`. migrate ile aynı danışma kilidini alır. Profil kapısı
// env doğrulamasından önce denetlenir: development/test dışında `dev` profili çıkış 60 (KK-032-14).
import { parseArgs } from 'node:util';
import { load, seedGateInputs } from '../config/load.ts';
import { connectOwner } from '../migrate/connect.ts';
import {
  ADVISORY_LOCK_KEY,
  DEFAULT_SETTINGS,
  EXIT,
  type ExitCode,
  MigrateError,
  stdoutLogger,
} from '../migrate/index.ts';
import { acquireAdvisoryLock, releaseAdvisoryLock } from '../migrate/runner.ts';
import { defaultSeeds, runSeed } from '../seed/index.ts';
import { parseEdaEnv, parseProfile, profileGateViolated } from '../seed/profile.ts';

async function main(): Promise<ExitCode> {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string' },
      only: { type: 'string' },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const raw = seedGateInputs();
  const rawProfile = values.profile ?? raw.profile;
  if (profileGateViolated(rawProfile, raw.edaEnv)) {
    stdoutLogger.write({ level: 'error', event: 'profile.gate', code: EXIT.profileGate });
    return EXIT.profileGate;
  }
  const env = load('migrate');
  const edaEnv = parseEdaEnv(env.EDA_ENV);
  const profile = parseProfile(rawProfile, edaEnv);
  const client = await connectOwner(env, stdoutLogger);
  if (client === undefined) return EXIT.preflight;
  let locked = false;
  try {
    await client.query("SET TIME ZONE 'UTC'");
    await acquireAdvisoryLock(
      {
        client,
        log: stdoutLogger,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        settings: DEFAULT_SETTINGS,
      },
      ADVISORY_LOCK_KEY,
      500,
    );
    locked = true;
    await runSeed({
      client,
      profile,
      edaEnv,
      log: stdoutLogger,
      force: values.force,
      dryRun: values['dry-run'],
      seeds: defaultSeeds({
        passwordFile: env.DEV_SEED_PASSWORD_FILE,
        kekFile: env.KEK_MASTER_FILE,
      }),
      ...(values.only !== undefined ? { only: values.only } : {}),
    });
    stdoutLogger.write({ level: 'info', event: 'seed.done', code: EXIT.ok });
    return EXIT.ok;
  } catch (err) {
    const code: ExitCode = err instanceof MigrateError ? err.code : EXIT.seed;
    stdoutLogger.write({
      level: 'error',
      event: 'seed.failed',
      code,
      ...(err instanceof MigrateError ? { reason: err.message } : {}),
    });
    return code;
  } finally {
    if (locked) await releaseAdvisoryLock(client, ADVISORY_LOCK_KEY).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

process.exitCode = await main();
