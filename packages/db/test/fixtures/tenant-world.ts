// P03b duman dünyası (031 §12'nin küçük alt kümesi; tam rls-world P03c'dedir): iki büro, büro başına
// kullanıcılar ve birer dava. Kimlik tabloları (auth, RLS'siz) eda_owner istemcisiyle; app satırları
// eda_owner havuzlu createTenantRunner ile aynı politikalardan geçerek yazılır (031 §6.1, 032 §11.3).
// Veri sentetiktir ("Örnek veri"); her dünya rastgele anahtarla tekildir, temizlik gerekmez.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { TenantRunner } from '../../src/tenant.ts';
import { newWorldKey, shortKey } from './ids.ts';
import { grantSeats } from './seats.ts';

export interface TenantWorld {
  readonly key: string;
  readonly orgA: string;
  readonly orgB: string;
  readonly aOwner: string;
  readonly aAdmin: string;
  readonly aLawyer1: string;
  readonly aLawyer2: string;
  readonly bOwner: string;
  readonly caseA: string;
  readonly caseB: string;
}

export async function insertUser(owner: pg.Client, key: string, name: string): Promise<string> {
  const res = await owner.query<{ id: string }>(
    `INSERT INTO auth.users (name, email, verification_status) VALUES ($1, $2, 'verified') RETURNING id`,
    [name, `${name.replaceAll(/[^a-z0-9]/gi, '').toLowerCase()}.${key}@ornek.test`],
  );
  return res.rows[0]?.id ?? '';
}

export async function insertOrg(owner: pg.Client, key: string, name: string): Promise<string> {
  const res = await owner.query<{ id: string }>(
    `INSERT INTO auth.organizations (name, slug, kind) VALUES ($1, $2, 'firm') RETURNING id`,
    [name, `${name.replaceAll(/[^a-z0-9]/gi, '').toLowerCase()}-${key}`],
  );
  return res.rows[0]?.id ?? '';
}

export async function addMember(
  owner: pg.Client,
  orgId: string,
  userId: string,
  role: string,
  status = 'active',
): Promise<void> {
  await owner.query(
    'INSERT INTO auth.members (organization_id, user_id, role, status) VALUES ($1, $2, $3, $4)',
    [orgId, userId, role, status],
  );
}

/** Büro ayarı ve etkin DEK (key_version 1); files/document_exports FK hedefi. */
async function bootstrapOrg(runner: TenantRunner, orgId: string, ownerId: string): Promise<void> {
  await runner.withTenant({ orgId, userId: ownerId }, async (tx) => {
    await tx.query('INSERT INTO app.org_settings (org_id) VALUES ($1)', [orgId]);
    await tx.query(
      `INSERT INTO app.org_keys (org_id, key_version, wrapped_dek, kek_version) VALUES ($1, 1, $2, 1)`,
      [orgId, randomBytes(60)],
    );
  });
}

export async function insertCase(
  runner: TenantRunner,
  orgId: string,
  userId: string,
  opts: { readonly visibility?: 'org' | 'restricted'; readonly title?: string } = {},
): Promise<string> {
  return runner.withTenant({ orgId, userId }, async (tx) => {
    const title = opts.title ?? 'Örnek veri dava';
    const res = await tx.query<{ id: string }>(
      `INSERT INTO app.cases (org_id, owner_id, title, title_fold, visibility, created_by)
       VALUES ($1, $2, $3, $4, $5, $2) RETURNING id`,
      [orgId, userId, title, 'ornek veri dava', opts.visibility ?? 'org'],
    );
    return res.rows[0]?.id ?? '';
  });
}

let fileSeq = 0;
/** Sentetik evrak satırı (nesne deposu yok; yalnız meta veri). `caseId` yoksa inbox. */
export async function insertFile(
  runner: TenantRunner,
  orgId: string,
  userId: string,
  caseId: string | null,
): Promise<string> {
  fileSeq += 1;
  return runner.withTenant({ orgId, userId }, async (tx) => {
    const res = await tx.query<{ id: string }>(
      `INSERT INTO app.files (org_id, case_id, origin, uploaded_by, original_name, name_fold, file_type,
         mime_type, size_bytes, sha256, object_key, key_version, wrap_dek_version, wrapped_file_key,
         inbox_expires_at)
       VALUES ($1, $2, $3, $4, 'ornek-veri.pdf', 'ornek-veri.pdf', 'pdf', 'application/pdf', 10, $5, $6,
               1, 1, $7, CASE WHEN $2::uuid IS NULL THEN now() + interval '30 days' END)
       RETURNING id`,
      [
        orgId,
        caseId,
        caseId === null ? 'chat_attachment' : 'case_upload',
        userId,
        randomBytes(32),
        `org/${orgId}/test/${fileSeq}-${randomBytes(4).toString('hex')}`,
        randomBytes(60),
      ],
    );
    return res.rows[0]?.id ?? '';
  });
}

export async function insertConversation(
  runner: TenantRunner,
  orgId: string,
  userId: string,
  caseId: string | null = null,
): Promise<string> {
  return runner.withTenant({ orgId, userId }, async (tx) => {
    const res = await tx.query<{ id: string }>(
      `INSERT INTO app.conversations (org_id, user_id, case_id, data_class, title)
       VALUES ($1, $2, $3, $4, 'Örnek veri sohbet') RETURNING id`,
      [orgId, userId, caseId, caseId === null ? 'client' : 'case'],
    );
    return res.rows[0]?.id ?? '';
  });
}

/** İki büro (A: owner, admin, iki avukat; B: owner) ve birer `org` görünürlüklü dava. */
export async function createTenantWorld(
  owner: pg.Client,
  runner: TenantRunner,
): Promise<TenantWorld> {
  const key = shortKey(newWorldKey());
  const orgA = await insertOrg(owner, key, 'Örnek Büro A');
  const orgB = await insertOrg(owner, key, 'Örnek Büro B');
  await grantSeats(owner, orgA);
  const aOwner = await insertUser(owner, key, 'aowner');
  const aAdmin = await insertUser(owner, key, 'aadmin');
  const aLawyer1 = await insertUser(owner, key, 'alawyer1');
  const aLawyer2 = await insertUser(owner, key, 'alawyer2');
  const bOwner = await insertUser(owner, key, 'bowner');
  await addMember(owner, orgA, aOwner, 'owner');
  await addMember(owner, orgA, aAdmin, 'admin');
  await addMember(owner, orgA, aLawyer1, 'lawyer');
  await addMember(owner, orgA, aLawyer2, 'lawyer');
  await addMember(owner, orgB, bOwner, 'owner');
  await bootstrapOrg(runner, orgA, aOwner);
  await bootstrapOrg(runner, orgB, bOwner);
  const caseA = await insertCase(runner, orgA, aLawyer1);
  const caseB = await insertCase(runner, orgB, bOwner);
  return { key, orgA, orgB, aOwner, aAdmin, aLawyer1, aLawyer2, bOwner, caseA, caseB };
}
