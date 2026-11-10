// `GET /api/v1/me` (041 §2.1; 053-ekranlar/01 §9): oturum kullanıcısının kimliği, oturum, meslek
// profili, üyelikler, aktif büro, özellik bayrakları, istemci sınırları ve ortam. Askı/ret
// durumunda da döner. Abonelik/kredi satırı yoksa güvenli varsayılan (planCode `none`, durum
// `expired`, bakiye 0). `twoFactorEnabled`/`hasPasskey` authDb'den, `activeOrg.mfa` `mfaGate`
// ile aynı politika fonksiyonundan (P04b).
// Hono bilmez; DB erişimi yalnız kiracı sarmalayıcılarıyla.
import { MeDto } from '@eda/contracts/api/me';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { EdaEnv } from '@eda/contracts/config/env';
import type { MfaLevel, SubscriptionStatus, VerificationStatus } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import {
  getOrganizationSummary,
  getSelfUser,
  listMembershipDetailsOfUser,
  type NoTenantTx,
  type TenantTx,
  type UserTx,
} from '@eda/db';
import { mfaRequired } from '../auth/mfa-policy.ts';

export interface MeDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
  withUserScope<T>(ctx: { userId: string }, fn: (tx: UserTx) => Promise<T>): Promise<T>;
  withNoTenant<T>(reason: 'catalog', fn: (tx: NoTenantTx) => Promise<T>): Promise<T>;
}

export interface MeContext {
  readonly session: {
    readonly id: string;
    readonly userId: string;
    readonly createdAt: Date;
    readonly mfaLevel: MfaLevel;
    readonly stepUpAt: Date | null;
  };
  readonly tenant: { readonly orgId: string; readonly memberRole: string } | null;
}

/** Kullanıcının kayıtlı MFA yöntemleri (authDb; `Identity.mfaFactors`). */
export interface MeFactors {
  readonly totp: boolean;
  readonly passkeys: number;
}

export interface MeEnv {
  readonly edaEnv: EdaEnv;
  readonly rerankEnabled: boolean;
  readonly maintenance: boolean;
}

const iso = (d: Date | null | undefined): string | null =>
  d === null || d === undefined ? null : new Date(d).toISOString();

type ProfileRow = {
  baro: string;
  sicil_no: string | null;
  trainee_registry_no: string | null;
  verification_source: 'admin_review' | 'org_invitation' | null;
  submitted_at: Date;
  reviewed_at: Date | null;
  rejection_reason: string | null;
};

export function profileDto(p: ProfileRow) {
  return {
    baro: p.baro,
    sicilNo: p.sicil_no,
    traineeRegistryNo: p.trainee_registry_no,
    verificationSource: p.verification_source,
    submittedAt: new Date(p.submitted_at).toISOString(),
    reviewedAt: iso(p.reviewed_at),
    rejectionReason: p.rejection_reason,
  };
}

export async function readProfile(
  tx: UserTx | TenantTx,
  userId: string,
): Promise<ProfileRow | null> {
  const r = await tx.query<ProfileRow>(
    `SELECT baro, sicil_no, trainee_registry_no, verification_source, submitted_at, reviewed_at,
            rejection_reason
     FROM app.lawyer_profiles WHERE user_id = $1`,
    [userId],
  );
  return r.rows[0] ?? null;
}

export async function buildMe(
  db: MeDb,
  ctx: MeContext,
  env: MeEnv,
  factors: MeFactors,
): Promise<MeDto> {
  const userId = ctx.session.userId;
  const base = await db.withUserScope({ userId }, async (tx) => {
    const user = await getSelfUser(tx, userId);
    if (user === null) throw new AppError('AUTH_UNAUTHENTICATED');
    const memberships = await listMembershipDetailsOfUser(tx, userId);
    const profile = await readProfile(tx, userId);
    const flags = await tx.query<{ key: string; enabled: boolean }>(
      'SELECT key, enabled FROM app.feature_flags ORDER BY key',
    );
    return { user, memberships, profile, flags: flags.rows };
  });

  let activeOrg: MeDto['activeOrg'] = null;
  if (ctx.tenant !== null) {
    const orgId = ctx.tenant.orgId;
    activeOrg = await db.withTenant({ orgId, userId }, async (tx) => {
      const org = await getOrganizationSummary(tx, orgId);
      if (org === null) return null;
      const s = await tx.query<Record<string, unknown>>(
        `SELECT ai_data_residency, sensitive_case_policy, allow_public_mode, show_reasoning,
                feedback_sharing_enabled, mfa_required_all, mask_own_case_number,
                assistant_ai_chat_enabled, trainee_supervision, trainee_export_requires_approval,
                retention_years_after_mandate, reminder_short_name_enabled, ics_enabled, legal_hold,
                letterhead
         FROM app.org_settings WHERE org_id = $1`,
        [orgId],
      );
      const sub = await tx.query<{
        plan_code: string;
        status: SubscriptionStatus;
        trial_ends_at: Date | null;
        seats: number;
      }>(
        `SELECT plan_code, status, trial_ends_at, seats FROM app.subscriptions
         WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [orgId],
      );
      const bal = await tx.query<{ balance_after: number }>(
        `SELECT balance_after FROM app.credit_ledger WHERE org_id = $1
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [orgId],
      );
      const row = s.rows[0];
      if (row === undefined) return null;
      const subRow = sub.rows[0];
      return {
        id: org.id,
        name: org.name,
        kind: org.kind,
        role: ctx.tenant?.memberRole as never,
        settings: {
          aiDataResidency: row.ai_data_residency as never,
          sensitiveCasePolicy: row.sensitive_case_policy as never,
          allowPublicMode: row.allow_public_mode === true,
          showReasoning: row.show_reasoning === true,
          feedbackSharingEnabled: row.feedback_sharing_enabled === true,
          mfaRequiredAll: row.mfa_required_all === true,
          maskOwnCaseNumber: row.mask_own_case_number === true,
          assistantAiChatEnabled: row.assistant_ai_chat_enabled === true,
          traineeSupervision: row.trainee_supervision === true,
          traineeExportRequiresApproval: row.trainee_export_requires_approval === true,
          retentionYearsAfterMandate: Number(row.retention_years_after_mandate),
          reminderShortNameEnabled: row.reminder_short_name_enabled === true,
          icsEnabled: row.ics_enabled === true,
          legalHold: row.legal_hold === true,
          letterhead: (row.letterhead ?? null) as never,
        },
        subscription:
          subRow === undefined
            ? { planCode: 'none', status: 'expired', trialEndsAt: null, seats: 1 }
            : {
                planCode: subRow.plan_code,
                status: subRow.status,
                trialEndsAt: iso(subRow.trial_ends_at),
                seats: subRow.seats,
              },
        credits: { balance: bal.rows[0]?.balance_after ?? 0 },
        // `mfaGate` ile aynı politika; istemci verisi anı dahil en sıkı koşul (042 §5.1).
        mfa: mfaRequired(
          {
            memberRole: ctx.tenant?.memberRole as never,
            orgKind: org.kind,
            mfaRequiredAll: row.mfa_required_all === true,
          },
          true,
        ),
      };
    });
  }

  const stepUpWindowMs = CONFIG_DEFAULTS['auth.stepUpWindowMin'] * 60_000;
  const absMs = CONFIG_DEFAULTS['auth.sessionAbsoluteDays'] * 86_400_000;
  const d = CONFIG_DEFAULTS;
  return MeDto.parse({
    user: {
      id: base.user.id,
      name: base.user.name,
      email: base.user.email,
      emailVerified: base.user.emailVerified,
      platformRole: base.user.platformRole,
      verificationStatus: base.user.verificationStatus as VerificationStatus,
      twoFactorEnabled: factors.totp,
      hasPasskey: factors.passkeys > 0,
    },
    session: {
      id: ctx.session.id,
      mfaLevel: ctx.session.mfaLevel,
      stepUpAt: iso(ctx.session.stepUpAt),
      stepUpValidUntil:
        ctx.session.stepUpAt === null
          ? null
          : new Date(ctx.session.stepUpAt.getTime() + stepUpWindowMs).toISOString(),
      createdAt: ctx.session.createdAt.toISOString(),
      absoluteExpiresAt: new Date(ctx.session.createdAt.getTime() + absMs).toISOString(),
    },
    profile: base.profile === null ? null : profileDto(base.profile),
    memberships: base.memberships.map((m) => ({
      orgId: m.organizationId,
      orgName: m.orgName,
      orgKind: m.orgKind,
      role: m.role,
      status: m.status,
    })),
    activeOrg,
    features: Object.fromEntries(base.flags.map((f) => [f.key, f.enabled])),
    limits: {
      uploadMaxMb: d['upload.maxMb'],
      uploadAllowedTypes: [...d['upload.allowedTypes']],
      uploadMaxPagesPerFile: d['upload.maxPagesPerFile'],
      uploadMaxFilesPerCase: d['upload.maxFilesPerCase'],
      maxUserMessageChars: d['chat.maxUserMessageChars'],
      maxAttachmentsPerMessage: d['chat.maxAttachmentsPerMessage'],
      maxMentionsPerMessage: d['chat.maxMentionsPerMessage'],
      pageSizeDefault: d['api.pageSizeDefault'],
      pageSizeMax: d['api.pageSizeMax'],
      kvkkPreviewDebounceMs: d['kvkk.previewDebounceMs'],
      editorAutosaveDebounceMs: d['editor.autosaveDebounceMs'],
      editorAutosaveMaxWaitMs: d['editor.autosaveMaxWaitMs'],
      chatPollIntervalMs: d['chat.pollIntervalMs'],
      reminderDefaultMinutes: [...d['reminders.defaultMinutes']],
    },
    environment: {
      kind: env.edaEnv,
      simulation: env.edaEnv === 'beta-synthetic',
      rerankEnabled: env.rerankEnabled,
      maintenance: env.maintenance,
    },
  });
}
