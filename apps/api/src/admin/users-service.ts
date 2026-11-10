// Yönetim "Kullanıcılar ve kullanıcı limitleri" servisi: tüm okuma/yazma `eda_readonly_admin` havuzundan
// `app.admin_*` SECURITY DEFINER fonksiyonlarıyla yapılır (tablo yetkisi yok); aktör her çağrıda
// veritabanında doğrulanır (okuma: personel, yazma: yalnız `super_admin`). Çıktı içeriksizdir: kimlik,
// e-posta (`user_email`), durum ve sayaç. Oturum iptali kimlik katmanında (DB + Valkey) yapılır.
import type {
  AdminUserDetailDtoValue,
  AdminUserLimitsInputValue,
  AdminUserListItemDtoValue,
  AdminUserListQueryValue,
  AdminUserListResponseValue,
  AdminUserSearchInputValue,
  AdminUserSuspendInputValue,
} from '@eda/contracts/api/admin-users';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import type { AdminDb } from '@eda/db/admin';

export interface AdminUsersServiceDeps {
  readonly db: AdminDb;
  /** Kullanıcının tüm oturumlarını DB ve Valkey'den siler; silinen sayıyı döner. */
  readonly revokeAllSessions: (userId: string) => Promise<number>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_RE = /^[A-Za-z0-9_-]{1,200}$/;
/** Imleç zamanı mikrosaniye hassasiyetindedir (JS `Date` milisaniyeye keserdi; satır atlanırdı). */
const CURSOR_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const DEFAULT_PAGE = 25;

type Row = Record<string, unknown>;

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : (v instanceof Date ? v : new Date(String(v))).toISOString();

function sqlState(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

/** Veritabanı hatasını kamuya açık hataya çevirir (varlık/durum ayrışmaz; iç ayrıntı sızmaz). */
function mapDbError(err: unknown): never {
  switch (sqlState(err)) {
    case '42501':
      throw new AppError('ADMIN_FORBIDDEN', { reason: 'permission_missing' });
    case 'P0002':
      throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'user' });
    case '55000':
      throw new AppError('ADMIN_FORBIDDEN', { reason: 'permission_missing' });
    case '22023':
      throw new AppError('VALIDATION_FAILED');
    default:
      throw err;
  }
}

export function encodeUserCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

export function decodeUserCursor(cursor: string): { at: string; id: string } {
  if (!CURSOR_RE.test(cursor)) throw new AppError('VALIDATION_CURSOR_INVALID');
  const [at, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (
    rest.length > 0 ||
    at === undefined ||
    id === undefined ||
    !CURSOR_AT_RE.test(at) ||
    Number.isNaN(Date.parse(at)) ||
    !UUID_RE.test(id)
  ) {
    throw new AppError('VALIDATION_CURSOR_INVALID');
  }
  return { at, id: id.toLowerCase() };
}

function listItem(x: Row): AdminUserListItemDtoValue {
  const id = String(x.user_id);
  return {
    userId: id,
    shortId: id.slice(-8),
    userEmail: String(x.user_email),
    platformRole: x.platform_role as AdminUserListItemDtoValue['platformRole'],
    emailVerified: x.email_verified === true,
    verificationStatus: x.verification_status as AdminUserListItemDtoValue['verificationStatus'],
    accountStatus: x.account_status === 'suspended' ? 'suspended' : 'active',
    orgCount: n(x.org_count),
    lastLoginAt: iso(x.last_login_at),
    createdAt: iso(x.created_at) ?? '',
  };
}

/** Varsayılan limit zinciri (`null` = sınırsız). */
export function defaultUserLimits(): AdminUserDetailDtoValue['limits']['defaults'] {
  return {
    chatTurnsPerDay: CONFIG_DEFAULTS['limits.user.chatTurnsPerDay'],
    chatTurnsPerMonth: CONFIG_DEFAULTS['limits.user.chatTurnsPerMonth'],
    tokensPerDay: CONFIG_DEFAULTS['limits.user.tokensPerDay'],
    tokensPerMonth: CONFIG_DEFAULTS['limits.user.tokensPerMonth'],
  };
}

export function createAdminUsersService(deps: AdminUsersServiceDeps) {
  async function page(
    actorId: string,
    q: AdminUserListQueryValue & { query?: string },
  ): Promise<AdminUserListResponseValue> {
    const limit = q.limit ?? DEFAULT_PAGE;
    const cursor = q.cursor === undefined ? null : decodeUserCursor(q.cursor);
    let rows: Row[];
    try {
      const r = await deps.db.withAdmin((tx) =>
        tx.query(
          `SELECT t.*, pg_catalog.to_char(t.created_at AT TIME ZONE 'UTC',
                                          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
           FROM app.admin_list_users($1, $2, $3, $4, $5, $6, $7, $8) AS t`,
          [
            actorId,
            q.query ?? null,
            q.accountStatus ?? null,
            q.platformRole ?? null,
            q.verificationStatus ?? null,
            limit + 1,
            cursor?.at ?? null,
            cursor?.id ?? null,
          ],
        ),
      );
      rows = r.rows as Row[];
    } catch (err) {
      return mapDbError(err);
    }
    const items = rows.slice(0, limit).map(listItem);
    const last = items[items.length - 1];
    const lastAt = rows[items.length - 1]?.cursor_at;
    return {
      items,
      nextCursor:
        rows.length > limit && last && typeof lastAt === 'string'
          ? encodeUserCursor(lastAt, last.userId)
          : null,
    };
  }

  async function detail(actorId: string, userId: string): Promise<AdminUserDetailDtoValue> {
    let x: Row | undefined;
    try {
      const r = await deps.db.withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_user_detail($1, $2)', [actorId, userId]),
      );
      x = r.rows[0] as Row | undefined;
    } catch (err) {
      return mapDbError(err);
    }
    if (x === undefined) throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'user' });
    const overrides = {
      chatTurnsPerDay: nOrNull(x.ov_chat_turns_per_day),
      chatTurnsPerMonth: nOrNull(x.ov_chat_turns_per_month),
      tokensPerDay: nOrNull(x.ov_tokens_per_day),
      tokensPerMonth: nOrNull(x.ov_tokens_per_month),
    };
    const defaults = defaultUserLimits();
    const user = listItem(x);
    return {
      user,
      account: {
        status: user.accountStatus,
        suspendReasonCode:
          (x.suspend_reason_code as AdminUserDetailDtoValue['account']['suspendReasonCode']) ??
          null,
      },
      security: {
        passkeyCount: n(x.passkey_count),
        totpEnabled: x.totp_enabled === true,
        activeSessions: n(x.active_sessions),
      },
      usage: {
        conversationsTotal: n(x.conversations_total),
        chatTurnsToday: n(x.chat_turns_today),
        chatTurnsMonth: n(x.chat_turns_month),
        tokensToday: n(x.tokens_today),
        tokensMonth: n(x.tokens_month),
      },
      limits: {
        overrides,
        defaults,
        effective: {
          chatTurnsPerDay: overrides.chatTurnsPerDay ?? defaults.chatTurnsPerDay,
          chatTurnsPerMonth: overrides.chatTurnsPerMonth ?? defaults.chatTurnsPerMonth,
          tokensPerDay: overrides.tokensPerDay ?? defaults.tokensPerDay,
          tokensPerMonth: overrides.tokensPerMonth ?? defaults.tokensPerMonth,
        },
        overriddenAt: iso(x.ov_updated_at),
      },
    };
  }

  return {
    list: (actorId: string, q: AdminUserListQueryValue) => page(actorId, q),
    search: (actorId: string, q: AdminUserSearchInputValue) => page(actorId, q),
    detail,

    /** Askıya al / çıkar. Askıda tüm oturumlar da kapatılır; denetim satırı DB işleminde yazılır. */
    async setSuspended(actorId: string, userId: string, input: AdminUserSuspendInputValue) {
      if (input.suspended && input.reasonCode === undefined) {
        throw new AppError('VALIDATION_FAILED', {
          fields: [{ path: 'body.reasonCode', issue: 'required' }],
        });
      }
      let changed: boolean;
      try {
        changed = await deps.db.withAdminWrite(async (tx) => {
          const r = await tx.query<{ changed: boolean }>(
            'SELECT app.admin_set_user_suspended($1, $2, $3, $4) AS changed',
            [actorId, userId, input.suspended, input.suspended ? (input.reasonCode ?? null) : null],
          );
          return r.rows[0]?.changed === true;
        });
      } catch (err) {
        return mapDbError(err);
      }
      // Askı zaten giriş ve oturum çözümünü reddettirir; yine de açık oturumlar kapatılır.
      const revokedSessions = input.suspended ? await deps.revokeAllSessions(userId) : 0;
      return {
        userId,
        accountStatus: input.suspended ? ('suspended' as const) : ('active' as const),
        changed,
        revokedSessions,
      };
    },

    /** Tüm oturumları sonlandırır: önce hedef doğrulanır, sonra oturumlar silinir, sonra denetim yazılır. */
    async revokeSessions(actorId: string, userId: string) {
      let revoked: number;
      try {
        await deps.db.withAdmin((tx) =>
          tx.query('SELECT app.admin_assert_user_actionable($1, $2)', [actorId, userId]),
        );
        revoked = await deps.revokeAllSessions(userId);
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_audit_sessions_revoked($1, $2, $3)', [
            actorId,
            userId,
            revoked,
          ]),
        );
      } catch (err) {
        return mapDbError(err);
      }
      return { userId, revokedSessions: revoked };
    },

    /** Kullanıcıya özel limitler; dört değer de `null` ise geçersiz kılma silinir (sıfırla). */
    async setLimits(actorId: string, userId: string, input: AdminUserLimitsInputValue) {
      try {
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_set_user_limits($1, $2, $3, $4, $5, $6)', [
            actorId,
            userId,
            input.chatTurnsPerDay,
            input.chatTurnsPerMonth,
            input.tokensPerDay,
            input.tokensPerMonth,
          ]),
        );
      } catch (err) {
        return mapDbError(err);
      }
      return detail(actorId, userId);
    },
  };
}

export type AdminUsersService = ReturnType<typeof createAdminUsersService>;
