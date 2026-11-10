// RLS izolasyon dünyası (031 §12, 032 §12; KK-P03c-14). Büro A ve B (`firm`); kullanıcılar ve veriler
// 031 §12 "Dünya" paragrafıyla birebir adlandırılır. Her çağrı yeni (rastgele) worldKey ile tekildir;
// aynı veritabanında ikinci kez kurulduğunda çakışma olmaz. `CREATE DATABASE … TEMPLATE` kullanılmaz
// (rol ayarları taşınmaz). Yazımlar factories.ts üzerinden: auth eda_owner istemcisiyle, app satırları
// eda_owner havuzlu createTenantRunner ile politikalardan geçerek.
import type pg from 'pg';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { makePool } from './db.ts';
import {
  addCaseMember,
  addMember,
  bootstrapOrg,
  createAuditRow,
  createCalendarEvent,
  createCase,
  createCaseParty,
  createConversation,
  createDocument,
  createFile,
  createFileChunk,
  createMessage,
  createOrg,
  createOrgTemplate,
  createPartnerUser,
  createPlatformTemplate,
  createUser,
  createUserPreferences,
  type FactoryCtx,
  removeMember,
} from './factories.ts';
import { newWorldKey } from './ids.ts';
import { grantSeats } from './seats.ts';

export interface RlsWorld {
  readonly key: string;
  readonly ctx: FactoryCtx;
  readonly orgA: string;
  readonly orgB: string;
  readonly users: {
    readonly a_owner: string;
    readonly a_admin: string;
    readonly a_senior: string;
    readonly a_lawyer1: string;
    readonly a_lawyer2: string;
    readonly a_trainee: string;
    readonly a_assistant: string;
    readonly a_removed: string;
    readonly a_suspended: string;
    readonly b_owner: string;
    readonly p_partner: string;
    readonly s_admin: string;
  };
  readonly case_A_org: string;
  readonly case_A_restricted: string;
  readonly case_B: string;
  readonly conv_l1_private: string;
  readonly conv_l1_restricted_shared: string;
  readonly conv_trainee: string;
  readonly conv_senior_private: string;
  readonly conv_removed: string;
  readonly conv_suspended: string;
  readonly conv_B: string;
  readonly doc_trainee: string;
  readonly doc_restricted: string;
  readonly file_inbox_l1: string;
  readonly file_restricted: string;
  readonly file_B: string;
  readonly template_platform: string;
  readonly template_A: string;
  readonly template_B: string;
}

/** 031 §12 dünyasını kurar (KK-P03c-14). */
export async function createRlsWorld(owner: pg.Client, runner: TenantRunner): Promise<RlsWorld> {
  const key = newWorldKey();
  const ctx: FactoryCtx = { owner, runner, key };

  const orgA = await createOrg(ctx, 'A');
  const orgB = await createOrg(ctx, 'B');
  await grantSeats(owner, orgA);
  const u = {
    a_owner: await createUser(ctx, 'a_owner'),
    a_admin: await createUser(ctx, 'a_admin'),
    a_senior: await createUser(ctx, 'a_senior'),
    a_lawyer1: await createUser(ctx, 'a_lawyer1'),
    a_lawyer2: await createUser(ctx, 'a_lawyer2'),
    a_trainee: await createUser(ctx, 'a_trainee'),
    a_assistant: await createUser(ctx, 'a_assistant'),
    a_removed: await createUser(ctx, 'a_removed'),
    a_suspended: await createUser(ctx, 'a_suspended'),
    b_owner: await createUser(ctx, 'b_owner'),
    p_partner: await createPartnerUser(ctx, 'p_partner'),
    s_admin: await createUser(ctx, 's_admin', { platformRole: 'super_admin' }),
  };
  await addMember(ctx, orgA, u.a_owner, 'owner');
  await addMember(ctx, orgA, u.a_admin, 'admin');
  await addMember(ctx, orgA, u.a_senior, 'senior_lawyer');
  await addMember(ctx, orgA, u.a_lawyer1, 'lawyer');
  await addMember(ctx, orgA, u.a_lawyer2, 'lawyer');
  await addMember(ctx, orgA, u.a_trainee, 'trainee');
  await addMember(ctx, orgA, u.a_assistant, 'assistant');
  await addMember(ctx, orgA, u.a_removed, 'lawyer');
  await addMember(ctx, orgA, u.a_suspended, 'lawyer');
  await addMember(ctx, orgB, u.b_owner, 'owner');
  await bootstrapOrg(ctx, orgA, u.a_owner);
  await bootstrapOrg(ctx, orgB, u.b_owner);

  const case_A_org = await createCase(ctx, {
    name: 'case_A_org',
    orgId: orgA,
    userId: u.a_lawyer1,
  });
  const case_A_restricted = await createCase(ctx, {
    name: 'case_A_restricted',
    orgId: orgA,
    userId: u.a_lawyer1,
    visibility: 'restricted',
  });
  for (const member of [u.a_lawyer1, u.a_lawyer2]) {
    await addCaseMember(ctx, {
      orgId: orgA,
      caseId: case_A_restricted,
      actorId: u.a_lawyer1,
      userId: member,
    });
  }
  const case_B = await createCase(ctx, { name: 'case_B', orgId: orgB, userId: u.b_owner });

  const conv_l1_private = await createConversation(ctx, {
    name: 'conv_l1_private',
    orgId: orgA,
    userId: u.a_lawyer1,
  });
  const conv_l1_restricted_shared = await createConversation(ctx, {
    name: 'conv_l1_restricted_shared',
    orgId: orgA,
    userId: u.a_lawyer1,
    caseId: case_A_restricted,
    sharedWithCase: true,
  });
  const conv_trainee = await createConversation(ctx, {
    name: 'conv_trainee',
    orgId: orgA,
    userId: u.a_trainee,
  });
  const conv_senior_private = await createConversation(ctx, {
    name: 'conv_senior_private',
    orgId: orgA,
    userId: u.a_senior,
  });
  const conv_removed = await createConversation(ctx, {
    name: 'conv_removed',
    orgId: orgA,
    userId: u.a_removed,
  });
  const conv_suspended = await createConversation(ctx, {
    name: 'conv_suspended',
    orgId: orgA,
    userId: u.a_suspended,
  });
  const conv_B = await createConversation(ctx, {
    name: 'conv_B',
    orgId: orgB,
    userId: u.b_owner,
    caseId: case_B,
  });
  for (const [userId, conversationId, orgId] of [
    [u.a_lawyer1, conv_l1_private, orgA],
    [u.a_lawyer1, conv_l1_restricted_shared, orgA],
    [u.a_trainee, conv_trainee, orgA],
    [u.a_senior, conv_senior_private, orgA],
    [u.b_owner, conv_B, orgB],
  ] as const) {
    await createMessage(ctx, { orgId, userId, conversationId });
  }

  const doc_trainee = await createDocument(ctx, {
    name: 'doc_trainee',
    orgId: orgA,
    ownerId: u.a_trainee,
  });
  const doc_restricted = await createDocument(ctx, {
    name: 'doc_restricted',
    orgId: orgA,
    ownerId: u.a_lawyer1,
    caseId: case_A_restricted,
  });
  await createDocument(ctx, { name: 'doc_B', orgId: orgB, ownerId: u.b_owner, caseId: case_B });

  const file_inbox_l1 = await createFile(ctx, {
    name: 'file_inbox_l1',
    orgId: orgA,
    userId: u.a_lawyer1,
  });
  const file_restricted = await createFile(ctx, {
    name: 'file_restricted',
    orgId: orgA,
    userId: u.a_lawyer1,
    caseId: case_A_restricted,
  });
  const file_B = await createFile(ctx, {
    name: 'file_B',
    orgId: orgB,
    userId: u.b_owner,
    caseId: case_B,
  });
  await createFileChunk(ctx, {
    orgId: orgA,
    userId: u.a_lawyer1,
    fileId: file_restricted,
    caseId: case_A_restricted,
  });
  await createFileChunk(ctx, { orgId: orgB, userId: u.b_owner, fileId: file_B, caseId: case_B });
  await createCaseParty(ctx, { orgId: orgA, userId: u.a_lawyer1, caseId: case_A_restricted });
  await createCaseParty(ctx, { orgId: orgA, userId: u.a_lawyer1, caseId: case_A_org });
  await createCaseParty(ctx, { orgId: orgB, userId: u.b_owner, caseId: case_B });
  await createCalendarEvent(ctx, { orgId: orgA, userId: u.a_lawyer1, caseId: case_A_org });
  await createCalendarEvent(ctx, { orgId: orgB, userId: u.b_owner, caseId: case_B });

  const appPool = makePool('eda_app', 1);
  try {
    const asApp = createTenantRunner(appPool);
    await createAuditRow(asApp, { orgId: orgA, userId: u.a_owner });
    await createAuditRow(asApp, { orgId: orgB, userId: u.b_owner });
  } finally {
    await appPool.end();
  }
  await createUserPreferences(ctx, u.a_lawyer1);
  await createUserPreferences(ctx, u.b_owner);
  const template_platform = await createPlatformTemplate(ctx);
  const template_A = await createOrgTemplate(ctx, { orgId: orgA, userId: u.a_owner });
  const template_B = await createOrgTemplate(ctx, { orgId: orgB, userId: u.b_owner });

  // Üyeliği silinmiş ve askıdaki üye: verileri yukarıda etkin üyeyken oluştu.
  await removeMember(ctx, orgA, u.a_removed);
  await owner.query(
    `UPDATE auth.members SET status = 'suspended' WHERE organization_id = $1 AND user_id = $2`,
    [orgA, u.a_suspended],
  );

  return {
    key,
    ctx,
    orgA,
    orgB,
    users: u,
    case_A_org,
    case_A_restricted,
    case_B,
    conv_l1_private,
    conv_l1_restricted_shared,
    conv_trainee,
    conv_senior_private,
    conv_removed,
    conv_suspended,
    conv_B,
    doc_trainee,
    doc_restricted,
    file_inbox_l1,
    file_restricted,
    file_B,
    template_platform,
    template_A,
    template_B,
  };
}
