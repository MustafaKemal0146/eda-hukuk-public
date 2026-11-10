// `POST /api/v1/me/lawyer-application` (042 §3.1 adım 4–5; 041 §3.3; 053-ekranlar/01 §9.3).
//  - Baro adı `@eda/legal` `BARO_NAMES` kümesinden; `sicilNo` XOR `traineeRegistryNo`.
//  - `verified` kullanıcının baro/sicili salt okunurdur (403; düzeltme destek talebiyle).
//  - `rejected` kullanıcı `auth.reapplyCooldownHours` dolmadan yeniden başvuramaz (409
//    `VALIDATION_CONFLICT` `reapply_cooldown`, `meta.retryAfterSec`); dolduysa durum
//    `pending_verification`'a döner (authDb, ayrı işlem).
//  - Aynı `(baro, sicil_no)` başka kullanıcıdaysa 409 `VALIDATION_CONFLICT` (`registry_in_use`).
//  - Geçersiz `partnerCode` başvuruyu engellemez (`partnerCodeAccepted: false`); geçerliyse bireysel
//    büroya `authDb` ile AYRI işlemde yazılır.
// `invitationId` verilirse (P04b; 042 §4.2 adım 4) profil kaynağı davet geçerliyse
//    `org_invitation` olarak işaretlenir (`app.mark_profile_invitation_source`); durum kabulde
//    değişir ve "başvuru alındı" e-postası gönderilmez. Geçersiz davet başvuruyu engellemez.
//  - Başarıda `lawyer_application_received` e-postası. Katalogda bu akış için denetim olayı yoktur;
//    olay yazılmaz. `verification_source` karar anında yazılır.
import { type LawyerApplicationInput, LawyerApplicationResultDto } from '@eda/contracts/api/auth';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { VerificationStatus } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import type { NoTenantTx, UserTx } from '@eda/db';
import { BARO_NAMES } from '@eda/legal/courts';
import { profileDto, readProfile } from './me.ts';

export interface LawyerApplicationDeps {
  readonly db: {
    withUserScope<T>(ctx: { userId: string }, fn: (tx: UserTx) => Promise<T>): Promise<T>;
    withNoTenant<T>(reason: 'catalog', fn: (tx: NoTenantTx) => Promise<T>): Promise<T>;
  };
  readonly writes: {
    setPartnerCode(orgId: string, code: string): Promise<boolean>;
    resubmitApplication(userId: string): Promise<boolean>;
  };
  readonly sendReceived: (userId: string, submittedAt: Date) => Promise<void>;
  readonly now?: () => Date;
}

export interface LawyerApplicationContext {
  readonly userId: string;
  readonly verificationStatus: VerificationStatus;
  /** Bayi kodu yazılabilecek büro: kullanıcının bireysel sahiplik bürosu (yoksa null). */
  readonly individualOrgId: string | null;
}

const UNIQUE_VIOLATION = '23505';

export async function submitLawyerApplication(
  deps: LawyerApplicationDeps,
  ctx: LawyerApplicationContext,
  input: LawyerApplicationInput,
): Promise<LawyerApplicationResultDto> {
  const now = deps.now ?? (() => new Date());
  if (!(BARO_NAMES as readonly string[]).includes(input.baro)) {
    throw new AppError('VALIDATION_FAILED', {
      fields: [{ path: 'body.baro', issue: 'invalid_enum' }],
    });
  }
  if (ctx.verificationStatus === 'verified') {
    // Doğrulanmış kullanıcının meslek bilgisi salt okunurdur (053-ekranlar/01 §9.3).
    throw new AppError('AUTH_FORBIDDEN', { reason: 'policy_denied' });
  }
  const at = now();
  const existing = await deps.db.withUserScope({ userId: ctx.userId }, (tx) =>
    readProfile(tx, ctx.userId),
  );
  if (ctx.verificationStatus === 'rejected') {
    const reviewed = existing?.reviewed_at ?? null;
    const until =
      reviewed === null
        ? 0
        : new Date(reviewed).getTime() + CONFIG_DEFAULTS['auth.reapplyCooldownHours'] * 3_600_000;
    if (until > at.getTime()) {
      throw new AppError('VALIDATION_CONFLICT', {
        reason: 'reapply_cooldown',
        meta: { retryAfterSec: Math.ceil((until - at.getTime()) / 1000) },
      });
    }
  }
  const sicil = input.kind === 'lawyer' ? (input.sicilNo ?? null) : null;
  const trainee = input.kind === 'trainee' ? (input.traineeRegistryNo ?? null) : null;
  let profile: Awaited<ReturnType<typeof readProfile>>;
  let viaInvitation = false;
  try {
    profile = await deps.db.withUserScope({ userId: ctx.userId }, async (tx) => {
      await tx.query(
        `INSERT INTO app.lawyer_profiles (user_id, baro, sicil_no, trainee_registry_no)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
           SET baro = EXCLUDED.baro, sicil_no = EXCLUDED.sicil_no,
               trainee_registry_no = EXCLUDED.trainee_registry_no, submitted_at = $5`,
        [ctx.userId, input.baro, sicil, trainee, at],
      );
      if (input.invitationId !== undefined) {
        const r = await tx.query<{ ok: boolean }>(
          'SELECT app.mark_profile_invitation_source($1) AS ok',
          [input.invitationId],
        );
        viaInvitation = r.rows[0]?.ok === true;
      }
      return readProfile(tx, ctx.userId);
    });
  } catch (err) {
    if ((err as { code?: unknown }).code === UNIQUE_VIOLATION) {
      throw new AppError('VALIDATION_CONFLICT', {
        reason: 'registry_in_use',
        actions: ['contact_support'],
      });
    }
    throw err;
  }
  if (profile === null) throw new AppError('INTERNAL_ERROR');
  let status: VerificationStatus = ctx.verificationStatus;
  if (status === 'rejected') {
    await deps.writes.resubmitApplication(ctx.userId);
    status = 'pending_verification';
  }
  let partnerCodeAccepted: boolean | null = null;
  if (input.partnerCode !== undefined) {
    const valid = await deps.db.withNoTenant('catalog', async (tx) => {
      const r = await tx.query<{ ok: boolean }>('SELECT app.validate_partner_code($1) AS ok', [
        input.partnerCode,
      ]);
      return r.rows[0]?.ok === true;
    });
    partnerCodeAccepted =
      valid && ctx.individualOrgId !== null
        ? await deps.writes.setPartnerCode(ctx.individualOrgId, input.partnerCode)
        : false;
  }
  if (!viaInvitation) await deps.sendReceived(ctx.userId, new Date(profile.submitted_at));
  return LawyerApplicationResultDto.parse({
    profile: profileDto(profile),
    verificationStatus: status,
    partnerCodeAccepted,
  });
}
