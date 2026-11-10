// @tk TK-04 TK-05
// P17b kabul testleri (gerçek PostgreSQL; kimlik sahte, kiracı çalıştırıcısı `eda_app` havuzu).
// Uçlar `createAppSurface` zincirinden (oturum → doğrulama kapısı → kiracı → MFA → yetki) geçer;
// belge servisi gerçek depo ve RLS ile koşar. KK numaraları test adlarındadır.
//  KK-P17b-1  RLS ve roller      KK-P17b-2  rev hesabı          KK-P17b-3  baseVersion/yarış
//  KK-P17b-4  doğrulama          KK-P17b-5  session_end         KK-P17b-6  sürüm tekilleştirme
//  KK-P17b-7  geri yükleme       KK-P17b-8  durum kuralları     KK-P17b-9  üretim kilidi
//  KK-P17b-10 silme              KK-P17b-11 fark                KK-P17b-12 atıf kaydı
//  KK-P17b-13 şablonlar          KK-P17b-14 içerik gizliliği    KK-P17b-15 rota meta
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { MemberRole } from '@eda/contracts/enums';
import { ApiErrorEnvelope } from '@eda/contracts/errors';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAppSurface } from '../../src/app.ts';
import type { ResolvedSession } from '../../src/auth/index.ts';
import { createReadiness } from '../../src/health/ready.ts';
import { RateLimiter } from '../../src/middleware/rate-limit.ts';
import {
  type CitationVerifyPort,
  createDocumentsService,
} from '../../src/services/documents/index.ts';

const APP_URL = 'https://app.ornek.test';
const SENTINEL = `GIZLI-ICERIK-${randomUUID()}`;

let db: TestingDb;
let app: ReturnType<typeof createAppSurface>['app'];
let registry: ReturnType<typeof createAppSurface>['registry'];
const logLines: string[] = [];
const redisCalls: string[] = [];
const verifyJobs: { orgId: string; documentId: string; citationIds: string[]; gen: number }[] = [];

// ---------- dünya ----------

interface Actor {
  readonly id: string;
  readonly org: string;
  readonly role: MemberRole;
  readonly verification: 'verified' | 'pending_verification';
}
const actors = new Map<string, Actor>();
const world = {} as Record<
  'owner' | 'admin' | 'lawyer1' | 'lawyer2' | 'trainee' | 'assistant' | 'pending' | 'ownerB',
  Actor
> & { orgA: string; orgB: string };

function fakeRedis(): Redis {
  const rec =
    (name: string) =>
    async (...args: unknown[]) => {
      redisCalls.push(`${name}:${JSON.stringify(args)}`);
      return name === 'edaGcra' ? [1, 0] : name === 'hgetall' ? {} : 1;
    };
  return {
    defineCommand: () => undefined,
    edaGcra: rec('edaGcra'),
    hgetall: rec('hgetall'),
    del: rec('del'),
    multi: () => ({
      hincrby() {
        return this;
      },
      hset() {
        return this;
      },
      pexpire() {
        return this;
      },
      exec: rec('exec'),
    }),
  } as unknown as Redis;
}

const verifyPort: CitationVerifyPort = {
  enqueue: async (job) => {
    verifyJobs.push(job);
  },
};

async function newUser(
  tag: string,
  verification: Actor['verification'] = 'verified',
): Promise<string> {
  return db.auth.insertUser({
    name: `Örnek ${tag}`,
    email: `${tag}.${randomUUID().slice(0, 8)}@ornek.test`,
    emailVerified: true,
    verificationStatus: verification,
  });
}

async function member(
  org: string,
  tag: string,
  role: MemberRole,
  verification: Actor['verification'] = 'verified',
): Promise<Actor> {
  const id = await newUser(tag, verification);
  await db.auth.addMember(org, id, role);
  const a: Actor = { id, org, role, verification };
  actors.set(id, a);
  return a;
}

const runner = () => db.runner('eda_app');
const inOrg = <T>(a: Actor, fn: Parameters<ReturnType<typeof runner>['withTenant']>[1]) =>
  runner().withTenant({ orgId: a.org, userId: a.id }, fn) as Promise<T>;

// ---------- istek yardımcıları ----------

// biome-ignore lint/suspicious/noExplicitAny: test yanıt gövdeleri şemasız JSON olarak okunur
type Json = any;

interface Res {
  status: number;
  json: Json;
  headers: Headers;
}

async function call(as: Actor, method: string, path: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { origin: APP_URL, 'x-test-user': as.id };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(`${APP_URL}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: text === '' ? {} : (JSON.parse(text) as Json),
    headers: res.headers,
  };
}

const errOf = (r: Res) => ApiErrorEnvelope.parse(r.json).error;

// ---------- belge içeriği ----------

const ID = {
  a: 'b-AAAAAA',
  b: 'b-BBBBBB',
  c: 'b-CCCCCC',
  d: 'b-DDDDDD',
  e: 'b-EEEEEE',
} as const;

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const sec = (blockId: string, text: string, role = 'generic', rev = 0) => ({
  type: 'section',
  attrs: { blockId, rev, role },
  content: [para(text)],
});
const docOf = (...s: unknown[]) => ({ type: 'doc', content: s });
const saveBody = (draft: unknown, baseVersion: number) => ({
  baseVersion,
  draft,
  clientSeq: 1,
  reason: 'autosave',
});

async function createDoc(as: Actor, extra: Record<string, unknown> = {}) {
  const r = await call(as, 'POST', '/api/v1/documents', {
    kind: 'petition',
    title: 'Örnek dilekçe',
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.json as {
    id: string;
    draftRev: number;
    draft: { content: { attrs: { blockId: string } }[] };
  };
}

async function put(as: Actor, id: string, draft: unknown, base: number) {
  return call(as, 'PUT', `/api/v1/documents/${id}/draft`, saveBody(draft, base));
}

/** Test düzeneği: satır alanı doğrudan (eda_app, kendi RLS'siyle). */
async function setDoc(as: Actor, id: string, sql: string, params: unknown[] = []) {
  await inOrg(as, (tx) =>
    tx.query(`UPDATE app.documents SET ${sql} WHERE id = $1`, [id, ...params]),
  );
}

const ageDraft = (as: Actor, id: string, minutes = 11) =>
  setDoc(as, id, `draft_saved_at = now() - make_interval(mins => ${minutes})`);

async function versionRows(as: Actor, id: string) {
  const r = await inOrg<{ rows: Json[] }>(as, (tx) =>
    tx.query(
      'SELECT version_no, source, trigger, name, content FROM app.document_versions WHERE document_id = $1 ORDER BY version_no',
      [id],
    ),
  );
  return r.rows;
}

// ---------- düzenek ----------

beforeAll(async () => {
  const pg = inject('pg');
  db = createTestingDb(pg);
  const logger = createLogger({
    service: 'eda-api-it',
    level: 'debug',
    destination: { write: (l) => logLines.push(l) },
  });
  world.orgA = await db.auth.insertOrg('Örnek Büro A', 'firm');
  world.orgB = await db.auth.insertOrg('Örnek Büro B', 'firm');
  await db.auth.grantSeats(world.orgA, 20);
  await db.auth.grantSeats(world.orgB, 5);
  world.owner = await member(world.orgA, 'sahip', 'owner');
  world.admin = await member(world.orgA, 'yonetici', 'admin');
  world.lawyer1 = await member(world.orgA, 'avukat1', 'lawyer');
  world.lawyer2 = await member(world.orgA, 'avukat2', 'lawyer');
  world.trainee = await member(world.orgA, 'stajyer', 'trainee');
  world.assistant = await member(world.orgA, 'asistan', 'assistant');
  world.pending = await member(world.orgA, 'bekleyen', 'lawyer', 'pending_verification');
  world.ownerB = await member(world.orgB, 'sahipb', 'owner');
  for (const [org, who] of [
    [world.orgA, world.owner],
    [world.orgB, world.ownerB],
  ] as const) {
    await runner().withTenant({ orgId: org, userId: who.id }, (tx) =>
      tx.query('INSERT INTO app.org_settings (org_id) VALUES ($1)', [org]),
    );
  }

  const documents = createDocumentsService({ db: runner(), citationVerify: verifyPort });
  const state = { draining: false };
  const surface = createAppSurface({
    surface: 'app',
    logger,
    state,
    maintenanceMode: () => false,
    jsonBodyMaxBytes: 4 * 1024 * 1024,
    ready: createReadiness({ probes: [], cacheMs: 0, version: 'test', state }),
    identity: {
      appUrl: APP_URL,
      identity: {
        handle: async () => new Response('{}'),
        getSession: async (headers): Promise<ResolvedSession | null> => {
          const a = actors.get(headers.get('x-test-user') ?? '');
          if (a === undefined) return null;
          const at = new Date();
          return {
            session: {
              id: `sess-${a.id}`,
              userId: a.id,
              token: `tok-${a.id}`,
              createdAt: at,
              expiresAt: new Date(at.getTime() + 3_600_000),
              mfaLevel: 'totp',
              stepUpAt: at,
              activeOrganizationId: a.org,
              surface: 'app',
            },
            user: {
              id: a.id,
              platformRole: 'user',
              verificationStatus: a.verification,
              banned: false,
            },
            setCookie: [],
          };
        },
        revokeSession: async () => undefined,
        assertCanRemoveFactor: async () => undefined,
        stepUp: async () => {
          throw new Error('beklenmeyen stepUp');
        },
        listSessions: async () => [],
        revokeSessionById: async () => false,
        revokeOtherSessions: async () => 0,
      },
      rate: new RateLimiter({ redis: fakeRedis(), hmacKey: Buffer.alloc(32, 1) }),
      tenantDb: runner(),
      idempotency: {
        claim: async () => true,
        get: async () => null,
        put: async () => undefined,
        del: async () => undefined,
      },
      org: {} as never,
      documents,
      calendar: {} as never,
      cases: {} as never,
      files: {} as never,
      notificationPreferences: {} as never,
      notificationInbox: {} as never,
      audit: async () => undefined,
      aiKeys: {} as never,
      me: { me: async () => ({}) as never, applyLawyer: async () => ({}) as never },
    },
  });
  app = surface.app;
  registry = surface.registry;
});

afterAll(async () => {
  await db.close();
});

// ---------- KK-P17b-1 ----------

describe('KK-P17b-1: RLS ve rol sınırları', () => {
  it('davasız belge yalnız sahibinde; başka büro ve başka kullanıcı 404', async () => {
    const d = await createDoc(world.lawyer1);
    expect((await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}`)).status).toBe(200);
    for (const other of [world.lawyer2, world.owner, world.ownerB]) {
      const r = await call(other, 'GET', `/api/v1/documents/${d.id}`);
      expect(r.status).toBe(404);
      expect(errOf(r).code).toBe('DOC_NOT_FOUND');
    }
    const list = await call(world.lawyer2, 'GET', '/api/v1/documents');
    expect(list.json.items.map((i: { id: string }) => i.id)).not.toContain(d.id);
  });

  it('assistant 403 ORG_ROLE_INSUFFICIENT (liste, okuma, oluşturma); belge içeriğine ulaşamaz', async () => {
    const d = await createDoc(world.lawyer1);
    for (const [m, p, b] of [
      ['GET', '/api/v1/documents', undefined],
      ['GET', `/api/v1/documents/${d.id}`, undefined],
      ['POST', '/api/v1/documents', { kind: 'free', title: 'x' }],
      ['GET', `/api/v1/documents/${d.id}/versions`, undefined],
    ] as const) {
      const r = await call(world.assistant, m, p, b);
      expect(r.status).toBe(403);
      expect(errOf(r).code).toBe('ORG_ROLE_INSUFFICIENT');
    }
  });

  it('davalı belge: dava ekibi görür, ekip dışı kullanıcı görmez (031 matrisi)', async () => {
    const caseId = await inOrg<string>(world.lawyer1, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO app.cases (org_id, owner_id, title, title_fold, created_by, visibility)
         VALUES ($1, $2, 'Kısıtlı dava', 'kisitli dava', $2, 'restricted') RETURNING id`,
        [world.orgA, world.lawyer1.id],
      );
      return (r.rows[0] as { id: string }).id;
    });
    await inOrg(world.lawyer1, (tx) =>
      tx.query(
        'INSERT INTO app.case_members (org_id, case_id, user_id, added_by) VALUES ($1,$2,$3,$3)',
        [world.orgA, caseId, world.lawyer1.id],
      ),
    );
    const d = await createDoc(world.lawyer1, { caseId });
    expect((await call(world.lawyer2, 'GET', `/api/v1/documents/${d.id}`)).status).toBe(404);
    // Erişilemeyen dava: oluşturma ve süzgeç 404 CASE_NOT_FOUND.
    const denied = await call(world.lawyer2, 'POST', '/api/v1/documents', {
      kind: 'petition',
      title: 'x',
      caseId,
    });
    expect(errOf(denied).code).toBe('CASE_NOT_FOUND');
    await inOrg(world.lawyer1, (tx) =>
      tx.query(
        'INSERT INTO app.case_members (org_id, case_id, user_id, added_by) VALUES ($1,$2,$3,$4)',
        [world.orgA, caseId, world.lawyer2.id, world.lawyer1.id],
      ),
    );
    expect((await call(world.lawyer2, 'GET', `/api/v1/documents/${d.id}`)).status).toBe(200);
  });
});

// ---------- KK-P17b-2 / 3 ----------

describe('KK-P17b-2: rev sunucuda hesaplanır', () => {
  it('gelen rev yok sayılır; değişen blokta +1, değişmeyende sabit, yeni blokta 1', async () => {
    const d = await createDoc(world.lawyer1);
    const first = d.draft.content[0]?.attrs.blockId as string;
    // İlk yazım: mevcut blok aynı kalır (rev sabit 1), yeni blok 1; istemci rev'i 999.
    const r1 = await put(
      world.lawyer1,
      d.id,
      docOf(
        {
          ...sec(first, ''),
          attrs: { blockId: first, rev: 999, role: 'freeSection' },
          content: [{ type: 'paragraph' }],
        },
        sec(ID.b, 'ikinci', 'generic', 999),
      ),
      d.draftRev,
    );
    expect(r1.status).toBe(200);
    expect(r1.json.blockRevs).toEqual({ [first]: 1, [ID.b]: 1 });
    // İkinci yazım: yalnız B değişir.
    const r2 = await put(
      world.lawyer1,
      d.id,
      docOf(
        {
          type: 'section',
          attrs: { blockId: first, rev: 0, role: 'freeSection' },
          content: [{ type: 'paragraph' }],
        },
        sec(ID.b, 'ikinci değişti', 'generic', 0),
        sec(ID.c, 'yeni', 'generic', 7),
      ),
      r1.json.draftRev,
    );
    expect(r2.json.blockRevs).toEqual({ [first]: 1, [ID.b]: 2, [ID.c]: 1 });
    const got = await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}`);
    const revs = got.json.draft.content.map((s: { attrs: { rev: number } }) => s.attrs.rev);
    expect(revs).toEqual([1, 2, 1]);
  });
});

describe('KK-P17b-3: baseVersion çakışması ve yarış', () => {
  it('eski baseVersion 409 + currentVersion; yanıt kaybı tekrarı aynı içerikle 409', async () => {
    const d = await createDoc(world.lawyer1);
    const body = docOf(sec(ID.a, 'metin', 'generic'));
    const ok = await put(world.lawyer1, d.id, body, d.draftRev);
    expect(ok.status).toBe(200);
    const retry = await put(world.lawyer1, d.id, body, d.draftRev); // yanıt kaybı yeniden denemesi
    expect(retry.status).toBe(409);
    const e = errOf(retry);
    expect(e.code).toBe('DOC_VERSION_CONFLICT');
    expect(e.meta).toEqual({ currentVersion: ok.json.draftRev });
    const stale = await put(world.lawyer1, d.id, docOf(sec(ID.a, 'başka')), d.draftRev);
    expect(errOf(stale).code).toBe('DOC_VERSION_CONFLICT');
  });

  it('iki eşzamanlı PUT: biri 200, diğeri 409; draft_rev tam +1', async () => {
    const d = await createDoc(world.lawyer1);
    const [x, y] = await Promise.all([
      put(world.lawyer1, d.id, docOf(sec(ID.a, 'A yazımı')), d.draftRev),
      put(world.lawyer1, d.id, docOf(sec(ID.a, 'B yazımı')), d.draftRev),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const got = await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}`);
    expect(got.json.draftRev).toBe(d.draftRev + 1);
    // Kaybeden yazım kısmen uygulanmadı: taslak kazananın içeriğidir.
    const winner = x.status === 200 ? 'A yazımı' : 'B yazımı';
    expect(JSON.stringify(got.json.draft)).toContain(winner);
  });
});

// ---------- KK-P17b-4 ----------

describe('KK-P17b-4: doğrulama hataları 422 DOC_SCHEMA_INVALID', () => {
  async function reasonOf(draft: unknown): Promise<string | null> {
    const d = await createDoc(world.lawyer1);
    const r = await put(world.lawyer1, d.id, draft, d.draftRev);
    expect(r.status).toBe(422);
    const e = errOf(r);
    expect(e.code).toBe('DOC_SCHEMA_INVALID');
    return e.reason;
  }

  it('block_limit: 201 bölüm', async () => {
    const many = Array.from({ length: 201 }, (_, i) =>
      sec(
        `b-${String(100000 + i)
          .replace(/0/g, 'A')
          .replace(/1/g, 'B')}`,
        'x',
      ),
    );
    expect(await reasonOf(docOf(...many))).toBe('block_limit');
  });

  it('size_limit: gövde 1,5 MB üstü', async () => {
    const big = 'a'.repeat(1_600_000);
    expect(await reasonOf(docOf(sec(ID.a, big)))).toBe('size_limit');
  });

  it('role_rule: courtHeader içinde madde işaretli liste', async () => {
    const bad = {
      type: 'section',
      attrs: { blockId: ID.a, rev: 0, role: 'courtHeader' },
      content: [
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [para('x')] }],
        },
      ],
    };
    expect(await reasonOf(docOf(bad))).toBe('role_rule');
  });

  it('node_invalid: şema dışı düğüm; düşmanca girdi fixture (gizli/bidi karakter)', async () => {
    expect(
      await reasonOf(
        docOf({
          type: 'section',
          attrs: { blockId: ID.a, rev: 0, role: 'generic' },
          content: [{ type: 'script', content: [{ type: 'text', text: '<script>1</script>' }] }],
        }),
      ),
    ).toBe('node_invalid');
    const hostile = JSON.parse(
      readFileSync(
        new URL('../../../../packages/editor/test/fixtures/hostile-input.json', import.meta.url),
        'utf8',
      ),
    ) as { doc: unknown };
    expect(await reasonOf(hostile.doc)).toBe('node_invalid');
  });

  it('uyarılar kaydı engellemez (mahkeme başlığı ilk değil)', async () => {
    const d = await createDoc(world.lawyer1);
    const r = await put(
      world.lawyer1,
      d.id,
      docOf(sec(ID.a, 'önce'), sec(ID.b, 'Asliye Hukuk Mahkemesi', 'courtHeader')),
      d.draftRev,
    );
    expect(r.status).toBe(200);
    expect(r.json.warnings.map((w: { code: string }) => w.code)).toContain(
      'order.court_header_not_first',
    );
  });

  it('istemci HTML kabul edilmez: ham HTML metin olarak kalır, şema dışı etiket reddedilir', async () => {
    const d = await createDoc(world.lawyer1);
    const r = await put(
      world.lawyer1,
      d.id,
      docOf(sec(ID.a, '<img src=x onerror=alert(1)>')),
      d.draftRev,
    );
    expect(r.status).toBe(200);
    const got = await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}`);
    expect(got.json.draft.content[0].content[0].content[0].text).toBe(
      '<img src=x onerror=alert(1)>',
    );
    const html = await call(world.lawyer1, 'PUT', `/api/v1/documents/${d.id}/draft`, {
      baseVersion: r.json.draftRev,
      draft: { type: 'doc', content: '<p>x</p>' },
      clientSeq: 1,
      reason: 'autosave',
    });
    expect([400, 422]).toContain(html.status);
  });
});

// ---------- KK-P17b-5 / 6 ----------

describe('KK-P17b-5: session_end sürümü', () => {
  it('oturum süresi geçti ve taslak sürümden farklı → önceki taslak sürümlenir; aynı içerikte üretilmez', async () => {
    const d = await createDoc(world.lawyer1);
    const w1 = await put(world.lawyer1, d.id, docOf(sec(ID.a, 'birinci')), d.draftRev);
    expect(w1.json.versionCreated).toBeNull(); // ilk yazımda önceki yazım yok
    const w2 = await put(world.lawyer1, d.id, docOf(sec(ID.a, 'ikinci')), w1.json.draftRev);
    expect(w2.json.versionCreated).toBeNull(); // oturum içinde
    expect(await versionRows(world.lawyer1, d.id)).toHaveLength(0);

    await ageDraft(world.lawyer1, d.id);
    const w3 = await put(world.lawyer1, d.id, docOf(sec(ID.a, 'üçüncü')), w2.json.draftRev);
    expect(w3.json.versionCreated).toEqual({ versionNo: 1, trigger: 'session_end' });
    const rows = await versionRows(world.lawyer1, d.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'user', trigger: 'session_end' });
    expect(JSON.stringify(rows[0]?.content)).toContain('ikinci'); // yazım ÖNCESİ taslak
    expect(JSON.stringify(rows[0]?.content)).not.toContain('üçüncü');

    // Taslak son sürümle aynıysa süre geçse de sürüm üretilmez.
    const man = await call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions`, {});
    expect(man.status).toBe(201);
    await ageDraft(world.lawyer1, d.id);
    const w4 = await put(world.lawyer1, d.id, docOf(sec(ID.a, 'dördüncü')), w3.json.draftRev);
    expect(w4.json.versionCreated).toBeNull();
    expect(await versionRows(world.lawyer1, d.id)).toHaveLength(2);
  });
});

describe('KK-P17b-6: sürüm tekilleştirme ve değişmezlik', () => {
  it('otomatik kayıt sürüm üretmez; manuel eşit içerikte 200 + mevcut, boş adı doldurur', async () => {
    const d = await createDoc(world.lawyer1);
    await put(world.lawyer1, d.id, docOf(sec(ID.a, 'içerik')), d.draftRev);
    const v1 = await call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions`, {});
    expect(v1.status).toBe(201);
    expect(v1.json.trigger).toBe('manual');
    expect(v1.json.name).toBeNull();
    const again = await call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions`, {
      name: 'Mahkemeye verilen',
    });
    expect(again.status).toBe(200);
    expect(again.json.id).toBe(v1.json.id);
    expect(again.json.name).toBe('Mahkemeye verilen');
    const third = await call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions`, {
      name: 'Başka ad',
    });
    expect(third.status).toBe(200);
    expect(third.json.name).toBe('Mahkemeye verilen'); // dolu ad değişmez
    expect(await versionRows(world.lawyer1, d.id)).toHaveLength(1);
    const long = await call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions`, {
      name: 'x'.repeat(81),
    });
    expect(long.status).toBe(422);
  });

  it('veritabanı düzeyinde yalnız name güncellenir; içerik/meta güncellemesi reddedilir', async () => {
    const d = await createDoc(world.lawyer1);
    await put(world.lawyer1, d.id, docOf(sec(ID.a, 'x')), d.draftRev);
    const v = await call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions`, {});
    await inOrg(world.lawyer1, (tx) =>
      tx.query('UPDATE app.document_versions SET name = $2 WHERE id = $1', [v.json.id, 'ad']),
    );
    for (const col of ['content = $2::jsonb', 'trigger = $2', 'version_no = 99']) {
      const arg = col.startsWith('content') ? '{}' : 'manual';
      await expect(
        inOrg(world.lawyer1, (tx) =>
          tx.query(
            `UPDATE app.document_versions SET ${col} WHERE id = $1`,
            col.includes('$2') ? [v.json.id, arg] : [v.json.id],
          ),
        ),
      ).rejects.toThrow();
    }
    await expect(
      inOrg(world.lawyer1, (tx) =>
        tx.query('DELETE FROM app.document_versions WHERE id = $1', [v.json.id]),
      ),
    ).rejects.toThrow();
  });
});

// ---------- KK-P17b-7 ----------

describe('KK-P17b-7: geri yükleme', () => {
  it('yeni sürüm + yeni taslak; eski sürüm değişmez; blockId korunur; rev +1', async () => {
    const d = await createDoc(world.lawyer1);
    const w1 = await put(
      world.lawyer1,
      d.id,
      docOf(sec(ID.a, 'eski A'), sec(ID.b, 'eski B')),
      d.draftRev,
    );
    const v1 = await call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions`, {
      name: 'ilk',
    });
    const before = await versionRows(world.lawyer1, d.id);
    const w2 = await put(
      world.lawyer1,
      d.id,
      docOf(sec(ID.a, 'yeni A'), sec(ID.b, 'eski B'), sec(ID.c, 'eklenen')),
      w1.json.draftRev,
    );
    const r = await call(
      world.lawyer1,
      'POST',
      `/api/v1/documents/${d.id}/versions/${v1.json.id}/restore`,
    );
    expect(r.status).toBe(201);
    expect(r.json.version.trigger).toBe('restore');
    expect(r.json.draftRev).toBe(w2.json.draftRev + 1);
    const got = await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}`);
    expect(
      got.json.draft.content.map((s: { attrs: { blockId: string } }) => s.attrs.blockId),
    ).toEqual([ID.a, ID.b]);
    // A: eski → yeni → geri: 1 → 2 → 3; B içeriği hiç değişmedi: 1.
    expect(r.json.blockRevs).toEqual({ [ID.a]: 3, [ID.b]: 1 });
    // Eski sürüm değişmedi; kayıtsız değişiklik için session_end + restore eklendi.
    const rows = await versionRows(world.lawyer1, d.id);
    expect(rows[0]).toEqual(before[0]);
    expect(rows.map((x) => x.trigger)).toEqual(['manual', 'session_end', 'restore']);
  });

  it('kilitli durumlarda 423; başka sürüm 404', async () => {
    const d = await createDoc(world.lawyer1);
    await put(world.lawyer1, d.id, docOf(sec(ID.a, 'x')), d.draftRev);
    const v = await call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions`, {});
    await setDoc(world.lawyer1, d.id, "status = 'archived', archived_at = now()");
    const r = await call(
      world.lawyer1,
      'POST',
      `/api/v1/documents/${d.id}/versions/${v.json.id}/restore`,
    );
    expect(r.status).toBe(423);
    expect(errOf(r).reason).toBe('archived');
    const missing = await call(
      world.lawyer1,
      'POST',
      `/api/v1/documents/${d.id}/versions/${randomUUID()}/restore`,
    );
    expect([404, 423]).toContain(missing.status);
  });
});

// ---------- KK-P17b-8 / 9 ----------

describe('KK-P17b-8: durum kuralları ve kilitler', () => {
  const LOCKED: [string, string, string][] = [
    ['review_pending', "status = 'review_pending'", 'status_locked'],
    ['filed_declared', "status = 'filed_declared', filed_declared_at = now()", 'status_locked'],
    ['archived', "status = 'archived', archived_at = now()", 'archived'],
  ];
  for (const [status, sql, reason] of LOCKED) {
    it(`${status}: PUT draft 423 DOC_LOCKED (${reason})`, async () => {
      const d = await createDoc(world.lawyer1);
      await setDoc(world.lawyer1, d.id, sql);
      const r = await put(world.lawyer1, d.id, docOf(sec(ID.a, 'x')), d.draftRev);
      expect(r.status).toBe(423);
      const e = errOf(r);
      expect(e.code).toBe('DOC_LOCKED');
      expect(e.reason).toBe(reason);
    });
  }

  for (const status of ['approved', 'exported'] as const) {
    it(`${status}: ilk içerik değişikliği durumu draft yapar; değişmeyen içerik yapmaz`, async () => {
      const d = await createDoc(world.lawyer1);
      const w = await put(world.lawyer1, d.id, docOf(sec(ID.a, 'm')), d.draftRev);
      await setDoc(
        world.lawyer1,
        d.id,
        status === 'approved'
          ? "status = 'approved', approved_by = owner_id, approved_at = now()"
          : "status = 'exported', last_exported_at = now()",
      );
      const same = await put(world.lawyer1, d.id, docOf(sec(ID.a, 'm')), w.json.draftRev);
      expect(same.status).toBe(200);
      expect((await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}`)).json.status).toBe(
        status,
      );
      const changed = await put(
        world.lawyer1,
        d.id,
        docOf(sec(ID.a, 'değişti')),
        same.json.draftRev,
      );
      expect(changed.status).toBe(200);
      const got = await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}`);
      expect(got.json.status).toBe('draft');
      expect(got.json.approvedAt).toBeNull();
    });
  }

  // PATCH durum geçiş tablosu: her (kaynak, hedef) çifti ayrı test.
  type Cell = 'ok' | 'confirm' | 'conflict' | 'invalid' | 'approve';
  const SQL_OF: Record<string, string> = {
    draft: "status = 'draft'",
    approved: "status = 'approved', approved_by = owner_id, approved_at = now()",
    exported: "status = 'exported', last_exported_at = now()",
    review_pending: "status = 'review_pending'",
    filed_declared:
      "status = 'filed_declared', filed_declared_by = owner_id, filed_declared_at = now()",
    archived: "status = 'archived', archived_at = now()",
  };
  const FROM = Object.keys(SQL_OF);
  const TO = ['draft', 'approved', 'exported', 'review_pending', 'filed_declared', 'archived'];
  const EXPECT = (from: string, to: string): Cell => {
    if (to === 'exported' || to === 'review_pending') return 'invalid';
    if (to === 'approved') return ['draft', 'exported'].includes(from) ? 'approve' : 'conflict';
    if (to === 'filed_declared')
      return ['draft', 'approved', 'exported'].includes(from) ? 'confirm' : 'conflict';
    if (to === 'archived')
      return ['draft', 'approved', 'exported'].includes(from) ? 'ok' : 'conflict';
    // to === 'draft'
    if (from === 'filed_declared') return 'confirm';
    return ['approved', 'archived'].includes(from) ? 'ok' : 'conflict';
  };
  for (const from of FROM) {
    for (const to of TO) {
      const cell = EXPECT(from, to);
      it(`KK-P17b-8 geçiş ${from} → ${to}: ${cell}`, async () => {
        const d = await createDoc(world.lawyer1);
        await setDoc(world.lawyer1, d.id, SQL_OF[from] as string);
        const patch = (as: Actor, confirm?: boolean) =>
          call(as, 'PATCH', `/api/v1/documents/${d.id}`, {
            status: to,
            ...(confirm === undefined ? {} : { confirm }),
          });
        if (cell === 'invalid') {
          const r = await patch(world.lawyer1, true);
          expect(r.status).toBe(422);
          expect(errOf(r).code).toBe('VALIDATION_FAILED');
        } else if (cell === 'conflict') {
          const r = await patch(world.lawyer1, true);
          expect(r.status).toBe(409);
          expect(errOf(r).code).toBe('VALIDATION_CONFLICT');
        } else if (cell === 'confirm') {
          const noConfirm = await patch(world.lawyer1);
          expect(noConfirm.status).toBe(422);
          expect(errOf(noConfirm).fields?.[0]?.path).toBe('body.confirm');
          const ok = await patch(world.lawyer1, true);
          expect(ok.status).toBe(200);
          expect(ok.json.status).toBe(to);
          if (to === 'filed_declared') expect(ok.json.filedDeclaredAt).not.toBeNull();
        } else if (cell === 'approve') {
          // approved yalnız document:approve ile: avukat reddedilir, kıdemli/sahip olur.
          const denied = await patch(world.lawyer1, true);
          expect(denied.status).toBe(403);
          expect(errOf(denied).code).toBe('ORG_ROLE_INSUFFICIENT');
          const ok = await patch(world.owner, true).catch(() => null);
          // Sahip belgeyi göremez (davasız belge yalnız sahibinde): 404.
          expect(ok?.status).toBe(404);
        } else {
          const ok = await patch(world.lawyer1, true);
          expect(ok.status).toBe(200);
          expect(ok.json.status).toBe(to);
        }
      });
    }
  }

  it('approved: senior/owner (document:approve) davalı belgede onaylayabilir; exported PATCH ile yazılamaz', async () => {
    const caseId = await inOrg<string>(world.owner, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO app.cases (org_id, owner_id, title, title_fold, created_by)
         VALUES ($1, $2, 'Büro davası', 'buro davasi', $2) RETURNING id`,
        [world.orgA, world.owner.id],
      );
      return (r.rows[0] as { id: string }).id;
    });
    const d = await createDoc(world.lawyer1, { caseId });
    const ok = await call(world.owner, 'PATCH', `/api/v1/documents/${d.id}`, {
      status: 'approved',
    });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('approved');
    expect(ok.json.approvedAt).not.toBeNull();
    const ex = await call(world.owner, 'PATCH', `/api/v1/documents/${d.id}`, {
      status: 'exported',
    });
    expect(ex.status).toBe(422);
  });
});

describe('KK-P17b-9: üretim sürerken kilit', () => {
  it('PUT draft, PATCH durum, DELETE ve geri yükleme 423 generation_in_progress', async () => {
    const d = await createDoc(world.lawyer1);
    await put(world.lawyer1, d.id, docOf(sec(ID.a, 'x')), d.draftRev);
    const v = await call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions`, {});
    await setDoc(world.lawyer1, d.id, "generation_status = 'generating'");
    const reqs = [
      put(world.lawyer1, d.id, docOf(sec(ID.a, 'y')), 1),
      call(world.lawyer1, 'PATCH', `/api/v1/documents/${d.id}`, { status: 'archived' }),
      call(world.lawyer1, 'DELETE', `/api/v1/documents/${d.id}`),
      call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions/${v.json.id}/restore`),
    ];
    for (const r of await Promise.all(reqs)) {
      expect(r.status).toBe(423);
      expect(errOf(r).reason).toBe('generation_in_progress');
    }
    // Başlık değişimi üretimden etkilenmez; okuma açık.
    expect((await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}`)).status).toBe(200);
  });
});

// ---------- KK-P17b-10 ----------

describe('KK-P17b-10: silme', () => {
  it('yasal saklama (büro/dava) ve arşivli dava 409; yetkisiz rol 403; sahibi siler', async () => {
    const owned = await createDoc(world.lawyer1);
    const trainee = await call(world.trainee, 'DELETE', `/api/v1/documents/${owned.id}`);
    expect(trainee.status).toBe(403);

    await runner().withTenant({ orgId: world.orgA, userId: world.owner.id }, (tx) =>
      tx.query('UPDATE app.org_settings SET legal_hold = true WHERE org_id = $1', [world.orgA]),
    );
    const held = await call(world.lawyer1, 'DELETE', `/api/v1/documents/${owned.id}`);
    expect(held.status).toBe(409);
    expect(errOf(held).code).toBe('DOC_DELETE_BLOCKED');
    expect(errOf(held).reason).toBe('legal_hold');
    await runner().withTenant({ orgId: world.orgA, userId: world.owner.id }, (tx) =>
      tx.query('UPDATE app.org_settings SET legal_hold = false WHERE org_id = $1', [world.orgA]),
    );

    const caseId = await inOrg<string>(world.lawyer1, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO app.cases (org_id, owner_id, title, title_fold, created_by)
         VALUES ($1, $2, 'Silme davası', 'silme davasi', $2) RETURNING id`,
        [world.orgA, world.lawyer1.id],
      );
      return (r.rows[0] as { id: string }).id;
    });
    const inCase = await createDoc(world.lawyer1, { caseId });
    await inOrg(world.lawyer1, (tx) =>
      tx.query("UPDATE app.cases SET status = 'archived', mandate_ended_at = now() WHERE id = $1", [
        caseId,
      ]),
    );
    const arch = await call(world.lawyer1, 'DELETE', `/api/v1/documents/${inCase.id}`);
    expect(errOf(arch).reason).toBe('case_archived');
    await inOrg(world.lawyer1, (tx) =>
      tx.query("UPDATE app.cases SET status = 'active', legal_hold = true WHERE id = $1", [caseId]),
    );
    const hold = await call(world.lawyer1, 'DELETE', `/api/v1/documents/${inCase.id}`);
    expect(errOf(hold).reason).toBe('legal_hold');

    // Başka avukatın davalı belgesini sahibi olmayan avukat silemez; yönetici silebilir.
    await inOrg(world.lawyer1, (tx) =>
      tx.query('UPDATE app.cases SET legal_hold = false WHERE id = $1', [caseId]),
    );
    const byOther = await call(world.lawyer2, 'DELETE', `/api/v1/documents/${inCase.id}`);
    expect(byOther.status).toBe(403);
    expect((await call(world.admin, 'DELETE', `/api/v1/documents/${inCase.id}`)).status).toBe(204);
    expect((await call(world.lawyer1, 'DELETE', `/api/v1/documents/${owned.id}`)).status).toBe(204);
    expect((await call(world.lawyer1, 'GET', `/api/v1/documents/${owned.id}`)).status).toBe(404);
  });
});

// ---------- KK-P17b-11 ----------

describe('KK-P17b-11: sürüm farkı', () => {
  it('added/removed/modified/moved; draft kombinasyonları; karakter farkı yok', async () => {
    const d = await createDoc(world.lawyer1);
    await put(
      world.lawyer1,
      d.id,
      docOf(sec(ID.a, 'A'), sec(ID.b, 'B'), sec(ID.c, 'C'), sec(ID.d, 'D')),
      d.draftRev,
    );
    const v1 = await call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions`, {});
    const cur = (await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}`)).json.draftRev;
    // B değişir, C silinir, E eklenir, A sona taşınır.
    await put(
      world.lawyer1,
      d.id,
      docOf(sec(ID.b, 'B değişti'), sec(ID.d, 'D'), sec(ID.e, 'E yeni'), sec(ID.a, 'A')),
      cur,
    );
    const r = await call(
      world.lawyer1,
      'GET',
      `/api/v1/documents/${d.id}/diff?from=${v1.json.id}&to=draft`,
    );
    expect(r.status).toBe(200);
    const kinds = Object.fromEntries(
      r.json.blocks.map((b: { blockId: string; change: string }) => [b.blockId, b.change]),
    );
    expect(kinds[ID.b]).toBe('modified');
    expect(kinds[ID.c]).toBe('removed');
    expect(kinds[ID.e]).toBe('added');
    expect(kinds[ID.a]).toBe('moved');
    expect(r.json.from.versionNo).toBe(1);
    expect(r.json.to.versionNo).toBeNull();
    expect(JSON.stringify(r.json)).not.toContain('"ops"'); // karakter farkı üretilmez
    const rev = await call(
      world.lawyer1,
      'GET',
      `/api/v1/documents/${d.id}/diff?from=draft&to=${v1.json.id}`,
    );
    expect(rev.status).toBe(200);
    expect(rev.json.from.versionNo).toBeNull();
    const same = await call(
      world.lawyer1,
      'GET',
      `/api/v1/documents/${d.id}/diff?from=draft&to=draft`,
    );
    expect(same.status).toBe(422);
    const other = await call(
      world.lawyer2,
      'GET',
      `/api/v1/documents/${d.id}/diff?from=draft&to=${v1.json.id}`,
    );
    expect(other.status).toBe(404);
  });
});

// ---------- KK-P17b-12 ----------

describe('KK-P17b-12: atıf kaydı', () => {
  it('yeni citation düğümü satır açar; raw yeniden ayrıştırılır; doğrulama commit sonrası yalnız kimlikle kuyruğa girer', async () => {
    const d = await createDoc(world.lawyer1);
    const cid = randomUUID();
    const cite = (raw: string) => ({
      type: 'section',
      attrs: { blockId: ID.a, rev: 0, role: 'generic' },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bkz. ' },
            {
              type: 'citation',
              attrs: { citationId: cid, raw, sourceRef: null, status: 'verified', attestKey: null },
            },
          ],
        },
      ],
    });
    verifyJobs.length = 0;
    const r1 = await put(
      world.lawyer1,
      d.id,
      docOf(cite('Yargıtay 9. HD 2024/1234 E.')),
      d.draftRev,
    );
    expect(r1.status).toBe(200);
    // İstemcinin düğümde taşıdığı `status: verified` güvenilmez; satır `pending` açılır.
    expect(r1.json.citations).toEqual([
      { citationId: cid, status: 'pending', blocking: 'none', shortKunye: null, reason: null },
    ]);
    const rows = await inOrg<{ rows: Json[] }>(world.lawyer1, (tx) =>
      tx.query(
        'SELECT status, raw, block_id, document_id FROM app.message_citations WHERE id = $1',
        [cid],
      ),
    );
    expect(rows.rows[0]).toMatchObject({ status: 'pending', block_id: ID.a, document_id: d.id });
    expect(verifyJobs).toHaveLength(1);
    expect(Object.keys(verifyJobs[0] as object).sort()).toEqual([
      'citationIds',
      'documentId',
      'gen',
      'orgId',
    ]);
    expect(JSON.stringify(verifyJobs)).not.toContain('Yargıtay');

    // Aynı raw: yeni satır/iş yok. Değişen raw: satır pending'e döner ve yeniden kuyruğa girer.
    const r2 = await put(
      world.lawyer1,
      d.id,
      docOf(cite('Yargıtay 9. HD 2024/1234 E.')),
      r1.json.draftRev,
    );
    expect(r2.json.citations).toEqual([]);
    expect(verifyJobs).toHaveLength(1);
    await inOrg(world.lawyer1, (tx) =>
      tx.query("UPDATE app.message_citations SET status = 'verified' WHERE id = $1", [cid]),
    );
    const r3 = await put(
      world.lawyer1,
      d.id,
      docOf(cite('Yargıtay 11. HD 2023/999 E.')),
      r2.json.draftRev,
    );
    expect(r3.json.citations[0]).toMatchObject({ citationId: cid, status: 'pending' });
    expect(verifyJobs).toHaveLength(2);

    // Geri alınan yazım (409) kuyruğa iş bırakmaz.
    await put(world.lawyer1, d.id, docOf(cite('Yargıtay 1. HD 2020/5 E.')), 0).then((r) =>
      expect(r.status).toBe(409),
    );
    expect(verifyJobs).toHaveLength(2);
  });

  it('başka belgenin atıf kimliği çalınamaz; uuid olmayan citationId reddedilir', async () => {
    const a = await createDoc(world.lawyer1);
    const b = await createDoc(world.lawyer1);
    const cid = randomUUID();
    const node = (id: string) => ({
      type: 'section',
      attrs: { blockId: ID.a, rev: 0, role: 'generic' },
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'citation',
              attrs: {
                citationId: id,
                raw: 'TBK m. 49',
                sourceRef: null,
                status: 'pending',
                attestKey: null,
              },
            },
          ],
        },
      ],
    });
    expect((await put(world.lawyer1, a.id, docOf(node(cid)), a.draftRev)).status).toBe(200);
    const stolen = await put(world.lawyer1, b.id, docOf(node(cid)), b.draftRev);
    expect(stolen.status).toBe(200);
    expect(stolen.json.citations).toEqual([]); // ON CONFLICT DO NOTHING: satır A belgesinde kalır
    const bad = await put(world.lawyer1, b.id, docOf(node('not-a-uuid')), stolen.json.draftRev);
    expect(bad.status).toBe(422);
  });
});

// ---------- KK-P17b-13 ----------

describe('KK-P17b-13: GET /templates', () => {
  it('platform + büro şablonları; pasif ve başka büro gelmez; PV yalnız platform; süzgeç', async () => {
    const tpl = (
      org: string | null,
      title: string,
      kind: string,
      subtype: string | null,
      active: boolean,
    ) =>
      db.ownerQuery(
        `INSERT INTO app.templates (org_id, kind, subtype, title, content, is_active)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [org, kind, subtype, title, JSON.stringify(docOf(sec(ID.a, 'şablon'))), active],
      );
    await tpl(null, `Platform dava ${SENTINEL}`, 'petition', 'claim', true);
    await tpl(null, 'Platform pasif', 'petition', 'claim', false);
    await inOrg(world.owner, (tx) =>
      tx.query(
        `INSERT INTO app.templates (org_id, kind, subtype, title, content, created_by)
         VALUES ($1, 'notice', 'notice_general', 'Büro ihtarname', $2::jsonb, $3)`,
        [world.orgA, JSON.stringify(docOf(sec(ID.a, 'x'))), world.owner.id],
      ),
    );
    await inOrg(world.ownerB, (tx) =>
      tx.query(
        `INSERT INTO app.templates (org_id, kind, title, content, created_by)
         VALUES ($1, 'memo', 'Başka büro', $2::jsonb, $3)`,
        [world.orgB, JSON.stringify(docOf(sec(ID.a, 'x'))), world.ownerB.id],
      ),
    );
    const all = await call(world.lawyer1, 'GET', '/api/v1/templates');
    expect(all.status).toBe(200);
    const titles = all.json.items.map((t: { title: string }) => t.title);
    expect(titles).toContain(`Platform dava ${SENTINEL}`);
    expect(titles).toContain('Büro ihtarname');
    expect(titles).not.toContain('Platform pasif');
    expect(titles).not.toContain('Başka büro');
    expect(all.json.items[0]).not.toHaveProperty('content');

    const pv = await call(world.pending, 'GET', '/api/v1/templates');
    expect(pv.status).toBe(200);
    expect(
      pv.json.items.map((t: { orgId: string | null }) => t.orgId).every((o: unknown) => o === null),
    ).toBe(true);

    const f = await call(
      world.lawyer1,
      'GET',
      '/api/v1/templates?kind=notice&subtype=notice_general',
    );
    expect(f.json.items.map((t: { title: string }) => t.title)).toEqual(['Büro ihtarname']);
    expect((await call(world.assistant, 'GET', '/api/v1/templates')).status).toBe(403);
  });

  it('şablondan belge: her bölüm yeni blockId ve rev=1; tür uyuşmazlığı reddedilir', async () => {
    const id = (
      await db.ownerQuery<{ id: string }>(
        `INSERT INTO app.templates (org_id, kind, subtype, title, content)
         VALUES (NULL, 'petition', 'answer', 'Cevap şablonu', $1::jsonb) RETURNING id`,
        [
          JSON.stringify(
            docOf(sec('b-HHHHHH', 'a', 'generic', 5), sec('b-JJJJJJ', 'b', 'generic', 9)),
          ),
        ],
      )
    )[0]?.id as string;
    const r = await call(world.lawyer1, 'POST', '/api/v1/documents', {
      kind: 'petition',
      title: 'Cevap',
      templateId: id,
    });
    expect(r.status).toBe(201);
    expect(r.json.subtype).toBe('answer');
    const blocks = r.json.draft.content as { attrs: { blockId: string; rev: number } }[];
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.attrs.rev)).toEqual([1, 1]);
    expect(blocks.map((b) => b.attrs.blockId)).not.toContain('b-HHHHHH');
    const mismatch = await call(world.lawyer1, 'POST', '/api/v1/documents', {
      kind: 'memo',
      title: 'x',
      templateId: id,
    });
    expect(mismatch.status).toBe(422);
    const unknown = await call(world.lawyer1, 'POST', '/api/v1/documents', {
      kind: 'petition',
      title: 'x',
      templateId: randomUUID(),
    });
    expect(unknown.status).toBe(404);
  });
});

// ---------- KK-P17b-14 ----------

describe('KK-P17b-14: içerik günlüğe ve Valkey çağrılarına yazılmaz', () => {
  it('sentinel metin yazım/okuma/sürüm/fark/silme sonrası hiçbir günlük veya Valkey satırında yok', async () => {
    const d = await createDoc(world.lawyer1, { title: `Başlık ${SENTINEL}` });
    const w = await put(world.lawyer1, d.id, docOf(sec(ID.a, SENTINEL)), d.draftRev);
    await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}`);
    const v = await call(world.lawyer1, 'POST', `/api/v1/documents/${d.id}/versions`, {});
    await put(world.lawyer1, d.id, docOf(sec(ID.a, `${SENTINEL} 2`)), w.json.draftRev);
    await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}/diff?from=${v.json.id}&to=draft`);
    await call(world.lawyer1, 'GET', `/api/v1/documents/${d.id}/versions/${v.json.id}`);
    await put(world.lawyer1, d.id, docOf({ type: 'section', attrs: {}, content: [] }), 99); // hata yolu
    await call(world.lawyer1, 'DELETE', `/api/v1/documents/${d.id}`);
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.filter((l) => l.includes(SENTINEL))).toEqual([]);
    expect(redisCalls.filter((l) => l.includes(SENTINEL))).toEqual([]);
  });
});

// ---------- KK-P17b-15 ----------

describe('KK-P17b-15: defineRoute meta ve route census', () => {
  it('izinler, doğrulama kapısı, hız sınıfı ve clientData', () => {
    const routes = registry.list().filter((r) => /^\/api\/v1\/(documents|templates)/.test(r.path));
    const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;
    const byKey = new Map(routes.map((r) => [key(r), r.meta]));
    const expected: Record<string, string> = {
      'GET /api/v1/documents': 'document:read',
      'POST /api/v1/documents': 'document:write',
      'GET /api/v1/documents/{documentId}': 'document:read',
      'PATCH /api/v1/documents/{documentId}': 'document:write',
      'DELETE /api/v1/documents/{documentId}': 'document:delete',
      'PUT /api/v1/documents/{documentId}/draft': 'document:write',
      'GET /api/v1/documents/{documentId}/versions': 'document:read',
      'POST /api/v1/documents/{documentId}/versions': 'document:write',
      'GET /api/v1/documents/{documentId}/versions/{versionId}': 'document:read',
      'POST /api/v1/documents/{documentId}/versions/{versionId}/restore': 'document:write',
      'GET /api/v1/documents/{documentId}/diff': 'document:read',
      'GET /api/v1/templates': 'research:use',
    };
    expect([...byKey.keys()].sort()).toEqual(Object.keys(expected).sort());
    for (const [k, perm] of Object.entries(expected)) {
      const m = byKey.get(k);
      expect(m?.permission, k).toBe(perm);
      expect(m?.tenant, k).toBe('required');
      expect(m?.rateLimit, k).toBe('api');
      expect(m?.stepUp, k).toBe(false);
      expect(m?.allowVerification, k).toBe(k === 'GET /api/v1/templates' ? 'pending' : 'verified');
      expect(m?.clientData, k).toBe(k === 'POST /api/v1/documents');
    }
  });
});
