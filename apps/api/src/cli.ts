// Tek seferlik yönetim komutları (042 §3.4; `docker compose run --rm api node dist/cli.js <komut>`).
// `approve-user --email <e> [--as <personel e-postası>]` (`make approve-user`); P27a:
// `create-staff --email <e> --name <ad> --role super_admin|support [--print-url]` ve
// `staff-reenroll --email <e> [--print-url]` ve `staff-promote --email <e> --role super_admin|support`
// (mevcut TOTP'li hesabı personel yapar). Kayıt bağlantısı yalnız `--print-url` ile (e-posta şablonu
// `staff_enrollment` P28'dedir) yazılır; başka çıktı e-posta/parola/belirteç içermez.

import { randomBytes } from 'node:crypto';
import { SECRET_FILE_VARS } from '@eda/contracts/config/env';
import { withNoTenant, withTenant, withUserScope } from '@eda/db';
import { createLogger } from '@eda/observability/logger';
import { ApproveUserError, approveUser } from './admin/approve-user.ts';
import { adminDbFromEnv, closeAdmin } from './admin/db.ts';
import { createAdminAuth } from './auth/admin-auth.ts';
import { appendAudit } from './auth/audit.ts';
import { defaultAuthDb, valkeyReplayGuard, valkeySecondaryStorage } from './auth/index.ts';
import { closeAuthDbPool } from './auth/pool.ts';
import { createStaff, promoteStaff, reenrollStaff, StaffError } from './auth/staff.ts';
import { createValkeyClient } from './clients/valkey.ts';
import { loadCliEnv } from './config/load.ts';
import { Secrets } from './config/secrets.ts';
import { RateLimiter } from './middleware/rate-limit.ts';
import { createEmailProducer } from './queue/producer.ts';

function usage(): never {
  process.stderr.write(
    'kullanım: cli.js approve-user --email <e-posta> [--as <personel e-postası>]\n' +
      '          cli.js create-staff --email <e> --name <ad> --role super_admin|support [--print-url]\n' +
      '          cli.js staff-reenroll --email <e> [--print-url]\n' +
      '          cli.js staff-promote --email <e> --role super_admin|support\n',
  );
  process.exit(2);
}

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function staffCommand(
  command: 'create-staff' | 'staff-reenroll' | 'staff-promote',
  args: string[],
): Promise<number> {
  const email = flag(args, '--email');
  if (email === undefined || email === '') usage();
  const env = loadCliEnv();
  const logger = createLogger({ service: 'eda-api-cli', level: 'warn' });
  const redis = createValkeyClient(
    { url: env.VALKEY_URL, username: env.VALKEY_USERNAME, passwordFile: env.VALKEY_PASSWORD_FILE },
    'eda-api-cli',
  );
  redis.on('error', () => undefined);
  await redis.connect().catch(() => undefined);
  try {
    const secrets = Secrets.fromFiles(env, SECRET_FILE_VARS.api);
    const db = defaultAuthDb();
    const { issueEnrollmentToken, revokeAllSessions } = createAdminAuth({
      // Komut satırı giriş yapmaz; sınırlayıcı yalnız bağımlılık gereği verilir (anahtar tek kullanımlık).
      rate: new RateLimiter({ redis, hmacKey: randomBytes(32) }),
      replay: valkeyReplayGuard(redis),
      baseURL: env.BETTER_AUTH_ADMIN_URL,
      adminUrl: env.ADMIN_URL,
      secret: secrets.get('BETTER_AUTH_ADMIN_SECRET_FILE'),
      passkeyRpId: env.PASSKEY_RP_ID,
      db,
      storage: valkeySecondaryStorage(redis),
      appDb: { withTenant, withUserScope, withNoTenant },
      logger,
    });
    const deps = { db, issueEnrollmentToken, revokeAllSessions, adminUrl: env.ADMIN_URL };
    if (command === 'staff-promote') {
      const p = await promoteStaff(
        {
          db,
          revokeAllSessions,
          audit: (e) => withNoTenant('pre_auth_audit', (tx) => appendAudit(e, 'platform', tx)),
        },
        { email, role: flag(args, '--role') ?? '' },
      );
      process.stdout.write(
        p.unchanged
          ? `staff-promote: …${p.userIdSuffix} zaten ${p.role}; değişiklik yok\n`
          : `staff-promote: …${p.userIdSuffix} -> ${p.role}; yönetim girişi parola + TOTP ile açılır\n` +
              'uyarı: personel hesabı uygulama yüzeyinde oturum açamaz; açık oturumlar kapatıldı\n',
      );
      return 0;
    }
    const r =
      command === 'create-staff'
        ? await createStaff(deps, {
            email,
            name: flag(args, '--name') ?? '',
            role: flag(args, '--role') ?? '',
          })
        : await reenrollStaff(deps, { email });
    process.stdout.write(`${command}: …${r.userIdSuffix} kayıt belirteci üretildi\n`);
    if (args.includes('--print-url')) {
      process.stdout.write(
        `kayıt bağlantısı (${r.expiresAt.toISOString()} dek): ${r.enrollmentUrl}\n`,
      );
    }
    return 0;
  } catch (err) {
    if (err instanceof StaffError) {
      process.stderr.write(`${command}: ${err.message}\n`);
      return err.exitCode;
    }
    process.stderr.write(
      `${command}: beklenmeyen hata (${err instanceof Error ? err.name : 'bilinmiyor'})\n`,
    );
    return 1;
  } finally {
    await redis.quit().catch(() => undefined);
    await closeAuthDbPool().catch(() => undefined);
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'create-staff' || command === 'staff-reenroll' || command === 'staff-promote')
    return staffCommand(command, rest);
  if (command !== 'approve-user') usage();
  const email = flag(rest, '--email');
  if (email === undefined || email === '') usage();
  const env = loadCliEnv();
  const logger = createLogger({ service: 'eda-api-cli', level: 'warn' });
  const redis = createValkeyClient(
    { url: env.VALKEY_URL, username: env.VALKEY_USERNAME, passwordFile: env.VALKEY_PASSWORD_FILE },
    'eda-api-cli',
  );
  redis.on('error', () => undefined);
  await redis.connect().catch(() => undefined);
  const producer = createEmailProducer(redis, logger);
  try {
    const r = await approveUser(
      {
        db: adminDbFromEnv(),
        enqueueEmailSend: (deliveryId) =>
          producer.addEmailSend({
            deliveryId,
            class: 'service',
            template: 'verification_approved',
          }),
      },
      { email, as: flag(rest, '--as') },
    );
    process.stdout.write(`approve-user: …${r.userIdSuffix} -> ${r.status}\n`);
    return 0;
  } catch (err) {
    if (err instanceof ApproveUserError) {
      process.stderr.write(`approve-user: ${err.message}\n`);
      return err.exitCode;
    }
    process.stderr.write(
      `approve-user: beklenmeyen hata (${err instanceof Error ? err.name : 'bilinmiyor'})\n`,
    );
    return 1;
  } finally {
    await producer.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await closeAdmin();
  }
}

process.exitCode = await main(process.argv.slice(2));
