// @tk TK-04 TK-05 TK-06
// P20 dosya yükleme hattı kabul testleri (gerçek PostgreSQL; kimlik sahte, kiracı çalıştırıcısı
// `eda_app` havuzu, nesne deposu bellek içi sahte port). Uçlar `createAppSurface` zincirinden geçer.
//  KK-P20-7  yükleme -> liste -> okuma, şifreli nesne, custody, iş     KK-P20-8  boyut ve boş dosya
//  KK-P20-9  tür doğrulama                                              KK-P20-10 mükerrer
//  KK-P20-11 yetki ve büro izolasyonu                                   KK-P20-12 silme ve saklama
//  KK-P20-13 depo hataları ve temizlik                                  KK-P20-14 eşzamanlı yükleme
//  KK-P20-15 içerik ve ad sızıntısı yok                                 KK-P20-16 rota meta
import { createHash, randomUUID } from 'node:crypto';
import type { MemberRole } from '@eda/contracts/enums';
import { ApiErrorEnvelope } from '@eda/contracts/errors';
import {
  createSegmentDecryptor,
  deriveVariantKey,
  generateFileKey,
  HEADER_BYTES,
  unwrapDek,
  unwrapFileKey,
  wrapDek,
} from '@eda/crypto';
import { createKeyring } from '@eda/db/keyring';
import { createMemoryObjectStore, createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAppSurface } from '../../src/app.ts';
import type { ResolvedSession } from '../../src/auth/index.ts';
import { createReadiness } from '../../src/health/ready.ts';
import { RateLimiter } from '../../src/middleware/rate-limit.ts';
import { uuidv7 } from '../../src/middleware/request-id.ts';
import type { FileJobProducer, FileScanRequest } from '../../src/queue/file-producer.ts';
import { createCasesService } from '../../src/services/cases/cases.ts';
import { createFilesService, sealedLength } from '../../src/services/files/files.ts';
import type { DownloadTokenRecord, DownloadTokenStore } from '../../src/services/files/tokens.ts';

const APP_URL = 'https://app.ornek.test';
const KEK = Buffer.alloc(32, 0x5a);
const MAX_BYTES = 200_000;
/** Yükleme içeriğine ve ada gömülen işaretler: log ve DB dışı hiçbir yerde görünmemeli. */
const NAME_MARK = `ADSOYAD-${randomUUID().slice(0, 8)}`;
const BODY_MARK = `GIZLI-ICERIK-${randomUUID()}`;

let db: TestingDb;
let app: ReturnType<typeof createAppSurface>['app'];
let registry: ReturnType<typeof createAppSurface>['registry'];
const store = createMemoryObjectStore();
const scanJobs: FileScanRequest[] = [];
const logLines: string[] = [];
/** Valkey `GETDEL` davranışını taklit eden bellek içi belirteç deposu (TTL testte elle silinir). */
const tokenRows = new Map<string, DownloadTokenRecord>();
const tokenStore: DownloadTokenStore = {
  put: async (hash, record) => {
    tokenRows.set(hash, record);
  },
  take: async (hash) => {
    const v = tokenRows.get(hash) ?? null;
    tokenRows.delete(hash);
    return v;
  },
};
const integrity: { fileId: string; kind: string }[] = [];

interface Actor {
  readonly id: string;
  readonly org: string;
  readonly role: MemberRole;
  readonly verification: 'verified' | 'pending_verification';
}
const actors = new Map<string, Actor>();
const world = {} as Record<
  'owner' | 'lawyer1' | 'lawyer2' | 'trainee' | 'assistant' | 'pending' | 'ownerB',
  Actor
> & { orgA: string; orgB: string };

function fakeRedis(): Redis {
  const rec =
    (name: string) =>
    async (..._args: unknown[]) =>
      name === 'edaGcra' ? [1, 0] : name === 'hgetall' ? {} : 1;
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

async function member(
  org: string,
  tag: string,
  role: MemberRole,
  verification: Actor['verification'] = 'verified',
): Promise<Actor> {
  const id = await db.auth.insertUser({
    name: `Örnek ${tag}`,
    email: `${tag}.${randomUUID().slice(0, 8)}@ornek.test`,
    emailVerified: true,
    verificationStatus: verification,
  });
  await db.auth.addMember(org, id, role);
  const a: Actor = { id, org, role, verification };
  actors.set(id, a);
  return a;
}

const runner = () => db.runner('eda_app');
const inOrg = <T>(a: Actor, fn: Parameters<ReturnType<typeof runner>['withTenant']>[1]) =>
  runner().withTenant({ orgId: a.org, userId: a.id }, fn) as Promise<T>;

// biome-ignore lint/suspicious/noExplicitAny: test yanıt gövdeleri şemasız JSON olarak okunur
type Json = any;
interface Res {
  status: number;
  json: Json;
  headers: Headers;
}

async function read(res: Response): Promise<Res> {
  const text = await res.text();
  return {
    status: res.status,
    json: text === '' ? {} : (JSON.parse(text) as Json),
    headers: res.headers,
  };
}

async function call(as: Actor, method: string, path: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { origin: APP_URL, 'x-test-user': as.id };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return read(
    await app.request(`${APP_URL}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

const errOf = (r: Res) => ApiErrorEnvelope.parse(r.json).error;

/** Metin alanları önce, `file` en sonda (033 §6.1). */
function formOf(
  name: string,
  content: Uint8Array,
  fields: Record<string, string> = {},
  order: 'file-last' | 'file-first' = 'file-last',
): FormData {
  const form = new FormData();
  const addFile = () => form.append('file', new Blob([content]), name);
  if (order === 'file-first') addFile();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (order === 'file-last') addFile();
  return form;
}

async function upload(
  as: Actor,
  name: string,
  content: Uint8Array,
  fields: Record<string, string> = {},
  order: 'file-last' | 'file-first' = 'file-last',
): Promise<Res> {
  return read(
    await app.request(`${APP_URL}/api/v1/files`, {
      method: 'POST',
      headers: { origin: APP_URL, 'x-test-user': as.id },
      body: formOf(name, content, fields, order),
    }),
  );
}

/** Sentetik PDF: geçerli imza + işaretli, deterministik gövde. */
function pdf(size: number, mark = BODY_MARK): Buffer {
  const head = Buffer.from(`%PDF-1.7\n% ${mark}\n`);
  const body = Buffer.alloc(Math.max(0, size - head.length));
  for (let i = 0; i < body.length; i++) body[i] = (i * 131 + 17) & 0xff;
  return Buffer.concat([head, body]);
}

async function createCase(as: Actor, visibility: 'org' | 'restricted' = 'org'): Promise<string> {
  const r = await call(as, 'POST', '/api/v1/cases', {
    title: `Örnek dava ${randomUUID().slice(0, 6)}`,
    visibility,
  });
  expect(r.status).toBe(201);
  return r.json.id as string;
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function rowOf(as: Actor, fileId: string): Promise<Json> {
  const r = await inOrg<{ rows: Json[] }>(as, (tx) =>
    tx.query('SELECT * FROM app.files WHERE id = $1', [fileId]),
  );
  return r.rows[0];
}

async function custodyOf(as: Actor, fileId: string): Promise<Json[]> {
  const r = await inOrg<{ rows: Json[] }>(as, (tx) =>
    tx.query('SELECT * FROM app.custody_events WHERE file_id = $1 ORDER BY created_at', [fileId]),
  );
  return r.rows;
}

/** Bağımsız çözme: DB'deki sarılı anahtarlardan nesneyi açar (üretim koduna güvenmeden). */
async function decryptStored(as: Actor, fileId: string): Promise<Buffer> {
  const row = await rowOf(as, fileId);
  const keyRow = await inOrg<{ rows: Json[] }>(as, (tx) =>
    tx.query(
      'SELECT wrapped_dek, kek_version FROM app.org_keys WHERE org_id = $1 AND key_version = $2',
      [as.org, row.wrap_dek_version],
    ),
  );
  const k = keyRow.rows[0];
  const dek = unwrapDek(
    KEK,
    { orgId: as.org, dekVersion: row.wrap_dek_version, kekVersion: k.kek_version },
    k.wrapped_dek,
  );
  const fileKey = unwrapFileKey(
    dek,
    { orgId: as.org, fileId, keyVersion: row.key_version },
    row.wrapped_file_key,
  );
  const obj = store.objects.get(row.object_key);
  if (obj === undefined) throw new Error('nesne yok');
  const dec = createSegmentDecryptor(
    { orgId: as.org, fileId, keyVersion: row.key_version },
    deriveVariantKey(fileKey, 'orig'),
    { objectLength: obj.length },
  );
  return Buffer.concat([...dec.push(obj), ...dec.finish()]);
}

// ---------- düzenek ----------

beforeAll(async () => {
  db = createTestingDb(inject('pg'));
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
  world.lawyer1 = await member(world.orgA, 'avukat1', 'lawyer');
  world.lawyer2 = await member(world.orgA, 'avukat2', 'lawyer');
  world.trainee = await member(world.orgA, 'stajyer', 'trainee');
  world.assistant = await member(world.orgA, 'asistan', 'assistant');
  world.pending = await member(world.orgA, 'bekleyen', 'lawyer', 'pending_verification');
  world.ownerB = await member(world.orgB, 'sahipb', 'owner');
  // Büro ayarları ve büro DEK'i (org-bootstrap ile aynı biçim: KEK ile sarılı, sürüm 1).
  for (const [org, who] of [
    [world.orgA, world.owner],
    [world.orgB, world.ownerB],
  ] as const) {
    await inOrg(who, async (tx) => {
      await tx.query('INSERT INTO app.org_settings (org_id) VALUES ($1)', [org]);
      await tx.query(
        'INSERT INTO app.org_keys (org_id, key_version, wrapped_dek, kek_version) VALUES ($1, 1, $2, 1)',
        [org, wrapDek(KEK, { orgId: org, dekVersion: 1, kekVersion: 1 }, generateFileKey())],
      );
    });
  }

  const jobs: FileJobProducer = {
    addFileScan: async (r) => {
      scanJobs.push(r);
    },
    failedCount: () => 0,
    close: async () => undefined,
  };
  const files = createFilesService({
    db: runner(),
    store,
    keyring: createKeyring({ keks: [{ kek: KEK, kekVersion: 1 }] }),
    jobs,
    tokens: tokenStore,
    onIntegrityFailure: (e) => integrity.push(e),
    edaEnv: 'test',
    uuid: () => uuidv7(),
    limits: { maxBytes: MAX_BYTES, maxConcurrentPerUser: 3 },
  });
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
      documents: {} as never,
      calendar: {} as never,
      cases: createCasesService({ db: runner() }),
      files,
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

// ---------- KK-P20-7 ----------

describe('KK-P20-7: yükleme -> liste -> okuma', () => {
  it('dava evrakı: 201, güvenli alanlar, şifreli nesne, custody upload, file.scan işi', async () => {
    const caseId = await createCase(world.lawyer1);
    const content = pdf(150_000);
    const before = scanJobs.length;
    const r = await upload(world.lawyer1, `${NAME_MARK} Dilekçe.pdf`, content, { caseId });
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const f = r.json.file;
    expect(Object.keys(f).sort()).toEqual(
      [
        'caseId',
        'createdAt',
        'fileType',
        'hasClean',
        'hasSearchable',
        'id',
        'mine',
        'name',
        'origin',
        'pageCount',
        'progressDone',
        'progressTotal',
        'scanned',
        'sha256',
        'sizeBytes',
        'status',
        'statusReason',
        'updatedAt',
      ].sort(),
    );
    expect(f).toMatchObject({
      caseId,
      origin: 'case_upload',
      name: `${NAME_MARK} Dilekçe.pdf`,
      fileType: 'pdf',
      sizeBytes: content.length,
      sha256: sha(content),
      status: 'uploaded',
      scanned: false,
      mine: true,
    });

    // Nesne anahtarı satır değerlerinden türetilir; ad ve kullanıcı verisi içermez.
    const row = await rowOf(world.lawyer1, f.id);
    expect(row.object_key).toBe(`org/${world.orgA}/case/${caseId}/${f.id}`);
    expect(row.object_key).not.toContain(NAME_MARK);
    expect(row.mime_type).toBe('application/pdf');
    expect(row.scanned_at).toBeNull();
    expect(row.inbox_expires_at).toBeNull();
    expect(row.key_version).toBe(1);
    expect(row.wrap_dek_version).toBe(1);
    expect(row.wrapped_file_key.length).toBe(60);

    // Şifreli nesne: boyut formülü, EDAE başlığı, düz metin işareti yok, bağımsız çözüm özdeş.
    const obj = store.objects.get(row.object_key);
    expect(obj?.length).toBe(sealedLength(content.length));
    expect(obj?.subarray(0, 4).toString('ascii')).toBe('EDAE');
    expect(obj?.includes(Buffer.from(BODY_MARK))).toBe(false);
    expect((await decryptStored(world.lawyer1, f.id)).equals(content)).toBe(true);

    // Delil zinciri: yükleme anında aynı işlemde `upload` olayı; içeriksiz meta.
    const events = await custodyOf(world.lawyer1, f.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'upload',
      actor_type: 'user',
      actor_id: world.lawyer1.id,
    });
    expect((events[0].sha256 as Buffer).toString('hex')).toBe(sha(content));
    expect(events[0].metadata).toEqual({
      size_bytes: content.length,
      file_type: 'pdf',
      origin: 'case_upload',
      case_id: caseId,
    });

    // COMMIT sonrası tek file.scan işi; yük yalnız kimlik (ad yok).
    expect(scanJobs.length).toBe(before + 1);
    const job = scanJobs[scanJobs.length - 1];
    expect(job).toMatchObject({
      orgId: world.orgA,
      fileId: f.id,
      userId: world.lawyer1.id,
      batch: false,
    });
    expect(JSON.stringify(job)).not.toContain(NAME_MARK);
  });

  it('liste ve tek okuma; imleçle sayfalama; ad Türkçe NFC, yol ayırıcısız', async () => {
    const caseId = await createCase(world.lawyer1);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await upload(
        world.lawyer1,
        `..\\Örnek Delil ${i}.pdf`,
        pdf(2000 + i * 50, `m${i}`),
        {
          caseId,
        },
      );
      expect(r.status).toBe(201);
      expect(r.json.file.name).toBe(`Örnek Delil ${i}.pdf`);
      ids.push(r.json.file.id);
    }
    const page1 = await call(world.lawyer2, 'GET', `/api/v1/cases/${caseId}/files?limit=2`);
    expect(page1.status).toBe(200);
    expect(page1.json.items).toHaveLength(2);
    expect(page1.json.nextCursor).not.toBeNull();
    expect(page1.json.items[0].mine).toBe(false);
    const page2 = await call(
      world.lawyer2,
      'GET',
      `/api/v1/cases/${caseId}/files?limit=2&cursor=${encodeURIComponent(page1.json.nextCursor)}`,
    );
    const seen = [...page1.json.items, ...page2.json.items].map((x: { id: string }) => x.id);
    expect(new Set(seen).size).toBe(3);
    expect(page2.json.nextCursor).toBeNull();
    const one = await call(world.lawyer2, 'GET', `/api/v1/files/${ids[0]}`);
    expect(one.status).toBe(200);
    expect(one.json.id).toBe(ids[0]);
    const filtered = await call(world.lawyer2, 'GET', `/api/v1/cases/${caseId}/files?status=ready`);
    expect(filtered.json.items).toEqual([]);
  });

  it('davasız yükleme sohbet eki olur: inbox anahtarı, son kullanma tarihi, yalnız yükleyen görür', async () => {
    const r = await upload(world.lawyer1, 'ek.txt', Buffer.from('Örnek ek metni.\n'));
    expect(r.status).toBe(201);
    expect(r.json.file).toMatchObject({ caseId: null, origin: 'chat_attachment', fileType: 'txt' });
    const row = await rowOf(world.lawyer1, r.json.file.id);
    expect(row.object_key).toBe(`org/${world.orgA}/inbox/${r.json.file.id}`);
    expect(row.inbox_expires_at).not.toBeNull();
    expect((await call(world.lawyer1, 'GET', `/api/v1/files/${r.json.file.id}`)).status).toBe(200);
    for (const other of [world.lawyer2, world.owner, world.ownerB]) {
      const g = await call(other, 'GET', `/api/v1/files/${r.json.file.id}`);
      expect(g.status).toBe(404);
      expect(errOf(g).code).toBe('FILE_NOT_FOUND');
    }
  });

  it('batch=true işi files-batch için işaretler; originId saklanır', async () => {
    const conversationId = randomUUID();
    const r = await upload(world.lawyer1, 'toplu.txt', Buffer.from('toplu\n'), {
      batch: 'true',
      originId: conversationId,
    });
    expect(r.status).toBe(201);
    expect(scanJobs[scanJobs.length - 1]?.batch).toBe(true);
    expect((await rowOf(world.lawyer1, r.json.file.id)).origin_id).toBe(conversationId);
  });
});

// ---------- KK-P20-8 ----------

describe('KK-P20-8: boyut sınırları ve boş dosya', () => {
  it('tam sınır kabul edilir; bir bayt fazlası 413 FILE_TOO_LARGE ve iz bırakmaz', async () => {
    const caseId = await createCase(world.lawyer1);
    const exact = await upload(world.lawyer1, 'sinir.pdf', pdf(MAX_BYTES, 'tam'), { caseId });
    expect(exact.status).toBe(201);
    expect(exact.json.file.sizeBytes).toBe(MAX_BYTES);

    const objectsBefore = store.objects.size;
    const rowsBefore = (await call(world.lawyer1, 'GET', `/api/v1/cases/${caseId}/files`)).json
      .items.length;
    const over = await upload(world.lawyer1, 'fazla.pdf', pdf(MAX_BYTES + 1, 'fazla'), { caseId });
    expect(over.status).toBe(413);
    expect(errOf(over).code).toBe('FILE_TOO_LARGE');
    expect(errOf(over).meta).toEqual({ maxBytes: MAX_BYTES });
    expect(store.objects.size).toBe(objectsBefore);
    expect(
      (await call(world.lawyer1, 'GET', `/api/v1/cases/${caseId}/files`)).json.items.length,
    ).toBe(rowsBefore);
  });

  it('Content-Length sınırı aşıyorsa gövde okunmadan 413', async () => {
    const res = await app.request(`${APP_URL}/api/v1/files`, {
      method: 'POST',
      headers: {
        origin: APP_URL,
        'x-test-user': world.lawyer1.id,
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(MAX_BYTES * 10),
      },
      body: 'x',
    });
    expect(res.status).toBe(413);
  });

  it('0 baytlık dosya 422 VALIDATION_FAILED (empty_file)', async () => {
    const r = await upload(world.lawyer1, 'bos.txt', Buffer.alloc(0));
    expect(r.status).toBe(422);
    expect(errOf(r)).toMatchObject({ code: 'VALIDATION_FAILED', reason: 'empty_file' });
  });
});

// ---------- KK-P20-9 ----------

describe('KK-P20-9: tür doğrulama içeriktendir', () => {
  const rejected = async (name: string, content: Buffer, reason: string) => {
    const objectsBefore = store.objects.size;
    const r = await upload(world.lawyer1, name, content);
    expect(r.status, name).toBe(415);
    expect(errOf(r)).toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED', reason });
    expect(errOf(r).meta?.allowedTypes).toContain('pdf');
    expect(store.objects.size, `${name}: nesne kalmamalı`).toBe(objectsBefore);
  };

  it('uzantı-içerik uyuşmazlığı, zip/docm/md ve çalıştırılabilir reddedilir', async () => {
    await rejected('resim.png', pdf(3000, 'a'), 'type_mismatch');
    await rejected('zararsiz.pdf', Buffer.from('MZ\x90\x00\x03\x00\x00\x00 gibi'), 'type_mismatch');
    await rejected('arsiv.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]), 'unsupported');
    await rejected('makro.docm', Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]), 'unsupported');
    await rejected('not.md', Buffer.from('# Başlık\n'), 'unsupported');
    await rejected('kurulum.exe', Buffer.from('MZ\x90\x00'), 'unsupported');
  });

  it('istemci Content-Type başlığı yok sayılır: png içeriği "application/pdf" bildirse de pdf olmaz', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(100, 1),
    ]);
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'application/pdf' }), 'a.pdf');
    const res = await read(
      await app.request(`${APP_URL}/api/v1/files`, {
        method: 'POST',
        headers: { origin: APP_URL, 'x-test-user': world.lawyer1.id },
        body: form,
      }),
    );
    expect(res.status).toBe(415);
    expect(errOf(res).reason).toBe('type_mismatch');
  });

  it('docx/udf uzantılı ZIP geçici türle kabul edilir; txt ve görüntüler kabul', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0]), Buffer.alloc(200, 7)]);
    for (const [name, type] of [
      ['sozlesme.docx', 'docx'],
      ['karar.udf', 'udf'],
    ] as const) {
      const r = await upload(world.lawyer1, name, zip);
      expect(r.status, name).toBe(201);
      expect(r.json.file.fileType).toBe(type);
    }
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 2),
    ]);
    const r = await upload(world.lawyer1, 'tarama.PNG', png);
    expect(r.status).toBe(201);
    expect(r.json.file.fileType).toBe('png');
  });
});

// ---------- KK-P20-10 ----------

describe('KK-P20-10: mükerrer tespit yalnız aynı dava içinde', () => {
  it('aynı davada aynı içerik 409 FILE_DUPLICATE (existingFileId), nesne kalmaz; inbox ve başka dava serbest', async () => {
    const caseA = await createCase(world.lawyer1);
    const caseB = await createCase(world.lawyer1);
    const content = pdf(5000, 'ayni');
    const first = await upload(world.lawyer1, 'bir.pdf', content, { caseId: caseA });
    expect(first.status).toBe(201);
    const objectsBefore = store.objects.size;
    const dup = await upload(world.lawyer2, 'iki.pdf', content, { caseId: caseA });
    expect(dup.status).toBe(409);
    expect(errOf(dup)).toMatchObject({
      code: 'FILE_DUPLICATE',
      reason: 'same_hash_in_case',
      meta: { existingFileId: first.json.file.id },
    });
    expect(store.objects.size).toBe(objectsBefore);
    expect((await upload(world.lawyer1, 'bir.pdf', content, { caseId: caseB })).status).toBe(201);
    expect((await upload(world.lawyer1, 'bir.pdf', content)).status).toBe(201);
    expect((await upload(world.lawyer1, 'bir.pdf', content)).status).toBe(201);
  });

  it('eşzamanlı iki aynı yükleme tek satır bırakır', async () => {
    const caseId = await createCase(world.lawyer1);
    const content = pdf(4000, 'yaris');
    const [a, b] = await Promise.all([
      upload(world.lawyer1, 'a.pdf', content, { caseId }),
      upload(world.lawyer2, 'b.pdf', content, { caseId }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const list = await call(world.lawyer1, 'GET', `/api/v1/cases/${caseId}/files`);
    expect(list.json.items).toHaveLength(1);
    const keysForCase = [...store.objects.keys()].filter((k) => k.includes(`/case/${caseId}/`));
    expect(keysForCase).toHaveLength(1);
  });
});

// ---------- KK-P20-11 ----------

describe('KK-P20-11: yetki ve büro izolasyonu', () => {
  it('başka büro dava ve evrakı göremez, yükleyemez (varlık sızdırma yok)', async () => {
    const caseId = await createCase(world.lawyer1);
    const f = await upload(world.lawyer1, 'gizli.pdf', pdf(3000, 'g'), { caseId });
    const get = await call(world.ownerB, 'GET', `/api/v1/files/${f.json.file.id}`);
    expect(get.status).toBe(404);
    expect(errOf(get).code).toBe('FILE_NOT_FOUND');
    expect(errOf(await call(world.ownerB, 'GET', `/api/v1/cases/${caseId}/files`)).code).toBe(
      'CASE_NOT_FOUND',
    );
    const up = await upload(world.ownerB, 'x.pdf', pdf(3000, 'x'), { caseId });
    expect(up.status).toBe(404);
    expect(errOf(up).code).toBe('CASE_NOT_FOUND');
    const del = await call(world.ownerB, 'DELETE', `/api/v1/files/${f.json.file.id}`);
    expect(del.status).toBe(404);
  });

  it('kısıtlı dava: ekip dışı kullanıcı liste, okuma, yükleme ve silmede 404', async () => {
    const caseId = await createCase(world.lawyer1, 'restricted');
    const f = await upload(world.lawyer1, 'kisitli.pdf', pdf(3000, 'k'), { caseId });
    expect(f.status).toBe(201);
    expect(errOf(await call(world.lawyer2, 'GET', `/api/v1/cases/${caseId}/files`)).code).toBe(
      'CASE_NOT_FOUND',
    );
    expect((await call(world.lawyer2, 'GET', `/api/v1/files/${f.json.file.id}`)).status).toBe(404);
    expect((await upload(world.lawyer2, 'y.pdf', pdf(3000, 'y'), { caseId })).status).toBe(404);
    expect((await call(world.lawyer2, 'DELETE', `/api/v1/files/${f.json.file.id}`)).status).toBe(
      404,
    );
  });

  it('doğrulanmamış kullanıcı 403 AUTH_PENDING_VERIFICATION; oturumsuz 401', async () => {
    const r = await upload(world.pending, 'a.txt', Buffer.from('x\n'));
    expect(r.status).toBe(403);
    expect(errOf(r).code).toBe('AUTH_PENDING_VERIFICATION');
    const anon = await app.request(`${APP_URL}/api/v1/files`, {
      method: 'POST',
      headers: { origin: APP_URL },
      body: formOf('a.txt', Buffer.from('x\n')),
    });
    expect(anon.status).toBe(401);
  });

  it('metin alanı sonrası dosya zorunlu: file önce gelirse, bilinmeyen alan, caseId + origin birlikte 422', async () => {
    const caseId = await createCase(world.lawyer1);
    const objectsBefore = store.objects.size;
    const late = await upload(world.lawyer1, 'a.txt', Buffer.from('x\n'), { caseId }, 'file-first');
    expect(late.status).toBe(422);
    expect(errOf(late).code).toBe('VALIDATION_FAILED');
    const unknown = await upload(world.lawyer1, 'a.txt', Buffer.from('x\n'), { orgId: world.orgB });
    expect(unknown.status).toBe(422);
    const both = await upload(world.lawyer1, 'a.txt', Buffer.from('x\n'), {
      caseId,
      origin: 'chat_attachment',
    });
    expect(both.status).toBe(422);
    const noFile = await read(
      await app.request(`${APP_URL}/api/v1/files`, {
        method: 'POST',
        headers: { origin: APP_URL, 'x-test-user': world.lawyer1.id },
        body: (() => {
          const f = new FormData();
          f.append('caseId', caseId);
          return f;
        })(),
      }),
    );
    expect(noFile.status).toBe(422);
    const json = await call(world.lawyer1, 'POST', '/api/v1/files', { a: 1 });
    expect(json.status).toBe(415);
    expect(store.objects.size).toBe(objectsBefore);
  });
});

// ---------- KK-P20-12 ----------

describe('KK-P20-12: iki aşamalı silme, yasal saklama, rol kuralları', () => {
  it('silme istenen evrak anında liste ve okumadan çıkar; custody delete_request grace ile', async () => {
    const caseId = await createCase(world.lawyer1);
    const f = await upload(world.lawyer1, 'silinecek.pdf', pdf(3000, 's'), { caseId });
    const del = await call(world.lawyer1, 'DELETE', `/api/v1/files/${f.json.file.id}`);
    expect(del.status).toBe(200);
    expect(del.json.id).toBe(f.json.file.id);
    const grace = Date.parse(del.json.graceUntil) - Date.parse(del.json.deleteRequestedAt);
    expect(Math.round(grace / 86_400_000)).toBe(7);
    expect((await call(world.lawyer1, 'GET', `/api/v1/files/${f.json.file.id}`)).status).toBe(404);
    expect((await call(world.lawyer1, 'GET', `/api/v1/cases/${caseId}/files`)).json.items).toEqual(
      [],
    );
    const events = await custodyOf(world.lawyer1, f.json.file.id);
    expect(events.map((e) => e.event)).toEqual(['upload', 'delete_request']);
    expect(Object.keys(events[1].metadata).sort()).toEqual(['grace_until', 'reason']);
    // Nesne ve satır grace süresince saklıdır (fiilî imha retention.purge).
    expect(store.objects.has((await rowOf(world.lawyer1, f.json.file.id)).object_key)).toBe(true);
    // Aynı içerik silinmiş kopya varken yeniden yüklenebilir.
    const again = await upload(world.lawyer1, 'silinecek.pdf', pdf(3000, 's'), { caseId });
    expect(again.status).toBe(201);
    // İkinci silme isteği 404.
    expect((await call(world.lawyer1, 'DELETE', `/api/v1/files/${f.json.file.id}`)).status).toBe(
      404,
    );
  });

  it('rol matrisi: stajyer yalnız kendi evrakını siler; avukat başkasınınkini silebilir; asistan başkasınınkini silemez', async () => {
    const caseId = await createCase(world.lawyer1);
    const byLawyer = await upload(world.lawyer1, 'avukat.pdf', pdf(2500, 'l'), { caseId });
    const byTrainee = await upload(world.trainee, 'stajyer.pdf', pdf(2600, 't'), { caseId });
    expect(byTrainee.status).toBe(201);
    const denied = await call(world.trainee, 'DELETE', `/api/v1/files/${byLawyer.json.file.id}`);
    expect(denied.status).toBe(403);
    expect(errOf(denied).code).toBe('ORG_ROLE_INSUFFICIENT');
    const asstDenied = await call(
      world.assistant,
      'DELETE',
      `/api/v1/files/${byLawyer.json.file.id}`,
    );
    expect(asstDenied.status).toBe(403);
    expect(
      (await call(world.trainee, 'DELETE', `/api/v1/files/${byTrainee.json.file.id}`)).status,
    ).toBe(200);
    const byAsst = await upload(world.assistant, 'asistan.pdf', pdf(2700, 'a'), { caseId });
    expect(byAsst.status).toBe(201);
    expect(
      (await call(world.lawyer2, 'DELETE', `/api/v1/files/${byAsst.json.file.id}`)).status,
    ).toBe(200);
    expect(
      (await call(world.lawyer1, 'GET', `/api/v1/files/${byLawyer.json.file.id}`)).status,
    ).toBe(200);
  });

  it('dava yasal saklamada, arşivde veya büro yasal saklamada: 409 FILE_DELETE_BLOCKED', async () => {
    const heldCase = await createCase(world.lawyer1);
    const held = await upload(world.lawyer1, 'hold.pdf', pdf(2500, 'h'), { caseId: heldCase });
    await inOrg(world.lawyer1, (tx) =>
      tx.query('UPDATE app.cases SET legal_hold = true WHERE id = $1', [heldCase]),
    );
    const r1 = await call(world.lawyer1, 'DELETE', `/api/v1/files/${held.json.file.id}`);
    expect(r1.status).toBe(409);
    expect(errOf(r1)).toMatchObject({ code: 'FILE_DELETE_BLOCKED', reason: 'legal_hold' });
    expect((await call(world.lawyer1, 'GET', `/api/v1/files/${held.json.file.id}`)).status).toBe(
      200,
    );

    const archivedCase = await createCase(world.lawyer1);
    const arch = await upload(world.lawyer1, 'arsiv.pdf', pdf(2500, 'r'), { caseId: archivedCase });
    await inOrg(world.lawyer1, (tx) =>
      tx.query(
        `UPDATE app.cases SET status = 'archived', mandate_ended_at = now(), closed_date = current_date WHERE id = $1`,
        [archivedCase],
      ),
    );
    const r2 = await call(world.lawyer1, 'DELETE', `/api/v1/files/${arch.json.file.id}`);
    expect(r2.status).toBe(409);
    expect(errOf(r2).reason).toBe('case_archived');
    // Arşivli davaya yükleme 404 CASE_NOT_FOUND (033 §6.1 #4).
    expect(
      (await upload(world.lawyer1, 'yeni.pdf', pdf(2500, 'n'), { caseId: archivedCase })).status,
    ).toBe(404);

    const caseC = await createCase(world.lawyer1);
    const org = await upload(world.lawyer1, 'org.pdf', pdf(2500, 'o'), { caseId: caseC });
    await inOrg(world.owner, (tx) =>
      tx.query('UPDATE app.org_settings SET legal_hold = true WHERE org_id = $1', [world.orgA]),
    );
    try {
      const r3 = await call(world.lawyer1, 'DELETE', `/api/v1/files/${org.json.file.id}`);
      expect(r3.status).toBe(409);
      expect(errOf(r3).reason).toBe('legal_hold');
    } finally {
      await inOrg(world.owner, (tx) =>
        tx.query('UPDATE app.org_settings SET legal_hold = false WHERE org_id = $1', [world.orgA]),
      );
    }
  });

  it('karantinadaki evrak grace olmadan silinir: satır, nesne ve zincir; custody delete olayı kalır', async () => {
    const caseId = await createCase(world.lawyer1);
    const f = await upload(world.lawyer1, 'virus.pdf', pdf(2500, 'v'), { caseId });
    const key = (await rowOf(world.lawyer1, f.json.file.id)).object_key as string;
    await inOrg(world.lawyer1, (tx) =>
      tx.query(
        `UPDATE app.files SET status = 'quarantined', status_reason = 'av_detected' WHERE id = $1`,
        [f.json.file.id],
      ),
    );
    const del = await call(world.lawyer1, 'DELETE', `/api/v1/files/${f.json.file.id}`);
    expect(del.status).toBe(200);
    expect(del.json.graceUntil).toBe(del.json.deleteRequestedAt);
    expect(await rowOf(world.lawyer1, f.json.file.id)).toBeUndefined();
    // Nesne COMMIT sonrası silinir (asenkron afterCommit).
    for (let i = 0; i < 20 && store.objects.has(key); i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(store.objects.has(key)).toBe(false);
    // Zincir kaydı FK'sizdir ve kalır; ancak okuma RLS'si evrak satırına bağlı olduğundan silinmiş
    // evrakın zinciri uygulama rolüyle okunamaz (ayrı okuma yolu).
    expect(
      (
        await inOrg<{ rows: Json[] }>(world.lawyer1, (tx) =>
          tx.query('SELECT 1 FROM app.custody_events WHERE file_id = $1', [f.json.file.id]),
        )
      ).rows,
    ).toEqual([]);
  });
});

// ---------- KK-P20-13 ----------

describe('KK-P20-13: depo hataları ve temizlik', () => {
  it('objstore kapalıyken 503 INTERNAL_DEPENDENCY_UNAVAILABLE ve satır yok', async () => {
    const caseId = await createCase(world.lawyer1);
    store.unavailable = true;
    try {
      const r = await upload(world.lawyer1, 'a.pdf', pdf(3000, 'd'), { caseId });
      expect(r.status).toBe(503);
      expect(errOf(r)).toMatchObject({
        code: 'INTERNAL_DEPENDENCY_UNAVAILABLE',
        reason: 'storage',
      });
    } finally {
      store.unavailable = false;
    }
    expect((await call(world.lawyer1, 'GET', `/api/v1/cases/${caseId}/files`)).json.items).toEqual(
      [],
    );
  });

  it('akış ortasında depo koparsa 503, nesne ve kayıt kalmaz', async () => {
    const caseId = await createCase(world.lawyer1);
    const before = store.objects.size;
    store.failPutAfterBytes = 1000;
    const r = await upload(world.lawyer1, 'a.pdf', pdf(100_000, 'e'), { caseId });
    expect(r.status).toBe(503);
    expect(store.objects.size).toBe(before);
    expect((await call(world.lawyer1, 'GET', `/api/v1/cases/${caseId}/files`)).json.items).toEqual(
      [],
    );
  });

  it('büro DEK’i yoksa 503 storage (yükleme yapılamaz)', async () => {
    const orgC = await db.auth.insertOrg('Örnek Büro C', 'firm');
    await db.auth.grantSeats(orgC, 2);
    const ownerC = await member(orgC, 'sahipc', 'owner');
    const r = await upload(ownerC, 'a.txt', Buffer.from('x\n'));
    expect(r.status).toBe(503);
    expect(errOf(r).code).toBe('INTERNAL_DEPENDENCY_UNAVAILABLE');
  });

  it('beta-synthetic ortamında yükleme kapalıdır (403 FILE_UPLOAD_DISABLED)', async () => {
    const svc = createFilesService({
      db: runner(),
      store,
      keyring: createKeyring({ keks: [{ kek: KEK, kekVersion: 1 }] }),
      jobs: {
        addFileScan: async () => undefined,
        failedCount: () => 0,
        close: async () => undefined,
      },
      edaEnv: 'beta-synthetic',
      uuid: () => uuidv7(),
    });
    await expect(
      svc.upload(
        { orgId: world.orgA, userId: world.lawyer1.id, memberRole: 'lawyer' },
        {
          body: undefined as never,
          contentType: 'multipart/form-data; boundary=x',
          contentLength: null,
          ipTrunc: null,
        },
      ),
    ).rejects.toMatchObject({ code: 'FILE_UPLOAD_DISABLED' });
  });

  it('dava başına evrak sınırı: 422 VALIDATION_FAILED (case_file_limit)', async () => {
    const svc = createFilesService({
      db: runner(),
      store,
      keyring: createKeyring({ keks: [{ kek: KEK, kekVersion: 1 }] }),
      jobs: {
        addFileScan: async () => undefined,
        failedCount: () => 0,
        close: async () => undefined,
      },
      edaEnv: 'test',
      uuid: () => uuidv7(),
      limits: { maxFilesPerCase: 1 },
    });
    const caseId = await createCase(world.lawyer1);
    expect((await upload(world.lawyer1, 'a.pdf', pdf(2500, 'l1'), { caseId })).status).toBe(201);
    // Aynı servis örneği HTTP zincirinde olmadığı için çoklu parça gövdesini doğrudan veririz.
    const form = formOf('b.pdf', pdf(2500, 'l2'), { caseId });
    const req = new Request('https://x.test/', { method: 'POST', body: form });
    const { Readable } = await import('node:stream');
    const err = await svc
      .upload(
        { orgId: world.orgA, userId: world.lawyer1.id, memberRole: 'lawyer' },
        {
          body: Readable.fromWeb(req.body as never),
          contentType: req.headers.get('content-type') ?? '',
          contentLength: null,
          ipTrunc: null,
        },
      )
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED', reason: 'case_file_limit' });
  });
});

// ---------- KK-P20-14 ----------

/** Gövdesi `gate` açılana dek durdurulan çok parçalı yükleme (eşzamanlılık sınırı testi). */
function stalledUpload(as: Actor, gate: Promise<void>): Promise<Res> {
  const boundary = `----eda${randomUUID().slice(0, 8)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="yavas.txt"\r\n` +
      'Content-Type: text/plain\r\n\r\nilk parça\n',
  );
  const tail = Buffer.from(`ikinci parça\n\r\n--${boundary}--\r\n`);
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      c.enqueue(head);
      await gate;
      c.enqueue(tail);
      c.close();
    },
  });
  return Promise.resolve(
    app.request(`${APP_URL}/api/v1/files`, {
      method: 'POST',
      headers: {
        origin: APP_URL,
        'x-test-user': as.id,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      duplex: 'half',
    } as RequestInit),
  ).then(read);
}

describe('KK-P20-14: eşzamanlı yükleme sınırı', () => {
  it('kullanıcı başına 3 yükleme; dördüncüsü 429 QUOTA_CONCURRENCY_LIMIT; slotlar bırakılınca açılır', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const running = [1, 2, 3].map(() => stalledUpload(world.lawyer2, gate));
    await new Promise((r) => setTimeout(r, 100));
    const fourth = await upload(world.lawyer2, 'dorduncu.txt', Buffer.from('x\n'));
    expect(fourth.status).toBe(429);
    expect(errOf(fourth)).toMatchObject({ code: 'QUOTA_CONCURRENCY_LIMIT', reason: 'upload' });
    // Başka kullanıcı etkilenmez.
    expect((await upload(world.lawyer1, 'baska.txt', Buffer.from('y\n'))).status).toBe(201);
    open();
    const done = await Promise.all(running);
    expect(done.map((d) => d.status)).toEqual([201, 201, 201]);
    expect((await upload(world.lawyer2, 'bes.txt', Buffer.from('z\n'))).status).toBe(201);
  });
});

// ---------- KK-P20-15 / 16 ----------

describe('KK-P20-15: ad ve içerik log, DB meta ve iş yükünde yok', () => {
  it('işaretli ad/içerik hiçbir log satırında, custody meta’sında veya iş yükünde geçmez', async () => {
    const caseId = await createCase(world.lawyer1);
    await upload(world.lawyer1, `${NAME_MARK} gizli.pdf`, pdf(4000), { caseId });
    await upload(world.lawyer1, `${NAME_MARK}.png`, pdf(4000), { caseId }); // 415
    await upload(world.lawyer1, `${NAME_MARK} büyük.pdf`, pdf(MAX_BYTES + 5), { caseId }); // 413
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.filter((l) => l.includes(NAME_MARK) || l.includes(BODY_MARK))).toEqual([]);
    const meta = await inOrg<{ rows: Json[] }>(world.lawyer1, (tx) =>
      tx.query('SELECT metadata::text AS m FROM app.custody_events WHERE org_id = $1', [
        world.orgA,
      ]),
    );
    expect(meta.rows.filter((r) => String(r.m).includes(NAME_MARK))).toEqual([]);
    expect(JSON.stringify(scanJobs)).not.toContain(NAME_MARK);
    // Nesne anahtarlarında ad yok.
    expect([...store.objects.keys()].some((k) => k.includes(NAME_MARK))).toBe(false);
  });
});

describe('KK-P20-16: rota meta verisi', () => {
  it('yükleme rotası clientData, upload gövdesi ve upload zaman aşımı taşır', () => {
    const route = registry.find('POST', '/api/v1/files');
    expect(route?.meta).toMatchObject({
      permission: 'file:upload',
      clientData: true,
      body: 'upload',
      timeout: 'upload',
      stepUp: false,
    });
    expect(registry.find('GET', '/api/v1/files/{fileId}')?.meta.permission).toBe('file:read');
    expect(registry.find('GET', '/api/v1/cases/{caseId}/files')?.meta.clientData).toBe(false);
  });
});

// ---------- indirme ----------

/** Worker taramasını taklit eder: temiz tarama `scanned_at` yazar (D5). */
async function markScanned(as: Actor, id: string, status = 'ready'): Promise<void> {
  await inOrg(as, (tx) =>
    tx.query('UPDATE app.files SET scanned_at = now(), status = $2 WHERE id = $1', [id, status]),
  );
}

async function uploadScanned(
  as: Actor,
  name: string,
  content: Buffer,
  caseId?: string,
): Promise<string> {
  const r = await upload(as, name, content, caseId === undefined ? {} : { caseId });
  expect(r.status).toBe(201);
  await markScanned(as, r.json.file.id);
  return r.json.file.id as string;
}

async function token(as: Actor, fileId: string, body?: unknown): Promise<Res> {
  return call(as, 'POST', `/api/v1/files/${fileId}/download-token`, body);
}

async function get(as: Actor, path: string, extra: Record<string, string> = {}): Promise<Response> {
  return app.request(`${APP_URL}${path}`, {
    method: 'GET',
    headers: { origin: APP_URL, 'x-test-user': as.id, ...extra },
  });
}

async function bytesOf(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

describe('KK-P20-25: belirteçle indirme, başlıklar ve custody', () => {
  it('tam akış: belirteç -> içerik özdeş; güvenli başlıklar; custody download (via_token)', async () => {
    const content = pdf(150_000, 'indir');
    const id = await uploadScanned(world.lawyer1, `${NAME_MARK} Örnek Dilekçe.pdf`, content);
    const t = await token(world.lawyer1, id);
    expect(t.status).toBe(200);
    expect(t.json.expiresInSec).toBe(60);
    expect(t.json.url).toMatch(new RegExp(`^/api/v1/files/${id}/content\\?dt=[A-Za-z0-9_-]{43}$`));
    // Ham belirteç depoda tutulmaz: yalnız SHA-256 özeti anahtardır.
    const raw = (t.json.url as string).split('dt=')[1] as string;
    expect(tokenRows.has(raw)).toBe(false);
    expect([...tokenRows.keys()].every((k) => /^[0-9a-f]{64}$/.test(k))).toBe(true);

    const res = await get(world.lawyer1, t.json.url);
    expect(res.status).toBe(200);
    expect((await bytesOf(res)).equals(content)).toBe(true);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${NAME_MARK} Ornek Dilekce.pdf"; filename*=UTF-8''${encodeURIComponent(`${NAME_MARK} Örnek Dilekçe.pdf`)}`,
    );
    expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe(String(content.length));
    expect(res.headers.get('vary')).toBe('Cookie');
    expect(res.headers.get('set-cookie')).toBeNull();

    const events = await custodyOf(world.lawyer1, id);
    expect(events.map((e) => e.event)).toEqual(['upload', 'download']);
    expect(events[1].metadata).toEqual({ variant: 'orig', range: null, via_token: true });
    expect(events[1].actor_id).toBe(world.lawyer1.id);
  });

  it('belirteçsiz (oturumla) indirme de çalışır; custody via_token=false; her indirme ayrı olay', async () => {
    const content = pdf(5000, 'oturum');
    const id = await uploadScanned(world.lawyer1, 'oturum.pdf', content);
    for (let i = 0; i < 2; i++) {
      const res = await get(
        world.lawyer2 === undefined ? world.lawyer1 : world.lawyer1,
        `/api/v1/files/${id}/content`,
      );
      expect(res.status).toBe(200);
      expect((await bytesOf(res)).equals(content)).toBe(true);
    }
    const events = await custodyOf(world.lawyer1, id);
    expect(events.filter((e) => e.event === 'download')).toHaveLength(2);
    expect(events[1].metadata.via_token).toBe(false);
  });

  it('başlık enjeksiyonu: CR/LF, tırnak ve yol ayırıcısı içeren ad tek satırlı güvenli başlık verir', async () => {
    const id = await uploadScanned(
      world.lawyer1,
      'a"b\r\nX-Evil: 1;/..\\x.pdf',
      pdf(3000, 'baslik'),
    );
    const res = await get(world.lawyer1, `/api/v1/files/${id}/content`);
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).not.toMatch(/[\r\n]/);
    expect(res.headers.get('x-evil')).toBeNull();
    expect(cd.startsWith('attachment; filename="')).toBe(true);
    expect(cd.split('"')).toHaveLength(3);
    await res.arrayBuffer();
  });

  it('Content-Type tablodan: txt için text/plain; docx için OOXML; istemci başlığı etkisiz', async () => {
    const txt = await upload(world.lawyer1, 'not.txt', Buffer.from('Örnek metin\n'));
    await markScanned(world.lawyer1, txt.json.file.id);
    const r = await get(world.lawyer1, `/api/v1/files/${txt.json.file.id}/content`);
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect((await bytesOf(r)).toString('utf8')).toBe('Örnek metin\n');
  });
});

describe('KK-P20-26: tek kullanımlık belirteç', () => {
  it('ikinci kullanım, başka kullanıcı, başka evrak, süre aşımı ve sahte belirteç 403 download_token_invalid', async () => {
    // Dava evrakı: büroda görünür (inbox yalnız yükleyene görünür), böylece reddin nedeni belirteçtir.
    const caseId = await createCase(world.lawyer1);
    const id = await uploadScanned(world.lawyer1, 'bir.pdf', pdf(3000, 'tk1'), caseId);
    const other = await uploadScanned(world.lawyer1, 'iki.pdf', pdf(3100, 'tk2'), caseId);
    const forbidden = async (res: Response) => {
      expect(res.status).toBe(403);
      const body = (await res.json()) as Json;
      expect(body.error).toMatchObject({
        code: 'AUTH_FORBIDDEN',
        reason: 'download_token_invalid',
      });
    };
    // Tek kullanım.
    const t1 = await token(world.lawyer1, id);
    expect((await get(world.lawyer1, t1.json.url)).status).toBe(200);
    await forbidden(await get(world.lawyer1, t1.json.url));
    // Başka kullanıcı (aynı büro) belirteci kullanamaz; yanlış denemede belirteç YANAR.
    const t2 = await token(world.lawyer1, id);
    await forbidden(await get(world.lawyer2, t2.json.url));
    await forbidden(await get(world.lawyer1, t2.json.url));
    // Başka evrak için üretilen belirteç bu evrakta geçmez.
    const t3 = await token(world.lawyer1, other);
    const swapped = (t3.json.url as string).replace(other, id);
    await forbidden(await get(world.lawyer1, swapped));
    // Süre aşımı (Valkey TTL) = anahtar yok.
    const t4 = await token(world.lawyer1, id);
    tokenRows.clear();
    await forbidden(await get(world.lawyer1, t4.json.url));
    // Uydurma belirteç.
    await forbidden(await get(world.lawyer1, `/api/v1/files/${id}/content?dt=${'A'.repeat(43)}`));
    // Biçimi bozuk belirteç doğrulamada 422.
    expect((await get(world.lawyer1, `/api/v1/files/${id}/content?dt=kisa`)).status).toBe(422);
  });

  it('belirteç yetki vermez: erişimi olmayan kullanıcı belirteç alamaz; oturumsuz istek 401', async () => {
    const caseId = await createCase(world.lawyer1, 'restricted');
    const id = await uploadScanned(world.lawyer1, 'kisitli.pdf', pdf(3000, 'tk3'), caseId);
    expect((await token(world.lawyer2, id)).status).toBe(404);
    expect((await token(world.ownerB, id)).status).toBe(404);
    const t = await token(world.lawyer1, id);
    const anon = await app.request(`${APP_URL}${t.json.url}`, { headers: { origin: APP_URL } });
    expect(anon.status).toBe(401);
    // Belirteç anonim denemede tüketilmedi: oturumla hâlâ kullanılabilir (kimlik zinciri önce çalışır).
    expect((await get(world.lawyer1, t.json.url)).status).toBe(200);
  });

  it('varyant belirtece bağlıdır: searchable/clean yokken 404; var iken belirteçteki varyantla eşleşmeli', async () => {
    const id = await uploadScanned(world.lawyer1, 'varyant.pdf', pdf(3000, 'tk4'));
    expect((await token(world.lawyer1, id, { variant: 'searchable' })).status).toBe(404);
    expect((await get(world.lawyer1, `/api/v1/files/${id}/content?variant=clean`)).status).toBe(
      404,
    );
    expect((await get(world.lawyer1, `/api/v1/files/${id}/content?variant=export`)).status).toBe(
      422,
    );
    // Not: .searchable nesnesi bu dilimde üretilmez; varyant anahtarı takası crypto testlerindedir.
  });
});

describe('KK-P20-27: tarama, karantina ve görünürlük kapıları (D5)', () => {
  it('taranmamış evrak 409 FILE_NOT_READY (belirteç dahil); karantina 422 FILE_QUARANTINED', async () => {
    const r = await upload(world.lawyer1, 'taranmamis.pdf', pdf(3000, 'kp1'));
    const id = r.json.file.id as string;
    const t = await token(world.lawyer1, id);
    expect(t.status).toBe(409);
    expect(errOf(t).code).toBe('FILE_NOT_READY');
    const c = await get(world.lawyer1, `/api/v1/files/${id}/content`);
    expect(c.status).toBe(409);
    await c.arrayBuffer();
    await inOrg(world.lawyer1, (tx) =>
      tx.query(
        `UPDATE app.files SET status = 'quarantined', status_reason = 'av_detected' WHERE id = $1`,
        [id],
      ),
    );
    const q = await get(world.lawyer1, `/api/v1/files/${id}/content`);
    expect(q.status).toBe(422);
    expect(((await q.json()) as Json).error.code).toBe('FILE_QUARANTINED');
    expect(errOf(await token(world.lawyer1, id)).code).toBe('FILE_QUARANTINED');
    // Reddedilen isteklerde custody download olayı yok.
    expect((await custodyOf(world.lawyer1, id)).map((e) => e.event)).toEqual(['upload']);
  });

  it('failed ve ocr_skipped evrakı taranmışsa indirilebilir (özgün dosya delildir)', async () => {
    for (const status of ['failed', 'ocr_skipped']) {
      const content = pdf(3000, status);
      const r = await upload(world.lawyer1, `${status}.pdf`, content);
      await markScanned(world.lawyer1, r.json.file.id, status);
      const res = await get(world.lawyer1, `/api/v1/files/${r.json.file.id}/content`);
      expect(res.status, status).toBe(200);
      expect((await bytesOf(res)).equals(content)).toBe(true);
    }
  });

  it('silinmek üzere işaretli, başka büro ve ekip dışı evrak 404 (custody yok)', async () => {
    const id = await uploadScanned(world.lawyer1, 'silinmis.pdf', pdf(3000, 'kp2'));
    await call(world.lawyer1, 'DELETE', `/api/v1/files/${id}`);
    expect((await get(world.lawyer1, `/api/v1/files/${id}/content`)).status).toBe(404);
    const caseId = await createCase(world.lawyer1, 'restricted');
    const rid = await uploadScanned(world.lawyer1, 'k.pdf', pdf(3000, 'kp3'), caseId);
    for (const who of [world.lawyer2, world.ownerB]) {
      const res = await get(who, `/api/v1/files/${rid}/content`);
      expect(res.status).toBe(404);
      await res.arrayBuffer();
    }
    expect((await custodyOf(world.lawyer1, rid)).map((e) => e.event)).toEqual(['upload']);
  });
});

describe('KK-P20-28: Range', () => {
  const content = pdf(200_000, 'range');
  let id: string;
  beforeAll(async () => {
    id = await uploadScanned(world.lawyer1, 'range.pdf', content);
  });

  it.each([
    ['bytes=0-99', 0, 99],
    ['bytes=65000-70000', 65_000, 70_000],
    ['bytes=65535-65536', 65_535, 65_536],
    ['bytes=190000-', 190_000, 199_999],
    ['bytes=-500', 199_500, 199_999],
    ['bytes=199999-199999', 199_999, 199_999],
    ['bytes=100-999999999', 100, 199_999],
  ] as const)('%s tam içerikle aynı baytları verir (206)', async (header, from, to) => {
    const res = await get(world.lawyer1, `/api/v1/files/${id}/content`, { range: header });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes ${from}-${to}/${content.length}`);
    expect(res.headers.get('content-length')).toBe(String(to - from + 1));
    expect((await bytesOf(res)).equals(content.subarray(from, to + 1))).toBe(true);
  });

  it('aralık custody’ye yazılır; geçersiz aralık 416 ve olay yazmaz; çoklu aralık yok sayılır', async () => {
    const before = (await custodyOf(world.lawyer1, id)).filter(
      (e) => e.event === 'download',
    ).length;
    const ok = await get(world.lawyer1, `/api/v1/files/${id}/content`, { range: 'bytes=10-19' });
    await ok.arrayBuffer();
    const events = (await custodyOf(world.lawyer1, id)).filter((e) => e.event === 'download');
    expect(events).toHaveLength(before + 1);
    expect(events[events.length - 1]?.metadata.range).toBe('bytes=10-19');
    for (const bad of ['bytes=200000-', 'bytes=50-10', 'bytes=-0', 'bytes=abc']) {
      const res = await get(world.lawyer1, `/api/v1/files/${id}/content`, { range: bad });
      expect(res.status, bad).toBe(416);
      expect(res.headers.get('content-range')).toBe(`bytes */${content.length}`);
    }
    expect((await custodyOf(world.lawyer1, id)).filter((e) => e.event === 'download')).toHaveLength(
      before + 1,
    );
    const multi = await get(world.lawyer1, `/api/v1/files/${id}/content`, {
      range: 'bytes=0-1,5-9',
    });
    expect(multi.status).toBe(200);
    expect((await bytesOf(multi)).equals(content)).toBe(true);
  });
});

describe('KK-P20-29: bütünlük (nonce/kesilme/bozma reddi)', () => {
  it('ilk segment bozuksa temiz 500 yanıt; hiçbir bayt sızmaz; status_reason değişmez', async () => {
    const content = pdf(150_000, 'boz1');
    const id = await uploadScanned(world.lawyer1, 'boz1.pdf', content);
    const key = (await rowOf(world.lawyer1, id)).object_key as string;
    const obj = store.objects.get(key) as Buffer;
    obj[HEADER_BYTES + 100] = (obj[HEADER_BYTES + 100] ?? 0) ^ 0x01;
    const before = integrity.length;
    const res = await get(world.lawyer1, `/api/v1/files/${id}/content`);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-disposition')).toBeNull();
    expect(((await res.json()) as Json).error.code).toBe('INTERNAL_ERROR');
    expect(integrity.slice(before)).toEqual([{ fileId: id, kind: 'aead' }]);
    expect(await rowOf(world.lawyer1, id)).toMatchObject({ status: 'ready', status_reason: null });
  });

  it('akış ortasında bozuk segment bağlantıyı keser: gövde okunamaz, tam içerik asla teslim edilmez', async () => {
    const content = pdf(200_000, 'boz2');
    const id = await uploadScanned(world.lawyer1, 'boz2.pdf', content);
    const key = (await rowOf(world.lawyer1, id)).object_key as string;
    const obj = store.objects.get(key) as Buffer;
    obj[obj.length - 20] = (obj[obj.length - 20] ?? 0) ^ 0x01;
    const before = integrity.length;
    const res = await get(world.lawyer1, `/api/v1/files/${id}/content`);
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect(integrity.slice(before).map((e) => e.kind)).toContain('aead');
    expect((await rowOf(world.lawyer1, id)).status_reason).toBeNull();
  });

  it('kesilmiş nesne (son segment atılmış) ve eklenmiş segment: uzunluk uyuşmazlığı, içerik verilmez', async () => {
    const id = await uploadScanned(world.lawyer1, 'kes.pdf', pdf(140_000, 'kes'));
    const key = (await rowOf(world.lawyer1, id)).object_key as string;
    const obj = store.objects.get(key) as Buffer;
    store.objects.set(key, obj.subarray(0, HEADER_BYTES + 65_552));
    const res = await get(world.lawyer1, `/api/v1/files/${id}/content`);
    expect(res.status).toBe(500);
    await res.arrayBuffer();
    store.objects.set(key, Buffer.concat([obj, obj.subarray(HEADER_BYTES, HEADER_BYTES + 65_552)]));
    const res2 = await get(world.lawyer1, `/api/v1/files/${id}/content`);
    expect(res2.status).toBe(500);
    await res2.arrayBuffer();
    expect(integrity.filter((e) => e.fileId === id).map((e) => e.kind)).toEqual([
      'length',
      'length',
    ]);
  });

  it('başka evrakın nesnesi bu evraka konulursa çözülmez (segment bağlamı)', async () => {
    const a = await uploadScanned(world.lawyer1, 'a.pdf', pdf(60_000, 'bagA'));
    const b = await uploadScanned(world.lawyer1, 'b.pdf', pdf(60_000, 'bagB'));
    const keyA = (await rowOf(world.lawyer1, a)).object_key as string;
    const keyB = (await rowOf(world.lawyer1, b)).object_key as string;
    store.objects.set(keyB, store.objects.get(keyA) as Buffer);
    const res = await get(world.lawyer1, `/api/v1/files/${b}/content`);
    expect(res.status).toBe(500);
    await res.arrayBuffer();
  });

  it('nesne yok / depo kapalı: 500 object_missing alarmı / 503 storage; custody kaydı fail-closed', async () => {
    const id = await uploadScanned(world.lawyer1, 'yok.pdf', pdf(3000, 'yok'));
    const key = (await rowOf(world.lawyer1, id)).object_key as string;
    const saved = store.objects.get(key) as Buffer;
    store.objects.delete(key);
    const miss = await get(world.lawyer1, `/api/v1/files/${id}/content`);
    expect(miss.status).toBe(500);
    await miss.arrayBuffer();
    expect(integrity.filter((e) => e.fileId === id).map((e) => e.kind)).toContain('object_missing');
    store.objects.set(key, saved);
    store.unavailable = true;
    try {
      const down = await get(world.lawyer1, `/api/v1/files/${id}/content`);
      expect(down.status).toBe(503);
      await down.arrayBuffer();
    } finally {
      store.unavailable = false;
    }
    expect((await custodyOf(world.lawyer1, id)).map((e) => e.event)).toEqual(['upload']);
  });
});

describe('KK-P20-30: custody yazılamazsa içerik verilmez (fail-closed, D4)', () => {
  it('custody işlemi hata verirse 503 ve nesne deposundan GetObject çağrılmaz', async () => {
    const content = pdf(5000, 'fc');
    const id = await uploadScanned(world.lawyer1, 'fc.pdf', content);
    let calls = 0;
    const flaky = {
      withTenant: ((ctx: never, fn: never) => {
        calls += 1;
        // 1: satır okuma, 2: custody + anahtar işlemi (burada kasıtlı hata)
        if (calls === 2) return Promise.reject(new Error('veritabanı yazılamadı'));
        return runner().withTenant(ctx, fn);
      }) as unknown as ReturnType<typeof runner>['withTenant'],
    };
    let gets = 0;
    const spyStore = {
      ...store,
      get: async (...a: Parameters<typeof store.get>) => {
        gets += 1;
        return store.get(...a);
      },
    };
    const svc = createFilesService({
      db: flaky as never,
      store: spyStore as never,
      keyring: createKeyring({ keks: [{ kek: KEK, kekVersion: 1 }] }),
      jobs: {
        addFileScan: async () => undefined,
        failedCount: () => 0,
        close: async () => undefined,
      },
      edaEnv: 'test',
      uuid: () => uuidv7(),
    });
    await expect(
      svc.openContent(
        { orgId: world.orgA, userId: world.lawyer1.id, memberRole: 'lawyer' },
        { fileId: id, variant: 'orig', ipTrunc: null },
      ),
    ).rejects.toMatchObject({ code: 'INTERNAL_DEPENDENCY_UNAVAILABLE' });
    expect(gets).toBe(0);
    expect((await custodyOf(world.lawyer1, id)).map((e) => e.event)).toEqual(['upload']);
  });
});

describe('KK-P20-31: indirmede ad ve içerik sızıntısı yok', () => {
  it('indirme sonrası log, custody meta ve iş yükünde ad/içerik işareti yok', async () => {
    const id = await uploadScanned(world.lawyer1, `${NAME_MARK} sizinti.pdf`, pdf(4000));
    const t = await token(world.lawyer1, id);
    const res = await get(world.lawyer1, t.json.url);
    await res.arrayBuffer();
    const unauthorized = await get(world.ownerB, `/api/v1/files/${id}/content`);
    await unauthorized.arrayBuffer();
    const urlToken = (t.json.url as string).split('dt=')[1] as string;
    expect(logLines.filter((l) => l.includes(NAME_MARK) || l.includes(BODY_MARK))).toEqual([]);
    // Belirteç değeri günlüğe yazılmaz (sorgu dizesi loglanmaz).
    expect(logLines.filter((l) => l.includes(urlToken))).toEqual([]);
    const meta = await inOrg<{ rows: Json[] }>(world.lawyer1, (tx) =>
      tx.query('SELECT metadata::text AS m FROM app.custody_events WHERE file_id = $1', [id]),
    );
    expect(meta.rows.filter((r) => String(r.m).includes(NAME_MARK))).toEqual([]);
  });

  it('rota meta: belirteç ve içerik rotaları file:read, clientData=false', () => {
    for (const [m, p] of [
      ['POST', '/api/v1/files/{fileId}/download-token'],
      ['GET', '/api/v1/files/{fileId}/content'],
    ] as const) {
      expect(registry.find(m, p)?.meta).toMatchObject({
        permission: 'file:read',
        clientData: false,
      });
    }
  });
});
