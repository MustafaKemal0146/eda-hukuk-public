// Bireysel büro açılışı (042 §3.1 adım 3; 031 §3): kullanıcının hiç üyeliği yoksa önce `authDb`
// işleminde `auth.organizations` (`kind = 'individual'`) + `auth.members` (`owner`, `active`), ardından
// AYRI `withTenant` işleminde `app.org_settings` varsayılanları, `app.org_keys` (`key_version = 1`, DEK
// `kek_master` ile sarılı; 033 §4) ve `org.created` denetimi. Her adım idempotenttir: üyelik varsa
// yeni büro açılmaz; kullanıcının bireysel sahiplik bürosunun app satırları eksikse tamamlanır.
// Davetle gelen (üyeliği olan) kullanıcı için büro açılmaz (P04b).
import { randomBytes } from 'node:crypto';
import { wipe, wrapDek } from '@eda/crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { AppDbAccess, AuditWriter } from './audit.ts';
import { AUTH_TABLES, type AuthDb } from './auth-db.ts';

export interface KekMaterial {
  readonly kek: Buffer;
  readonly kekVersion: number;
}

export interface OrgBootstrapDeps {
  readonly db: AuthDb;
  readonly appDb: AppDbAccess;
  readonly kek: KekMaterial;
  readonly audit: AuditWriter;
}

const { organizations, members } = AUTH_TABLES;

/** Kullanıcının etkin üyelikleri (eski -> yeni). */
export async function activeMemberships(db: AuthDb, userId: string) {
  return db
    .select({ orgId: members.organizationId, role: members.role, createdAt: members.createdAt })
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.status, 'active')))
    .orderBy(asc(members.createdAt), asc(members.organizationId));
}

/** Bireysel büroyu açar veya tamamlar; büro kimliğini döndürür (üyelik başka büroda ise null). */
export async function ensureIndividualOrg(
  deps: OrgBootstrapDeps,
  user: { readonly id: string; readonly name: string },
): Promise<string | null> {
  const any = await deps.db
    .select({ orgId: members.organizationId, role: members.role, kind: organizations.kind })
    .from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .where(eq(members.userId, user.id))
    .orderBy(asc(members.createdAt));
  let orgId: string;
  if (any.length === 0) {
    orgId = await deps.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: user.name, slug: `bireysel-${user.id}`, kind: 'individual' })
        .returning({ id: organizations.id });
      if (org === undefined) throw new Error('büro oluşturulamadı');
      await tx
        .insert(members)
        .values({ organizationId: org.id, userId: user.id, role: 'owner', status: 'active' });
      return org.id;
    });
  } else {
    const own = any.find((m) => m.kind === 'individual' && m.role === 'owner');
    if (own === undefined) return null;
    orgId = own.orgId;
  }
  await completeAppRows(deps, orgId, user.id);
  return orgId;
}

async function completeAppRows(
  deps: OrgBootstrapDeps,
  orgId: string,
  userId: string,
): Promise<void> {
  const created = await deps.appDb.withTenant({ orgId, userId }, async (tx) => {
    const s = await tx.query(
      'INSERT INTO app.org_settings (org_id) VALUES ($1) ON CONFLICT (org_id) DO NOTHING',
      [orgId],
    );
    const has = await tx.query('SELECT 1 FROM app.org_keys WHERE org_id = $1 AND key_version = 1', [
      orgId,
    ]);
    if (has.rowCount === 0) {
      const dek = randomBytes(32);
      try {
        const wrapped = wrapDek(
          deps.kek.kek,
          { orgId, dekVersion: 1, kekVersion: deps.kek.kekVersion },
          dek,
        );
        await tx.query(
          `INSERT INTO app.org_keys (org_id, key_version, wrapped_dek, kek_version)
           VALUES ($1, 1, $2, $3)`,
          [orgId, wrapped, deps.kek.kekVersion],
        );
      } finally {
        wipe(dek);
      }
    }
    return (s.rowCount ?? 0) > 0;
  });
  if (created) {
    await deps.audit({
      action: 'org.created',
      userId,
      orgId,
      targetType: 'organization',
      targetId: orgId,
      metadata: { kind: 'individual' },
    });
  }
}
