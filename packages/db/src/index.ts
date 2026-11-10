// @eda/db genel yüzü (031 §4.1; 013 §10): yalnız kiracı sarmalayıcıları, havuz parametreli
// çalıştırıcı (seed/fixture), auth salt-okur fonksiyonları (auth-read.ts) ve tipler. Rol havuzları
// alt yollardadır: `@eda/db/auth` (authDb), `@eda/db/admin` (adminDb/withAdmin), `@eda/db/jobs`
// (jobsDb). Ham `Pool`/`drizzle()` örneği dışa açılmaz; `pg` ve `drizzle-orm/node-postgres`
// uygulamalarda içe aktarılmaz (031 §4.5). Varsayılan havuz
// (`PG_USER` = eda_app | eda_worker) ilk çağrıda env'den kurulur.
import type { MemberRole } from '@eda/contracts/enums';
import type pg from 'pg';
import { loadRuntimePoolConfig } from './config/load.ts';
import { createPool } from './pool.ts';
import {
  createTenantRunner,
  type NoTenantReason,
  type NoTenantTx,
  type TenantCtx,
  type TenantRunner,
  type TenantTx,
  type TxOptions,
  type UserCtx,
  type UserTx,
} from './tenant.ts';

export {
  type ActiveMembership,
  type EmailRecipient,
  findActiveMembership,
  getEmailRecipient,
  getInvitationRecipient,
  getOrganizationSummary,
  getSelfUser,
  type InvitationRecipient,
  listMembershipDetailsOfUser,
  listMembershipsOfUser,
  listOrgMembers,
  type MembershipDetail,
  type OrganizationSummary,
  type OrgMemberRow,
  type SelfUser,
  type UserMembership,
} from './auth-read.ts';
export type { LegalCase, LegalDocument, StoredFile } from './schema/index.ts';
export {
  createTenantRunner,
  NO_TENANT_REASONS,
  type NoTenantReason,
  type NoTenantTx,
  type TenantCtx,
  TenantNestingError,
  type TenantRunner,
  type TenantRunnerOptions,
  type TenantTx,
  TenantTxClosedError,
  type TxOptions,
  type UserCtx,
  type UserTx,
} from './tenant.ts';

let defaultRunner: TenantRunner | undefined;
let defaultPool: pg.Pool | undefined;

function runner(): TenantRunner {
  if (defaultRunner === undefined) {
    defaultPool = createPool('app', loadRuntimePoolConfig());
    defaultRunner = createTenantRunner(defaultPool);
  }
  return defaultRunner;
}

/** Kiracı bağlamlı işlem (031 §4.1): `app.org_id` + `app.user_id`; üye değilse ORG_NOT_MEMBER. */
export function withTenant<T>(
  ctx: TenantCtx,
  fn: (tx: TenantTx, role: MemberRole) => Promise<T>,
  opts?: TxOptions,
): Promise<T> {
  return runner().withTenant(ctx, fn, opts);
}

/** Yalnız kullanıcı bağlamı (031 §4.4): lawyer_profiles, push_subscriptions, tercihler. */
export function withUserScope<T>(
  ctx: UserCtx,
  fn: (tx: UserTx) => Promise<T>,
  opts?: TxOptions,
): Promise<T> {
  return runner().withUserScope(ctx, fn, opts);
}

/** Bağlamsız (031 §4.4): K tabloları, corpus, webhook ve kimlik öncesi denetim; E tablolar 0 satır. */
export function withNoTenant<T>(
  reason: NoTenantReason,
  fn: (tx: NoTenantTx) => Promise<T>,
): Promise<T> {
  return runner().withNoTenant(reason, fn);
}

/** Varsayılan havuzu kapatır (süreç kapanışı; drenaj sonrası). */
export async function closeDefaultPool(): Promise<void> {
  const pool = defaultPool;
  defaultPool = undefined;
  defaultRunner = undefined;
  await pool?.end();
}
