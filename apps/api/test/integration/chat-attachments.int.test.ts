// @tk TK-04 TK-05 TK-13
// P21 ilk dilimi: sohbet eki uçtan uca DB yolu (gerçek PostgreSQL, RLS açık). Yüklemenin
// yazdığı `files` satırı -> worker çıkarma adımı (`finishExtract`, `eda_worker`) -> tur (`runTurn`,
// `PgChatPersistence`, `eda_app`) -> modele giden bağlam. Kiracı/kullanıcı izolasyonu, K3 bağlama,
// durum kapıları ve `message_sources` kökeni.
//  KK-P21-dosya-5 yükle -> çıkar -> bağlam      KK-P21-dosya-6 izolasyon ve sohbet bağı
//  KK-P21-dosya-7 durum kapıları (fail-closed)  KK-P21-dosya-8 kaynak kaydı (case_file, user)
import { randomBytes, randomUUID } from 'node:crypto';
import { AiCatalog, createGateway, type Gateway, loadBundledFixture } from '@eda/ai';
import { AppError } from '@eda/contracts/errors';
import { generateFileKey, wrapDek } from '@eda/crypto';
import { AI_CATALOG_SEED } from '@eda/db/ai-catalog';
import { finishExtract } from '@eda/db/files';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { ModelMessage } from 'ai';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ActiveTurns } from '../../src/chat/persistence.ts';
import { type ChatDeps, runTurn } from '../../src/chat/turn.ts';
import { uuidv7 } from '../../src/middleware/request-id.ts';
import { createChatAttachments } from '../../src/services/chat/attachments.ts';
import { PgChatPersistence } from '../../src/services/chat/pg-persistence.ts';

const KIRA =
  'ÖRNEK KİRA SÖZLEŞMESİ\nAylık kira bedeli 27.500 TL olup her ayın beşinci günü ödenir.\n\nMadde 7 - Fesih: üç ay önceden bildirim.';
const NAME_MARK = `ADSOYAD-${randomUUID().slice(0, 8)}`;

let db: TestingDb;
interface Person {
  readonly id: string;
  readonly org: string;
}
const w = {} as { a1: Person; a2: Person; b1: Person };
const inOrg = <T>(p: Person, fn: Parameters<ReturnType<TestingDb['runner']>['withTenant']>[1]) =>
  db.runner('eda_app').withTenant({ orgId: p.org, userId: p.id }, fn) as Promise<T>;

async function person(org: string, tag: string): Promise<Person> {
  const id = await db.auth.insertUser({
    name: `Örnek ${tag}`,
    email: `${tag}.${randomUUID().slice(0, 8)}@ornek.test`,
    emailVerified: true,
    verificationStatus: 'verified',
  });
  await db.auth.addMember(org, id, 'lawyer');
  return { id, org };
}

/** Yükleme hattının yazdığı biçimde inbox eki (nesne bu testte okunmaz). */
async function uploaded(
  p: Person,
  o: { status?: string; scanned?: boolean; originId?: string | null } = {},
): Promise<string> {
  const id = randomUUID();
  await inOrg(p, (tx) =>
    tx.query(
      `INSERT INTO app.files (id, org_id, case_id, origin, origin_id, uploaded_by, original_name, name_fold,
         file_type, mime_type, size_bytes, sha256, object_key, key_version, wrap_dek_version,
         wrapped_file_key, inbox_expires_at, status, scanned_at)
       VALUES ($1, $2, NULL, 'chat_attachment', $3, $4, $5, $5, 'pdf', 'application/pdf', 100, $6,
         $7, 1, 1, $8, now() + interval '30 days', $9, $10)`,
      [
        id,
        p.org,
        o.originId ?? null,
        p.id,
        `${NAME_MARK}.pdf`,
        randomBytes(32),
        `org/${p.org}/inbox/${id}`,
        randomBytes(60),
        o.status ?? 'extracting',
        o.scanned === false ? null : new Date(),
      ],
    ),
  );
  return id;
}

/** Worker çıkarma adımı (`eda_worker`, yükleyen bağlamı). */
async function extracted(p: Person, fileId: string, text = KIRA): Promise<void> {
  const ok = await db.runner('eda_worker').withTenant({ orgId: p.org, userId: p.id }, (tx) =>
    finishExtract(tx, p.org, fileId, {
      text,
      tokenCount: Math.ceil(text.length / 3),
      pageCount: 2,
      pageOffsets: [0, 80],
      hiddenContentReport: { found: false, excludedFromText: false, items: [] },
      hasHiddenContent: false,
      extractorVersion: 'eda-extract/test',
      nextStatus: 'ready',
    }),
  );
  expect(ok).toBe(true);
}

function deps(): { deps: ChatDeps; captured: ModelMessage[][] } {
  const logger = createLogger({ service: 'it', destination: { write: () => undefined } });
  const real = createGateway({
    catalog: AiCatalog.parse(AI_CATALOG_SEED),
    env: { edaEnv: 'test', mockLlm: true, devRealLlm: null },
    secrets: { deepseekApiKey: null, pseudonymKey: new Uint8Array(32) },
    loadFixture: loadBundledFixture,
  });
  const captured: ModelMessage[][] = [];
  const gateway: Gateway = {
    usesMock: () => true,
    plan: (i) => real.plan(i),
    streamTurn: (input, c) => {
      captured.push(input.messages);
      return real.streamTurn(input, c);
    },
  };
  return {
    captured,
    deps: {
      gateway,
      backend: {
        searchDecisions: async () => ({ results: [], hasMore: false, stale: false }),
        getDecision: async () => {
          throw new Error('ağ yok');
        },
        searchLegislation: async () => ({ results: [] }),
        getLegislationArticles: async () => {
          throw new Error('ağ yok');
        },
      },
      persistence: new PgChatPersistence(db.runner('eda_app')),
      attachments: createChatAttachments({ db: db.runner('eda_app') }),
      active: new ActiveTurns(),
      pseudonymKey: new Uint8Array(32),
      logger,
      allowScenarioPrefix: false,
      uuid: () => uuidv7(),
    },
  };
}

function req(text: string, attachments: string[]) {
  return {
    trigger: 'submit-message' as const,
    message: {
      id: uuidv7(),
      role: 'user' as const,
      parts: [{ type: 'text' as const, text }] as [{ type: 'text'; text: string }],
    },
    regenerateMessageId: null,
    replaceFromMessageId: null,
    alias: 'edai-flash' as const,
    mode: 'chat' as const,
    scope: { sources: [], courtTypes: null, chamber: null, dateFrom: null, dateTo: null },
    attachments,
    mentions: [],
    documentId: null,
    documentBaseVersion: null,
    liveSearch: false,
  };
}

async function conversation(d: ChatDeps, p: Person): Promise<string> {
  const id = uuidv7();
  await d.persistence.create({ orgId: p.org, userId: p.id }, id);
  return id;
}

async function turn(d: ChatDeps, p: Person, conv: string, text: string, ids: string[]) {
  const actor = { orgId: p.org, userId: p.id };
  const before = (await d.persistence.load(actor, conv))?.ui.length ?? 0;
  const res = await runTurn(d, actor, conv, req(text, ids), uuidv7());
  await res.text();
  // Kalıcılık akış sonundaki `onFinish`'te: tur yazılana dek beklenir (en çok 5 sn).
  for (let i = 0; i < 50; i += 1) {
    if (((await d.persistence.load(actor, conv))?.ui.length ?? 0) > before) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return res;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof AppError ? err.code : 'other';
  }
}

beforeAll(async () => {
  db = createTestingDb(inject('pg'));
  const orgA = await db.auth.insertOrg('Örnek Büro A', 'firm');
  const orgB = await db.auth.insertOrg('Örnek Büro B', 'firm');
  await db.auth.grantSeats(orgA, 5);
  await db.auth.grantSeats(orgB, 5);
  w.a1 = await person(orgA, 'a1');
  w.a2 = await person(orgA, 'a2');
  w.b1 = await person(orgB, 'b1');
  // Evrak satırı büro DEK sürümüne bağlıdır (files_wrap_dek_fk): her büroya sahip + DEK.
  const kek = Buffer.alloc(32, 0x2a);
  for (const org of [orgA, orgB]) {
    const ownerId = await db.auth.insertUser({
      name: 'Örnek sahip',
      email: `sahip.${randomUUID().slice(0, 8)}@ornek.test`,
      emailVerified: true,
      verificationStatus: 'verified',
    });
    await db.auth.addMember(org, ownerId, 'owner');
    await inOrg({ id: ownerId, org }, async (tx) => {
      await tx.query('INSERT INTO app.org_settings (org_id) VALUES ($1)', [org]);
      await tx.query(
        'INSERT INTO app.org_keys (org_id, key_version, wrapped_dek, kek_version) VALUES ($1, 1, $2, 1)',
        [org, wrapDek(kek, { orgId: org, dekVersion: 1, kekVersion: 1 }, generateFileKey())],
      );
    });
  }
});

afterAll(async () => {
  await db?.close();
});

describe('KK-P21-dosya-5: yükle -> çıkar -> bağlam', () => {
  it('çıkarılan metin modele giden bağlamda, evrak sarmalayıcısında; ek sohbete bağlanır', async () => {
    const { deps: d, captured } = deps();
    const fileId = await uploaded(w.a1);
    await extracted(w.a1, fileId);
    const conv = await conversation(d, w.a1);
    await turn(d, w.a1, conv, 'Aylık kira bedeli ne kadar?', [fileId]);
    const sent = JSON.stringify(captured.at(-1)?.at(-1));
    expect(sent).toContain('tur=\\"evrak\\"');
    expect(sent).toContain('27.500 TL');
    expect(sent).not.toContain(NAME_MARK);
    const bound = await inOrg<{ rows: { origin_id: string }[] }>(w.a1, (tx) =>
      tx.query('SELECT origin_id FROM app.files WHERE id = $1', [fileId]),
    );
    expect(bound.rows[0]?.origin_id).toBe(conv);

    // KK-P21-dosya-8: kaynak kaydı case_file + user; sonraki turda ek bağlamı transkriptte kalır.
    const src = await inOrg<{
      rows: { source_kind: string; origin: string; source_key: string }[];
    }>(w.a1, (tx) =>
      tx.query(
        'SELECT source_kind, origin, source_key FROM app.message_sources WHERE conversation_id = $1',
        [conv],
      ),
    );
    expect(src.rows).toEqual([
      { source_kind: 'case_file', origin: 'user', source_key: `file:${fileId}` },
    ]);
    await turn(d, w.a1, conv, 'Fesih süresi nedir?', []);
    expect(JSON.stringify(captured.at(-1))).toContain('üç ay önceden');
  });
});

describe('KK-P21-dosya-6: izolasyon ve sohbet bağı', () => {
  it('aynı büronun başka kullanıcısı ve başka büro eki göremez; başka sohbete bağlı ek kullanılamaz', async () => {
    const { deps: d, captured } = deps();
    const fileId = await uploaded(w.a1);
    await extracted(w.a1, fileId);
    const a2conv = await conversation(d, w.a2);
    expect(await codeOf(turn(d, w.a2, a2conv, 'Kira bedeli?', [fileId]))).toBe('FILE_NOT_FOUND');
    const b1conv = await conversation(d, w.b1);
    expect(await codeOf(turn(d, w.b1, b1conv, 'Kira bedeli?', [fileId]))).toBe('FILE_NOT_FOUND');

    const c1 = await conversation(d, w.a1);
    await turn(d, w.a1, c1, 'Kira bedeli?', [fileId]);
    const c2 = await conversation(d, w.a1);
    expect(await codeOf(turn(d, w.a1, c2, 'Kira bedeli?', [fileId]))).toBe('FILE_NOT_FOUND');
    // Reddedilen turlarda sağlayıcı çağrılmadı (yalnız c1 turu).
    expect(captured).toHaveLength(1);
  });
});

describe('KK-P21-dosya-7: durum kapıları', () => {
  it('taranmamış/işlenen evrak FILE_NOT_READY, metinsiz FILE_NO_TEXT_LAYER, karantina FILE_QUARANTINED', async () => {
    const { deps: d, captured } = deps();
    const conv = await conversation(d, w.a1);
    const scanning = await uploaded(w.a1, { status: 'scanning', scanned: false });
    expect(await codeOf(turn(d, w.a1, conv, 'Soru?', [scanning]))).toBe('FILE_NOT_READY');
    const extracting = await uploaded(w.a1);
    expect(await codeOf(turn(d, w.a1, conv, 'Soru?', [extracting]))).toBe('FILE_NOT_READY');
    const noText = await uploaded(w.a1, { status: 'ocr_skipped' });
    expect(await codeOf(turn(d, w.a1, conv, 'Soru?', [noText]))).toBe('FILE_NO_TEXT_LAYER');
    const bad = await uploaded(w.a1, { status: 'quarantined', scanned: false });
    expect(await codeOf(turn(d, w.a1, conv, 'Soru?', [bad]))).toBe('FILE_QUARANTINED');
    expect(captured).toHaveLength(0);
  });
});
