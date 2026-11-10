// Kimlik modülünün dış yüzü: Better Auth işleyicisi, oturum çözümü, `auth` yazımları ve okumaları,
// MFA durumu ve step-up. `authDb` ve Better Auth örneği bu dizinin dışına çıkmaz (Y-98, KK-P04a-18);
// ara katman ve servisler yalnız `Identity` arayüzünü görür.
import type { StepUpInput, StepUpResultDto } from '@eda/contracts/api/me';
import type { MfaLevel, PlatformRole, VerificationStatus } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import { eq } from 'drizzle-orm';
import { type AppAuth, type AppAuthDeps, createAppAuth } from './app-auth.ts';
import { createAuditWriter } from './audit.ts';
import { AUTH_TABLES } from './auth-db.ts';
import { mfaAlwaysRequired } from './mfa-policy.ts';
import { createOrgStore, type OrgStore } from './org-store.ts';
import { createPasswordHasher } from './password.ts';
import { runWithAuthState } from './request-state.ts';
import { performStepUp } from './step-up.ts';
import { type AuthWrites, createAuthWrites } from './writes.ts';

export {
  AUTH_IP_LIMITED,
  AUTH_PATH_ALLOWLIST,
  authSubPath,
  isAllowedAuthRequest,
  STEP_UP_AUTH_PATHS,
} from './allowlist.ts';
export type { AppAuthDeps, AuthEmails, AuthUserRef } from './app-auth.ts';
export { defaultAuthDb } from './auth-db.ts';
export { hasSessionCookie, SESSION_COOKIE } from './cookies.ts';
export { inviteRoleError, type MemberAction, memberActionError } from './hooks/organization.ts';
export {
  CLIENT_DATA_ROUTES,
  type MfaDecision,
  type MfaPolicyInput,
  mfaRequired,
} from './mfa-policy.ts';
export { clientIp } from './net.ts';
export {
  type InvitationRow,
  invitationRef,
  type MemberRow,
  type MfaFactors,
  type OrgStore,
} from './org-store.ts';
export { valkeyReplayGuard, valkeySecondaryStorage } from './secondary-storage.ts';
export { stepUpExpiresAt, stepUpValid } from './step-up.ts';
export type { AuthWrites } from './writes.ts';

export interface SessionContext {
  readonly id: string;
  readonly userId: string;
  readonly token: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly mfaLevel: MfaLevel;
  readonly stepUpAt: Date | null;
  readonly activeOrganizationId: string | null;
  readonly surface: 'app' | 'admin';
}

export interface SessionUser {
  readonly id: string;
  readonly platformRole: PlatformRole;
  readonly verificationStatus: VerificationStatus;
  readonly banned: boolean;
}

export interface ResolvedSession {
  readonly session: SessionContext;
  readonly user: SessionUser;
  /** Kaydırmalı süre yenilemesinde Better Auth'un yazdığı çerezler (yanıta aktarılır). */
  readonly setCookie: readonly string[];
}

/** Büro servislerinin kimlik tarafı (davet/üye yazımları + oturum temizliği). */
export interface OrgIdentity extends OrgStore {
  /** Kullanıcının bu büroyu aktif gösteren oturumlarında aktif büroyu NULL'lar (DB + Valkey). */
  clearActiveOrg(userId: string, orgId: string): Promise<number>;
}

export interface SessionSummary {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface StepUpRequest {
  readonly session: Pick<SessionContext, 'id' | 'token' | 'userId' | 'activeOrganizationId'>;
  readonly input: StepUpInput;
  readonly headers: Headers;
}

export interface Identity {
  handle(request: Request): Promise<Response>;
  getSession(headers: Headers): Promise<ResolvedSession | null>;
  revokeSession(token: string): Promise<void>;
  readonly writes: AuthWrites;
  readonly org: OrgIdentity;
  /** Kullanıcının kayıtlı MFA yöntemleri (`GET /me`, step-up yöntem seçimi). */
  mfaFactors(userId: string): ReturnType<OrgStore['mfaFactors']>;
  /** Zorunlu rolün son yöntemi kaldırılamaz (042 §5.5): 403 `AUTH_FORBIDDEN` `mfa_required_role`. */
  assertCanRemoveFactor(userId: string, kind: 'totp' | 'passkey'): Promise<void>;
  stepUp(req: StepUpRequest): Promise<StepUpResultDto>;
  /** Kullanıcının etkin oturumları (belirteç DIŞARI verilmez). */
  listSessions(userId: string): Promise<SessionSummary[]>;
  /** Kimlikle iptal: yalnız kullanıcının kendi oturumu; bulunamazsa `false`. */
  revokeSessionById(userId: string, sessionId: string): Promise<boolean>;
  /** Geçerli oturum dışındakileri kapatır; kapatılan sayısını döner. */
  revokeOtherSessions(userId: string, currentSessionId: string): Promise<number>;
  /** Yalnız testler: Better Auth sunucu API'si. */
  readonly auth: AppAuth;
}

const toDate = (v: unknown): Date | null =>
  v instanceof Date ? v : typeof v === 'string' || typeof v === 'number' ? new Date(v) : null;

export function createIdentity(deps: AppAuthDeps): Identity {
  const now = deps.now ?? (() => new Date());
  const auth = createAppAuth(deps);
  const writes = createAuthWrites(deps.db, deps.now);
  const store = createOrgStore(deps.db);
  const hasher = createPasswordHasher();
  const audit = createAuditWriter(deps.appDb, deps.logger);

  const org: OrgIdentity = {
    ...store,
    async clearActiveOrg(userId, orgId) {
      const ctx = await auth.$context;
      const tokens = await store.sessionTokensWithActiveOrg(userId, orgId);
      for (const token of tokens) {
        await ctx.internalAdapter.updateSession(token, { activeOrganizationId: null });
      }
      return tokens.length;
    },
  };

  async function assertCanRemoveFactor(userId: string, kind: 'totp' | 'passkey') {
    const f = await store.mfaFactors(userId);
    const remaining = kind === 'totp' ? f.passkeys : f.passkeys - 1 + (f.totp ? 1 : 0);
    if (remaining > 0) return;
    const memberships = await store.activeMembershipsWithKind(userId);
    const inputs = [];
    for (const m of memberships) {
      const all = await deps.appDb
        .withTenant({ orgId: m.orgId, userId }, async (tx) => {
          const r = await tx.query<{ mfa_required_all: boolean }>(
            'SELECT mfa_required_all FROM app.org_settings WHERE org_id = $1',
            [m.orgId],
          );
          return r.rows[0]?.mfa_required_all === true;
        })
        .catch((err: unknown) => {
          if (err instanceof AppError && err.code === 'ORG_NOT_MEMBER') return false;
          throw err;
        });
      inputs.push({ memberRole: m.role, orgKind: m.kind, mfaRequiredAll: all });
    }
    if (mfaAlwaysRequired(inputs)) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'mfa_required_role' });
    }
  }

  return {
    auth,
    writes,
    org,
    handle: (request) => runWithAuthState(() => auth.handler(request)),
    mfaFactors: (userId) => store.mfaFactors(userId),
    assertCanRemoveFactor,
    async getSession(headers) {
      const r = await auth.api.getSession({ headers, returnHeaders: true });
      const data = r.response;
      if (data === null) return null;
      const s = data.session as typeof data.session & Record<string, unknown>;
      const u = data.user as typeof data.user & Record<string, unknown>;
      const setCookie =
        typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
      // Better Auth oturum + kullanıcıyı ikincil depolamada (Valkey) önbellekler; meslek kararı,
      // askı ve rol DB'de (`admin_decide_application`, P27) değişir. Kapı kararları bayat önbellekle
      // verilmesin diye durum alanları her istekte `authDb`'den okunur (042 §3.2).
      const [fresh] = await deps.db
        .select({
          platformRole: AUTH_TABLES.users.platformRole,
          verificationStatus: AUTH_TABLES.users.verificationStatus,
          banned: AUTH_TABLES.users.banned,
        })
        .from(AUTH_TABLES.users)
        .where(eq(AUTH_TABLES.users.id, s.userId));
      if (fresh === undefined) return null;
      return {
        session: {
          id: s.id,
          userId: s.userId,
          token: s.token,
          createdAt: toDate(s.createdAt) ?? new Date(0),
          expiresAt: toDate(s.expiresAt) ?? new Date(0),
          mfaLevel: (s.mfaLevel as MfaLevel | undefined) ?? 'none',
          stepUpAt: toDate(s.stepUpAt),
          activeOrganizationId: (s.activeOrganizationId as string | null | undefined) ?? null,
          surface: (s.surface as 'app' | 'admin' | undefined) ?? 'app',
        },
        user: {
          id: u.id,
          platformRole: fresh.platformRole as PlatformRole,
          verificationStatus: fresh.verificationStatus as VerificationStatus,
          banned: fresh.banned === true,
        },
        setCookie,
      };
    },
    async revokeSession(token) {
      const ctx = await auth.$context;
      await ctx.internalAdapter.deleteSession(token);
    },
    async listSessions(userId) {
      const ctx = await auth.$context;
      const nowMs = now().getTime();
      const rows = await ctx.internalAdapter.listSessions(userId);
      return rows
        .filter((s) => (toDate(s.expiresAt)?.getTime() ?? 0) > nowMs)
        .map((s) => {
          const x = s as typeof s & Record<string, unknown>;
          return {
            id: s.id,
            createdAt: toDate(s.createdAt) ?? new Date(0),
            updatedAt: toDate(s.updatedAt) ?? toDate(s.createdAt) ?? new Date(0),
            expiresAt: toDate(s.expiresAt) ?? new Date(0),
            ipAddress: typeof x.ipAddress === 'string' && x.ipAddress !== '' ? x.ipAddress : null,
            userAgent:
              typeof x.userAgent === 'string' && x.userAgent !== ''
                ? x.userAgent.slice(0, 300)
                : null,
          };
        })
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    },
    async revokeSessionById(userId, sessionId) {
      const ctx = await auth.$context;
      const hit = (await ctx.internalAdapter.listSessions(userId)).find((s) => s.id === sessionId);
      if (hit === undefined) return false;
      await ctx.internalAdapter.deleteSession(hit.token);
      return true;
    },
    async revokeOtherSessions(userId, currentSessionId) {
      const ctx = await auth.$context;
      const others = (await ctx.internalAdapter.listSessions(userId)).filter(
        (s) => s.id !== currentSessionId,
      );
      for (const s of others) await ctx.internalAdapter.deleteSession(s.token);
      return others.length;
    },
    async stepUp(req) {
      const ctx = await auth.$context;
      return performStepUp(
        {
          store,
          rate: deps.rate,
          audit,
          secret: deps.secret,
          appUrl: deps.appUrl,
          rpId: deps.passkeyRpId,
          now,
          verifyPassword: (hash, password) => hasher.verify({ hash, password }),
          verifyTotp: (headers, code) =>
            runWithAuthState(async () => {
              try {
                await auth.api.verifyTOTP({ headers, body: { code } });
                return true;
              } catch {
                return false;
              }
            }),
          consumeChallenge: async (token) => {
            const v = await ctx.internalAdapter.consumeVerificationValue(token);
            return v?.value ?? null;
          },
          updateSession: async (token, fields) => {
            await ctx.internalAdapter.updateSession(token, fields);
          },
        },
        {
          sessionId: req.session.id,
          token: req.session.token,
          userId: req.session.userId,
          activeOrgId: req.session.activeOrganizationId,
        },
        req.input,
        req.headers,
      );
    },
  };
}
