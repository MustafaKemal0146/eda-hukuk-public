// Test fabrikaları (032 §12): kimlik tabloları (auth, RLS'siz) eda_owner istemcisiyle; app satırları
// eda_owner havuzlu createTenantRunner ile, yani uygulamayla AYNI politikalardan geçerek yazılır
// (031 §6.1). Kimlikler deterministiktir: fid(worldKey, ad) = uuidv5 (ids.ts). Fabrikalar yalnız ekler;
// ekli tablolar silmeye izin vermediği için temizlik yapılmaz, her dünya kendi anahtarıyla tekildir.
// Veri sentetiktir ("Örnek veri"); gerçek kişi, künye, madde yok.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { TenantRunner } from '../../src/tenant.ts';
import { fid, shortKey } from './ids.ts';
import { syntheticChunk, syntheticParts, syntheticTitle } from './synthetic-text.ts';

/** Fabrika bağlamı: sahip istemcisi (auth yazımı), sahip havuzlu çalıştırıcı, dünya anahtarı. */
export interface FactoryCtx {
  readonly owner: pg.Client;
  readonly runner: TenantRunner;
  readonly key: string;
}

type PlatformRole = 'user' | 'support' | 'super_admin';
type MemberRole = 'owner' | 'admin' | 'senior_lawyer' | 'lawyer' | 'trainee' | 'assistant';

let seq = 0;
const next = (): number => {
  seq += 1;
  return seq;
};

export async function createUser(
  ctx: FactoryCtx,
  name: string,
  opts: { readonly platformRole?: PlatformRole } = {},
): Promise<string> {
  const id = fid(ctx.key, `user:${name}`);
  const local = name.replaceAll(/[^a-z0-9]/gi, '').toLowerCase();
  await ctx.owner.query(
    `INSERT INTO auth.users (id, name, email, verification_status, platform_role)
     VALUES ($1, $2, $3, 'verified', $4)`,
    [id, `Örnek ${name}`, `${local}.${shortKey(ctx.key)}@ornek.test`, opts.platformRole ?? 'user'],
  );
  return id;
}

export async function createOrg(ctx: FactoryCtx, name: string): Promise<string> {
  const id = fid(ctx.key, `org:${name}`);
  const slug = `${name.replaceAll(/[^a-z0-9]/gi, '').toLowerCase()}-${shortKey(ctx.key)}`;
  await ctx.owner.query(
    `INSERT INTO auth.organizations (id, name, slug, kind) VALUES ($1, $2, $3, 'firm')`,
    [id, `Örnek Büro ${name}`, slug],
  );
  return id;
}

export async function addMember(
  ctx: FactoryCtx,
  orgId: string,
  userId: string,
  role: MemberRole,
  status: 'active' | 'suspended' = 'active',
): Promise<void> {
  await ctx.owner.query(
    'INSERT INTO auth.members (organization_id, user_id, role, status) VALUES ($1, $2, $3, $4)',
    [orgId, userId, role, status],
  );
}

/** Üyeliği siler (031 §12 `a_removed`). */
export async function removeMember(ctx: FactoryCtx, orgId: string, userId: string): Promise<void> {
  await ctx.owner.query('DELETE FROM auth.members WHERE organization_id = $1 AND user_id = $2', [
    orgId,
    userId,
  ]);
}

/** Büro ayarı ve etkin DEK (key_version 1); files FK hedefi. Sahip üye olarak yazar. */
export async function bootstrapOrg(ctx: FactoryCtx, orgId: string, ownerId: string): Promise<void> {
  await ctx.runner.withTenant({ orgId, userId: ownerId }, async (tx) => {
    await tx.query('INSERT INTO app.org_settings (org_id) VALUES ($1)', [orgId]);
    await tx.query(
      'INSERT INTO app.org_keys (org_id, key_version, wrapped_dek, kek_version) VALUES ($1, 1, $2, 1)',
      [orgId, randomBytes(60)],
    );
  });
}

export async function createCase(
  ctx: FactoryCtx,
  args: {
    readonly name: string;
    readonly orgId: string;
    readonly userId: string;
    readonly visibility?: 'org' | 'restricted';
  },
): Promise<string> {
  const id = fid(ctx.key, `case:${args.name}`);
  const t = syntheticTitle(next());
  await ctx.runner.withTenant({ orgId: args.orgId, userId: args.userId }, (tx) =>
    tx.query(
      `INSERT INTO app.cases (id, org_id, owner_id, title, title_fold, visibility, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $3)`,
      [id, args.orgId, args.userId, t.text, t.fold, args.visibility ?? 'org'],
    ),
  );
  return id;
}

/** Dava ekibine üye ekler; `actorId` davaya erişimi olan kullanıcıdır. */
export async function addCaseMember(
  ctx: FactoryCtx,
  args: {
    readonly orgId: string;
    readonly caseId: string;
    readonly actorId: string;
    readonly userId: string;
  },
): Promise<void> {
  await ctx.runner.withTenant({ orgId: args.orgId, userId: args.actorId }, (tx) =>
    tx.query(
      'INSERT INTO app.case_members (org_id, case_id, user_id, added_by) VALUES ($1, $2, $3, $4)',
      [args.orgId, args.caseId, args.userId, args.actorId],
    ),
  );
}

export async function removeCaseMember(
  ctx: FactoryCtx,
  args: {
    readonly orgId: string;
    readonly caseId: string;
    readonly actorId: string;
    readonly userId: string;
  },
): Promise<void> {
  await ctx.runner.withTenant({ orgId: args.orgId, userId: args.actorId }, (tx) =>
    tx.query('DELETE FROM app.case_members WHERE case_id = $1 AND user_id = $2', [
      args.caseId,
      args.userId,
    ]),
  );
}

export async function createConversation(
  ctx: FactoryCtx,
  args: {
    readonly name: string;
    readonly orgId: string;
    readonly userId: string;
    readonly caseId?: string | null;
    readonly sharedWithCase?: boolean;
  },
): Promise<string> {
  const id = fid(ctx.key, `conv:${args.name}`);
  const caseId = args.caseId ?? null;
  const t = syntheticTitle(next());
  await ctx.runner.withTenant({ orgId: args.orgId, userId: args.userId }, (tx) =>
    tx.query(
      `INSERT INTO app.conversations (id, org_id, user_id, case_id, data_class, shared_with_case, title, title_fold)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        args.orgId,
        args.userId,
        caseId,
        caseId === null ? 'client' : 'case',
        args.sharedWithCase ?? false,
        t.text,
        t.fold,
      ],
    ),
  );
  return id;
}

export async function createMessage(
  ctx: FactoryCtx,
  args: { readonly orgId: string; readonly userId: string; readonly conversationId: string },
): Promise<string> {
  return ctx.runner.withTenant({ orgId: args.orgId, userId: args.userId }, async (tx) => {
    const res = await tx.query<{ id: string }>(
      `INSERT INTO app.messages (org_id, conversation_id, role, user_id, parts)
       VALUES ($1, $2, 'user', $3, $4::jsonb) RETURNING id`,
      [args.orgId, args.conversationId, args.userId, syntheticParts(next())],
    );
    return res.rows[0]?.id ?? '';
  });
}

/** Sentetik evrak satırı (nesne deposu yok; yalnız meta veri). `caseId` yoksa inbox. */
export async function createFile(
  ctx: FactoryCtx,
  args: {
    readonly name: string;
    readonly orgId: string;
    readonly userId: string;
    readonly caseId?: string | null;
  },
): Promise<string> {
  const id = fid(ctx.key, `file:${args.name}`);
  const caseId = args.caseId ?? null;
  await ctx.runner.withTenant({ orgId: args.orgId, userId: args.userId }, (tx) =>
    tx.query(
      `INSERT INTO app.files (id, org_id, case_id, origin, uploaded_by, original_name, name_fold, file_type,
         mime_type, size_bytes, sha256, object_key, key_version, wrap_dek_version, wrapped_file_key,
         inbox_expires_at)
       VALUES ($1, $2, $3, $4, $5, 'ornek-veri.pdf', 'ornek-veri.pdf', 'pdf', 'application/pdf', 10, $6,
               $7, 1, 1, $8, CASE WHEN $3::uuid IS NULL THEN now() + interval '30 days' END)`,
      [
        id,
        args.orgId,
        caseId,
        caseId === null ? 'chat_attachment' : 'case_upload',
        args.userId,
        randomBytes(32),
        `org/${args.orgId}/test/${id}`,
        randomBytes(60),
      ],
    ),
  );
  return id;
}

/** Evrak parçası (`case_id` denormalize; 030). */
export async function createFileChunk(
  ctx: FactoryCtx,
  args: {
    readonly orgId: string;
    readonly userId: string;
    readonly fileId: string;
    readonly caseId: string | null;
  },
): Promise<void> {
  const n = next();
  const c = syntheticChunk(n);
  await ctx.runner.withTenant({ orgId: args.orgId, userId: args.userId }, (tx) =>
    tx.query(
      `INSERT INTO app.file_chunks (org_id, file_id, case_id, chunk_no, text, text_norm, token_count)
       VALUES ($1, $2, $3, $4, $5, $6, 4)`,
      [args.orgId, args.fileId, args.caseId, n, c.text, c.fold],
    ),
  );
}

export async function createDocument(
  ctx: FactoryCtx,
  args: {
    readonly name: string;
    readonly orgId: string;
    readonly ownerId: string;
    readonly caseId?: string | null;
  },
): Promise<string> {
  const id = fid(ctx.key, `doc:${args.name}`);
  const t = syntheticTitle(next());
  await ctx.runner.withTenant({ orgId: args.orgId, userId: args.ownerId }, (tx) =>
    tx.query(
      `INSERT INTO app.documents (id, org_id, owner_id, case_id, kind, title, title_fold, draft)
       VALUES ($1, $2, $3, $4, 'petition', $5, $6, '{}'::jsonb)`,
      [id, args.orgId, args.ownerId, args.caseId ?? null, t.text, t.fold],
    ),
  );
  return id;
}

/** Tüzel kişi taraf (kimlik numarası yok; sentetik ad). */
export async function createCaseParty(
  ctx: FactoryCtx,
  args: { readonly orgId: string; readonly userId: string; readonly caseId: string },
): Promise<void> {
  await ctx.runner.withTenant({ orgId: args.orgId, userId: args.userId }, (tx) =>
    tx.query(
      `INSERT INTO app.case_parties (org_id, case_id, role, kind, entity_name)
       VALUES ($1, $2, 'plaintiff', 'entity', 'Örnek veri şirketi')`,
      [args.orgId, args.caseId],
    ),
  );
}

export async function createCalendarEvent(
  ctx: FactoryCtx,
  args: { readonly orgId: string; readonly userId: string; readonly caseId?: string | null },
): Promise<void> {
  await ctx.runner.withTenant({ orgId: args.orgId, userId: args.userId }, (tx) =>
    tx.query(
      `INSERT INTO app.calendar_events (org_id, user_id, case_id, type, title, starts_at, created_by)
       VALUES ($1, $2, $3, 'meeting', 'Örnek veri toplantı', now() + interval '1 day', $2)`,
      [args.orgId, args.userId, args.caseId ?? null],
    ),
  );
}

/**
 * Denetim satırı yalnız `app.audit_append` ile (031 §8.1); büro ve aktör oturum bağından gelir.
 * EXECUTE yalnız çalışma zamanı rollerindedir: `appRunner` eda_app havuzlu çalıştırıcıdır.
 */
export async function createAuditRow(
  appRunner: TenantRunner,
  args: { readonly orgId: string; readonly userId: string },
): Promise<string> {
  return appRunner.withTenant({ orgId: args.orgId, userId: args.userId }, async (tx) => {
    const res = await tx.query<{ id: string }>(
      `SELECT app.audit_append('org.settings.changed', 'org', 'org_settings', $1, '{}'::jsonb, NULL) AS id`,
      [args.orgId],
    );
    return res.rows[0]?.id ?? '';
  });
}

/** Büro şablonu (OA yazar). */
export async function createOrgTemplate(
  ctx: FactoryCtx,
  args: { readonly orgId: string; readonly userId: string },
): Promise<string> {
  return ctx.runner.withTenant({ orgId: args.orgId, userId: args.userId }, async (tx) => {
    const res = await tx.query<{ id: string }>(
      `INSERT INTO app.templates (org_id, kind, title, content, created_by)
       VALUES ($1, 'petition', 'Örnek veri büro şablonu', '{}'::jsonb, $2) RETURNING id`,
      [args.orgId, args.userId],
    );
    return res.rows[0]?.id ?? '';
  });
}

/** Platform şablonu (`org_id NULL`): yalnız eda_owner `templates_platform_seed` politikasıyla. */
export async function createPlatformTemplate(ctx: FactoryCtx): Promise<string> {
  const res = await ctx.owner.query<{ id: string }>(
    `INSERT INTO app.templates (org_id, kind, title, content)
     VALUES (NULL, 'petition', 'Örnek veri platform şablonu', '{}'::jsonb) RETURNING id`,
  );
  return res.rows[0]?.id ?? '';
}

/** Kullanıcı kapsamlı tercih satırı (withUserScope). */
export async function createUserPreferences(ctx: FactoryCtx, userId: string): Promise<void> {
  await ctx.runner.withUserScope({ userId }, (tx) =>
    tx.query("INSERT INTO app.user_preferences (user_id, terms_version) VALUES ($1, 'v1')", [
      userId,
    ]),
  );
}

/** Bayi ve bayi kullanıcısı (031 §12 `p_partner`; büro üyeliği yok). */
export async function createPartnerUser(ctx: FactoryCtx, name: string): Promise<string> {
  const userId = await createUser(ctx, name);
  const partner = await ctx.owner.query<{ id: string }>(
    `INSERT INTO app.partners (code, name) VALUES ($1, 'Örnek Bayi') RETURNING id`,
    [`T${shortKey(ctx.key).slice(0, 8).toUpperCase()}`],
  );
  await ctx.owner.query(
    `INSERT INTO app.partner_members (partner_id, user_id, role) VALUES ($1, $2, 'partner_owner')`,
    [partner.rows[0]?.id, userId],
  );
  return userId;
}
