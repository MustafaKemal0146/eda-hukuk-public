// Yönetim yüzeyi kimlik sarmalayıcısı (`adminAuth` üstünde): işleyici, oturum çözümü ve kayıt belirteci.
// Oturum durum alanları (rol, askı) her istekte `authDb`'den okunur; önbellek kapı kararı vermez.
import type { MfaLevel, PlatformRole } from '@eda/contracts/enums';
import { eq } from 'drizzle-orm';
import { type AdminAuthDeps, createAdminAuth } from './admin-auth.ts';
import { AUTH_TABLES } from './auth-db.ts';
import { runWithAuthState } from './request-state.ts';

export interface AdminSession {
  readonly id: string;
  readonly userId: string;
  readonly token: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly mfaLevel: MfaLevel;
  readonly stepUpAt: Date | null;
  readonly surface: string;
}

export interface AdminUser {
  readonly id: string;
  readonly name: string;
  readonly platformRole: PlatformRole;
  readonly banned: boolean;
  readonly suspended: boolean;
}

export interface ResolvedAdminSession {
  readonly session: AdminSession;
  readonly user: AdminUser;
  readonly setCookie: readonly string[];
}

export interface AdminIdentity {
  handle(request: Request): Promise<Response>;
  getSession(headers: Headers): Promise<ResolvedAdminSession | null>;
  revokeSession(token: string): Promise<void>;
  /** `create-staff`: kullanıcı için tek kullanımlık passkey kayıt belirteci. */
  issueEnrollmentToken(userId: string): Promise<{ token: string; expiresAt: Date }>;
  revokeAllSessions(userId: string): Promise<void>;
  /** Kullanıcının tüm oturumlarını siler ve sayıyı döner (Kullanıcılar modülü). */
  revokeUserSessions(userId: string): Promise<number>;
  /** Yalnız testler. */
  readonly auth: ReturnType<typeof createAdminAuth>['auth'];
}

const toDate = (v: unknown): Date | null =>
  v instanceof Date ? v : typeof v === 'string' || typeof v === 'number' ? new Date(v) : null;

export function createAdminIdentity(deps: AdminAuthDeps): AdminIdentity {
  const { auth, issueEnrollmentToken, revokeAllSessions, revokeUserSessions } =
    createAdminAuth(deps);
  const { users, sessions } = AUTH_TABLES;
  return {
    auth,
    issueEnrollmentToken,
    revokeAllSessions,
    revokeUserSessions,
    handle: (request) => runWithAuthState(() => auth.handler(request)),
    async getSession(headers) {
      const r = await auth.api.getSession({ headers, returnHeaders: true });
      const data = r.response;
      if (data === null) return null;
      const s = data.session as typeof data.session & Record<string, unknown>;
      const u = data.user as typeof data.user & Record<string, unknown>;
      const [fresh] = await deps.db
        .select({
          platformRole: users.platformRole,
          banned: users.banned,
          name: users.name,
          verificationStatus: users.verificationStatus,
        })
        .from(users)
        .where(eq(users.id, s.userId));
      if (fresh === undefined) return null;
      // Ek savunma: Valkey önbelleğinde kalmış ama DB'den silinmiş oturum geçersizdir.
      const [row] = await deps.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.token, s.token));
      if (row === undefined) return null;
      return {
        session: {
          id: s.id,
          userId: s.userId,
          token: s.token,
          createdAt: toDate(s.createdAt) ?? new Date(0),
          expiresAt: toDate(s.expiresAt) ?? new Date(0),
          mfaLevel: (s.mfaLevel as MfaLevel | undefined) ?? 'none',
          stepUpAt: toDate(s.stepUpAt),
          surface: String(s.surface ?? ''),
        },
        user: {
          id: u.id,
          name: fresh.name,
          platformRole: fresh.platformRole as PlatformRole,
          banned: fresh.banned === true,
          suspended: fresh.verificationStatus === 'suspended',
        },
        setCookie: typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [],
      };
    },
    async revokeSession(token) {
      const ctx = await auth.$context;
      await ctx.internalAdapter.deleteSession(token);
    },
  };
}
