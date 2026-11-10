// `@eda/db/testing`: YALNIZ test dosyaları içindir (dependency-cruiser `db-testing-only-tests`).
// Uygulama paketlerinin entegrasyon testleri (api, worker) kimlik fixture'larını `eda_owner` ile
// (auth RLS'sizdir) yazar ve rol başı `TenantRunner` kurar; uygulama kodu bu modülü göremez.
// Parolalar verilen sır dizinindeki dosyalardan okunur ve hiçbir yere yazılmaz.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { poolTypes } from './pool.ts';

export { createMemoryObjectStore, type MemoryObjectStore } from './s3/memory.ts';

import { withSeedRlsException } from './seed/rls-exception.ts';
import { createTenantRunner, type TenantRunner } from './tenant.ts';

export interface TestingDbTarget {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  /** `infra/secrets/dev` mutlak yolu. */
  readonly secretsDir: string;
}

const ROLE_SECRET = {
  eda_owner: 'pg_owner_password',
  eda_app: 'pg_app_password',
  eda_worker: 'pg_worker_password',
  eda_jobs: 'pg_jobs_password',
  eda_auth: 'pg_auth_password',
  eda_readonly_admin: 'pg_readonly_admin_password',
} as const;
export type TestingRole = keyof typeof ROLE_SECRET;

export interface TestingDb {
  /** `eda_owner` ile tek sorgu (kimlik fixture'ları; app tablolarında FORCE RLS geçerlidir). */
  ownerQuery<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<R[]>;
  /** `eda_jobs` (BYPASSRLS, kolon kısıtlı) ile tek sorgu: içeriksiz durum doğrulamaları. */
  jobsQuery<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<R[]>;
  runner(role: 'eda_app' | 'eda_worker' | 'eda_owner'): TenantRunner;
  /** Kimlik fixture'ları (`eda_owner`): `auth` tablolarına SQL yalnız bu modülde yazılır. */
  readonly auth: TestingAuth;
  close(): Promise<void>;
}

export interface TestingUserInput {
  readonly name: string;
  readonly email: string;
  readonly emailVerified?: boolean;
  readonly platformRole?: 'user' | 'support' | 'super_admin';
  readonly verificationStatus?: 'pending_verification' | 'verified' | 'rejected' | 'suspended';
}

export interface TestingMembership {
  readonly orgId: string;
  readonly kind: string;
  readonly role: string;
  readonly status: string;
}

export interface TestingAuth {
  insertUser(u: TestingUserInput): Promise<string>;
  userIdByEmail(email: string): Promise<string | null>;
  userState(userId: string): Promise<{ emailVerified: boolean; verificationStatus: string } | null>;
  memberships(userId: string): Promise<TestingMembership[]>;
  sessionCount(userId: string): Promise<number>;
  credentialHash(userId: string): Promise<string | null>;
  setCredentialHash(userId: string, hash: string): Promise<void>;
  /** Parola hesabı satırı ekler (yoksa oluşturur; parola girişi gerektiren oturum fixture'ı). */
  insertCredential(userId: string, hash: string): Promise<void>;
  /** Verilen oluşturma zamanıyla (mikrosaniye hassasiyetli metin) doğrulanmış kullanıcı ekler. */
  insertUserCreatedAt(name: string, email: string, createdAt: string): Promise<string>;
  /** TOTP kaydını doğrulanmış ve kullanıcıyı 2FA etkin yapar (kurulum akışını atlayan fixture). */
  markTotpVerified(userId: string): Promise<void>;
  /** Kullanıcının yasak durumu ve gerekçe kodu. */
  banState(userId: string): Promise<{ banned: boolean; banReason: string | null } | null>;
  /** P04b: kullanıcının oturum alanları (oluşturma sırasıyla). */
  sessionRows(userId: string): Promise<TestingSession[]>;
  setPlatformRole(userId: string, role: 'user' | 'support' | 'super_admin'): Promise<void>;
  setVerification(userId: string, status: TestingUserInput['verificationStatus']): Promise<void>;
  insertOrg(name: string, kind: 'firm' | 'individual'): Promise<string>;
  addMember(
    orgId: string,
    userId: string,
    role: string,
    status?: 'active' | 'suspended',
  ): Promise<string>;
  /** Çok koltuklu canlı abonelik (koltuk tetikleyicisi; 032 §11.3 istisna yolu). */
  grantSeats(orgId: string, seats: number): Promise<void>;
  /** Canlı aboneliğin koltuk sayısını değiştirir (032 §11.3 istisna yolu). */
  setSeats(orgId: string, seats: number): Promise<void>;
  setOrgSuspended(orgId: string, suspended: boolean): Promise<void>;
  setMemberStatus(orgId: string, userId: string, status: 'active' | 'suspended'): Promise<void>;
  invitationRows(
    orgId: string,
  ): Promise<{ id: string; email: string; role: string; status: string }[]>;
  memberCount(orgId: string): Promise<number>;
  insertInvitation(orgId: string, email: string, role: string, inviterId: string): Promise<string>;
  setInvitationStatus(id: string, status: string): Promise<void>;
  /** Bayi kullanıcısı (bayi + `partner_members`). */
  makePartnerUser(userId: string, code: string): Promise<void>;
  twoFactorEnabled(userId: string): Promise<boolean>;
  passkeyCount(userId: string): Promise<number>;
}

export interface TestingSession {
  readonly id: string;
  readonly activeOrganizationId: string | null;
  readonly mfaLevel: string;
  readonly stepUpAt: Date | null;
}

export function createTestingDb(target: TestingDbTarget): TestingDb {
  const pools = new Map<TestingRole, pg.Pool>();
  const pool = (role: TestingRole): pg.Pool => {
    let p = pools.get(role);
    if (p === undefined) {
      p = new pg.Pool({
        host: target.host,
        port: target.port,
        database: target.database,
        user: role,
        password: readFileSync(join(target.secretsDir, ROLE_SECRET[role]), 'utf8').trim(),
        max: 2,
        application_name: 'eda-testing',
        connectionTimeoutMillis: 5000,
        types: poolTypes,
      });
      p.on('error', () => undefined);
      pools.set(role, p);
    }
    return p;
  };
  const owner = async <R extends pg.QueryResultRow>(sql: string, params: unknown[]) =>
    (await pool('eda_owner').query<R>(sql, params)).rows;
  const auth: TestingAuth = {
    async insertUser(u) {
      const r = await owner<{ id: string }>(
        `INSERT INTO auth.users (name, email, email_verified, platform_role, verification_status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          u.name,
          u.email,
          u.emailVerified ?? false,
          u.platformRole ?? 'user',
          u.verificationStatus ?? 'pending_verification',
        ],
      );
      const id = r[0]?.id;
      if (id === undefined) throw new Error('kullanıcı oluşturulamadı');
      return id;
    },
    async userIdByEmail(email) {
      const r = await owner<{ id: string }>('SELECT id FROM auth.users WHERE email = $1', [email]);
      return r[0]?.id ?? null;
    },
    async userState(userId) {
      const r = await owner<{ email_verified: boolean; verification_status: string }>(
        'SELECT email_verified, verification_status FROM auth.users WHERE id = $1',
        [userId],
      );
      const u = r[0];
      return u === undefined
        ? null
        : { emailVerified: u.email_verified, verificationStatus: u.verification_status };
    },
    async memberships(userId) {
      const r = await owner<{ id: string; kind: string; role: string; status: string }>(
        `SELECT o.id, o.kind, m.role, m.status FROM auth.members m
         JOIN auth.organizations o ON o.id = m.organization_id
         WHERE m.user_id = $1 ORDER BY m.created_at`,
        [userId],
      );
      return r.map((x) => ({ orgId: x.id, kind: x.kind, role: x.role, status: x.status }));
    },
    async sessionCount(userId) {
      const r = await owner<{ n: string }>(
        'SELECT count(*) AS n FROM auth.sessions WHERE user_id = $1',
        [userId],
      );
      return Number(r[0]?.n ?? '0');
    },
    async credentialHash(userId) {
      const r = await owner<{ password: string | null }>(
        `SELECT password FROM auth.accounts WHERE user_id = $1 AND provider_id = 'credential'`,
        [userId],
      );
      return r[0]?.password ?? null;
    },
    async setCredentialHash(userId, hash) {
      await owner(
        `UPDATE auth.accounts SET password = $2 WHERE user_id = $1 AND provider_id = 'credential'`,
        [userId, hash],
      );
    },
    async insertCredential(userId, hash) {
      await owner(
        `INSERT INTO auth.accounts (user_id, account_id, provider_id, password)
         VALUES ($1::uuid, $1::text, 'credential', $2)`,
        [userId, hash],
      );
    },
    async insertUserCreatedAt(name, email, createdAt) {
      const r = await owner<{ id: string }>(
        `INSERT INTO auth.users (name, email, email_verified, created_at)
         VALUES ($1, $2, true, $3::timestamptz) RETURNING id`,
        [name, email, createdAt],
      );
      const id = r[0]?.id;
      if (id === undefined) throw new Error('kullanıcı oluşturulamadı');
      return id;
    },
    async markTotpVerified(userId) {
      await owner('UPDATE auth.two_factors SET verified = true WHERE user_id = $1', [userId]);
      await owner('UPDATE auth.users SET two_factor_enabled = true WHERE id = $1', [userId]);
    },
    async banState(userId) {
      const r = await owner<{ banned: boolean; ban_reason: string | null }>(
        'SELECT banned, ban_reason FROM auth.users WHERE id = $1',
        [userId],
      );
      const row = r[0];
      return row === undefined ? null : { banned: row.banned, banReason: row.ban_reason };
    },
    async sessionRows(userId) {
      const r = await owner<{
        id: string;
        active_organization_id: string | null;
        mfa_level: string;
        step_up_at: Date | null;
      }>(
        `SELECT id, active_organization_id, mfa_level, step_up_at FROM auth.sessions
         WHERE user_id = $1 ORDER BY created_at, id`,
        [userId],
      );
      return r.map((x) => ({
        id: x.id,
        activeOrganizationId: x.active_organization_id,
        mfaLevel: x.mfa_level,
        stepUpAt: x.step_up_at,
      }));
    },
    async setPlatformRole(userId, role) {
      await owner('UPDATE auth.users SET platform_role = $2 WHERE id = $1', [userId, role]);
    },
    async setVerification(userId, status) {
      await owner('UPDATE auth.users SET verification_status = $2 WHERE id = $1', [userId, status]);
    },
    async insertOrg(name, kind) {
      const r = await owner<{ id: string }>(
        `INSERT INTO auth.organizations (name, slug, kind)
         VALUES ($1, 'test-' || replace(gen_random_uuid()::text, '-', ''), $2) RETURNING id`,
        [name, kind],
      );
      const id = r[0]?.id;
      if (id === undefined) throw new Error('büro oluşturulamadı');
      return id;
    },
    async addMember(orgId, userId, role, status = 'active') {
      const r = await owner<{ id: string }>(
        `INSERT INTO auth.members (organization_id, user_id, role, status)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgId, userId, role, status],
      );
      const id = r[0]?.id;
      if (id === undefined) throw new Error('üyelik oluşturulamadı');
      return id;
    },
    async grantSeats(orgId, seats) {
      const c = await pool('eda_owner').connect();
      try {
        await c.query('BEGIN');
        await withSeedRlsException(c, 'subscriptions', () =>
          c.query(
            `INSERT INTO app.subscriptions (org_id, plan_code, status, provider, seats)
             VALUES ($1, 'firm', 'active', 'manual', $2)`,
            [orgId, seats],
          ),
        );
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK');
        throw err;
      } finally {
        c.release();
      }
    },
    async setSeats(orgId, seats) {
      const c = await pool('eda_owner').connect();
      try {
        await c.query('BEGIN');
        await withSeedRlsException(c, 'subscriptions', () =>
          c.query(
            `UPDATE app.subscriptions SET seats = $2
             WHERE org_id = $1 AND status IN ('trialing', 'active', 'past_due')`,
            [orgId, seats],
          ),
        );
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK');
        throw err;
      } finally {
        c.release();
      }
    },
    async setMemberStatus(orgId, userId, status) {
      await owner(
        'UPDATE auth.members SET status = $3 WHERE organization_id = $1 AND user_id = $2',
        [orgId, userId, status],
      );
    },
    async setOrgSuspended(orgId, suspended) {
      await owner(
        `UPDATE auth.organizations SET suspended_at = CASE WHEN $2 THEN now() END WHERE id = $1`,
        [orgId, suspended],
      );
    },
    async memberCount(orgId) {
      const r = await owner<{ n: string }>(
        'SELECT count(*) AS n FROM auth.members WHERE organization_id = $1',
        [orgId],
      );
      return Number(r[0]?.n ?? '0');
    },
    async invitationRows(orgId) {
      return owner<{ id: string; email: string; role: string; status: string }>(
        `SELECT id, email, role, status FROM auth.invitations WHERE organization_id = $1
         ORDER BY created_at`,
        [orgId],
      );
    },
    async insertInvitation(orgId, email, role, inviterId) {
      const r = await owner<{ id: string }>(
        `INSERT INTO auth.invitations (organization_id, email, role, status, expires_at, inviter_id)
         VALUES ($1, $2, $3, 'pending', now() + interval '72 hours', $4) RETURNING id`,
        [orgId, email, role, inviterId],
      );
      const id = r[0]?.id;
      if (id === undefined) throw new Error('davet oluşturulamadı');
      return id;
    },
    async setInvitationStatus(id, status) {
      await owner('UPDATE auth.invitations SET status = $2 WHERE id = $1', [id, status]);
    },
    async makePartnerUser(userId, code) {
      const p = await owner<{ id: string }>(
        `INSERT INTO app.partners (code, name) VALUES ($1, 'Örnek Test Bayi') RETURNING id`,
        [code],
      );
      await owner(
        `INSERT INTO app.partner_members (partner_id, user_id, role) VALUES ($1, $2, 'partner_owner')`,
        [p[0]?.id, userId],
      );
    },
    async twoFactorEnabled(userId) {
      const r = await owner<{ v: boolean }>(
        'SELECT two_factor_enabled AS v FROM auth.users WHERE id = $1',
        [userId],
      );
      return r[0]?.v === true;
    },
    async passkeyCount(userId) {
      const r = await owner<{ n: string }>(
        'SELECT count(*) AS n FROM auth.passkeys WHERE user_id = $1',
        [userId],
      );
      return Number(r[0]?.n ?? '0');
    },
  };
  return {
    auth,
    async ownerQuery(sql, params) {
      return (await pool('eda_owner').query(sql, params as unknown[] | undefined)).rows;
    },
    async jobsQuery(sql, params) {
      return (await pool('eda_jobs').query(sql, params as unknown[] | undefined)).rows;
    },
    runner: (role) => createTenantRunner(pool(role)),
    async close() {
      await Promise.all([...pools.values()].map((p) => p.end()));
      pools.clear();
    },
  };
}
