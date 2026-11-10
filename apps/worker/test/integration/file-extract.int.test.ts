// @tk TK-28 TK-06
// P21 dosyayla sohbet ilk dilimi: `file.extract` kabul testleri (gerçek PostgreSQL; `eda_worker` rolü
// ve RLS açık; nesne deposu bellek içi; doc-engine sahte istemci). .
//  KK-P21-dosya-1 inbox eki: metin file_texts'e, durum ready; dava evrakı chunking; idempotent
//  KK-P21-dosya-2 metinsiz PDF ve sayfa sınırı ocr_skipped; yapısal ret failed + neden
//  KK-P21-dosya-3 fail-closed: taranmamış evrak doc-engine'e gitmez; kesinti durumu değiştirmez
//  KK-P21-dosya-4 RLS: başka büro bağlamında evrak görünmez; temiz tarama file.extract'i kuyruğa alır
import { randomBytes, randomUUID } from 'node:crypto';
import type { ExtractResultDto } from '@eda/contracts/doc-engine/extract';
import {
  createSegmentEncryptor,
  deriveVariantKey,
  generateFileKey,
  unwrapDek,
  wrapDek,
  wrapFileKey,
} from '@eda/crypto';
import { createKeyring } from '@eda/db/keyring';
import { createMemoryObjectStore, createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type DocEngineClient, DocEngineUnavailableError } from '../../src/files/doc-engine.ts';
import { createFilesHandler, type EnqueueExtract } from '../../src/files.ts';
import { Metrics } from '../../src/metrics.ts';
import {
  type FileExtractDeps,
  type FileExtractJobView,
  processFileExtract,
} from '../../src/processors/files/file-extract.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: { host: string; port: number; database: string; secretsDir: string };
  }
}

const KEK = Buffer.alloc(32, 0x4d);
const TEXT = 'ÖRNEK KİRA SÖZLEŞMESİ\nAylık kira bedeli 27.500 TL.\n\nMadde 7 - Fesih.';

let db: TestingDb;
const store = createMemoryObjectStore();
const metrics = new Metrics();
const logLines: string[] = [];
interface Person {
  readonly id: string;
  readonly org: string;
}
const w = {} as { up: Person; b: Person };

const inOrg = <T>(p: Person, fn: Parameters<ReturnType<TestingDb['runner']>['withTenant']>[1]) =>
  db.runner('eda_app').withTenant({ orgId: p.org, userId: p.id }, fn) as Promise<T>;

function result(over: Partial<ExtractResultDto> = {}): ExtractResultDto {
  return {
    jobId: randomUUID(),
    verdict: 'ok',
    rejectReason: null,
    fileType: 'pdf',
    pageCount: 2,
    hasTextLayer: true,
    text: TEXT,
    textTruncated: false,
    pageOffsets: [0, 50],
    hiddenContent: { found: false, excludedFromText: false, items: [] },
    extractorVersion: 'eda-extract/test',
    ...over,
  };
}

class FakeDocEngine implements DocEngineClient {
  next: ExtractResultDto | Error = result();
  calls = 0;
  seen: Buffer | null = null;
  async extract(req: Parameters<DocEngineClient['extract']>[0]): Promise<ExtractResultDto> {
    this.calls += 1;
    this.seen = Buffer.from(req.body);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}
const engine = new FakeDocEngine();

function depsOf(): FileExtractDeps {
  return {
    db: db.runner('eda_worker'),
    store,
    keyring: createKeyring({ keks: [{ kek: KEK, kekVersion: 1 }] }),
    docEngine: engine,
    logger: createLogger({
      service: 'it',
      level: 'debug',
      destination: { write: (l) => logLines.push(l) },
    }),
    metrics,
    uuid: () => randomUUID(),
  };
}

const jobOf = (fileId: string, who: Person = w.up): FileExtractJobView => ({
  orgId: who.org,
  fileId,
  userId: who.id,
  deferrals: 0,
  enqueuedAt: new Date(),
});

async function seed(
  owner: Person,
  o: { caseId?: string | null; scanned?: boolean; status?: string } = {},
): Promise<{ id: string; content: Buffer }> {
  const id = randomUUID();
  const caseId = o.caseId ?? null;
  const key =
    caseId === null ? `org/${owner.org}/inbox/${id}` : `org/${owner.org}/case/${caseId}/${id}`;
  const content = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(5000)]);
  const fileKey = generateFileKey();
  const ctx = { orgId: owner.org, fileId: id, keyVersion: 1 };
  const enc = createSegmentEncryptor(ctx, deriveVariantKey(fileKey, 'orig'));
  store.objects.set(key, Buffer.concat([...enc.push(content), ...enc.finish()]));
  const dekRow = await inOrg<{ rows: { wrapped_dek: Buffer }[] }>(owner, (tx) =>
    tx.query('SELECT wrapped_dek FROM app.org_keys WHERE org_id = $1 AND key_version = 1', [
      owner.org,
    ]),
  );
  const wrappedDek = dekRow.rows[0]?.wrapped_dek;
  if (wrappedDek === undefined) throw new Error('DEK yok');
  const dek = unwrapDek(KEK, { orgId: owner.org, dekVersion: 1, kekVersion: 1 }, wrappedDek);
  await inOrg(owner, (tx) =>
    tx.query(
      `INSERT INTO app.files (id, org_id, case_id, origin, uploaded_by, original_name, name_fold, file_type,
         mime_type, size_bytes, sha256, object_key, key_version, wrap_dek_version, wrapped_file_key,
         inbox_expires_at, status, scanned_at)
       VALUES ($1, $2, $3, $4, $5, 'ornek.pdf', 'ornek.pdf', 'pdf', 'application/pdf', $6, $7, $8, 1, 1,
         $9, $10, $11, $12)`,
      [
        id,
        owner.org,
        caseId,
        caseId === null ? 'chat_attachment' : 'case_upload',
        owner.id,
        content.length,
        randomBytes(32),
        key,
        wrapFileKey(dek, ctx, fileKey),
        caseId === null ? new Date(Date.now() + 86_400_000) : null,
        o.status ?? 'extracting',
        o.scanned === false ? null : new Date(),
      ],
    ),
  );
  return { id, content };
}

async function rowOf(p: Person, id: string) {
  const r = await inOrg<{ rows: Record<string, unknown>[] }>(p, (tx) =>
    tx.query(
      'SELECT status, status_reason, page_count, has_text_layer FROM app.files WHERE id = $1',
      [id],
    ),
  );
  return r.rows[0];
}

async function textOf(p: Person, id: string) {
  const r = await inOrg<{ rows: Record<string, unknown>[] }>(p, (tx) =>
    tx.query('SELECT text, token_count, page_offsets FROM app.file_texts WHERE file_id = $1', [id]),
  );
  return r.rows[0];
}

async function person(org: string, tag: string, role: string): Promise<Person> {
  const id = await db.auth.insertUser({
    name: `Örnek ${tag}`,
    email: `${tag}.${randomUUID().slice(0, 8)}@ornek.test`,
    emailVerified: true,
    verificationStatus: 'verified',
  });
  await db.auth.addMember(org, id, role);
  return { id, org };
}

beforeAll(async () => {
  db = createTestingDb(inject('pg'));
  const orgA = await db.auth.insertOrg('Örnek Büro A', 'firm');
  const orgB = await db.auth.insertOrg('Örnek Büro B', 'firm');
  await db.auth.grantSeats(orgA, 5);
  await db.auth.grantSeats(orgB, 5);
  w.up = await person(orgA, 'yukleyen', 'owner');
  w.b = await person(orgB, 'baska', 'owner');
  for (const p of [w.up, w.b]) {
    await inOrg(p, async (tx) => {
      await tx.query('INSERT INTO app.org_settings (org_id) VALUES ($1)', [p.org]);
      await tx.query(
        'INSERT INTO app.org_keys (org_id, key_version, wrapped_dek, kek_version) VALUES ($1, 1, $2, 1)',
        [p.org, wrapDek(KEK, { orgId: p.org, dekVersion: 1, kekVersion: 1 }, generateFileKey())],
      );
    });
  }
});

afterAll(async () => {
  await db?.close();
});

describe('KK-P21-dosya-1: metin çıkarma', () => {
  it('inbox eki: çözülmüş baytlar doc-engine e gider, metin yazılır, durum ready; ikinci koşu no-op', async () => {
    const f = await seed(w.up);
    engine.next = result();
    engine.calls = 0;
    expect(await processFileExtract(jobOf(f.id), depsOf())).toEqual({ status: 'ready' });
    expect(engine.seen?.equals(f.content)).toBe(true);
    expect(await rowOf(w.up, f.id)).toMatchObject({
      status: 'ready',
      status_reason: null,
      page_count: 2,
      has_text_layer: true,
    });
    const t = await textOf(w.up, f.id);
    expect(t?.text).toBe(TEXT);
    expect(t?.token_count).toBe(Math.ceil(TEXT.length / 3));
    expect(t?.page_offsets).toEqual([0, 50]);
    expect(await processFileExtract(jobOf(f.id), depsOf())).toEqual({
      status: 'skipped',
      reason: 'terminal',
    });
    expect(engine.calls).toBe(1);
    // Günlükte metin ve ad yok.
    expect(logLines.join('\n')).not.toContain('27.500');
  });

  it('dava evrakı: metin yazılır, durum chunking (parçalama sonraki dilim)', async () => {
    const caseId = (
      await inOrg<{ rows: { id: string }[] }>(w.up, (tx) =>
        tx.query(
          `INSERT INTO app.cases (org_id, owner_id, created_by, title, title_fold)
           VALUES ($1, $2, $2, 'Örnek dava', 'ornek dava') RETURNING id`,
          [w.up.org, w.up.id],
        ),
      )
    ).rows[0]?.id;
    const f = await seed(w.up, { caseId: caseId ?? null });
    engine.next = result();
    expect(await processFileExtract(jobOf(f.id), depsOf())).toEqual({ status: 'chunking' });
    expect((await textOf(w.up, f.id))?.text).toBe(TEXT);
  });
});

describe('KK-P21-dosya-2: metinsiz ve reddedilen evrak', () => {
  it('metin katmanı yok: ocr_skipped, file_texts yazılmaz', async () => {
    const f = await seed(w.up);
    engine.next = result({ hasTextLayer: false, text: '', pageOffsets: [] });
    expect(await processFileExtract(jobOf(f.id), depsOf())).toEqual({
      status: 'ocr_skipped',
      reason: 'no_text_layer',
    });
    expect(await rowOf(w.up, f.id)).toMatchObject({ status: 'ocr_skipped', has_text_layer: false });
    expect(await textOf(w.up, f.id)).toBeUndefined();
  });

  it('sayfa sınırı ocr_skipped + page_limit; şifreli PDF failed + encrypted_pdf', async () => {
    const a = await seed(w.up);
    engine.next = result({
      verdict: 'reject',
      rejectReason: 'page_limit',
      text: '',
      pageCount: 900,
    });
    await processFileExtract(jobOf(a.id), depsOf());
    expect(await rowOf(w.up, a.id)).toMatchObject({
      status: 'ocr_skipped',
      status_reason: 'page_limit',
      page_count: 900,
    });
    const b = await seed(w.up);
    engine.next = result({ verdict: 'reject', rejectReason: 'encrypted_pdf', text: '' });
    expect(await processFileExtract(jobOf(b.id), depsOf())).toEqual({
      status: 'failed',
      reason: 'encrypted_pdf',
    });
    expect(await rowOf(w.up, b.id)).toMatchObject({
      status: 'failed',
      status_reason: 'encrypted_pdf',
    });
  });
});

describe('KK-P21-dosya-3: fail-closed', () => {
  it('taranmamış evrak doc-engine e gönderilmez', async () => {
    const f = await seed(w.up, { scanned: false, status: 'scanning' });
    engine.calls = 0;
    expect(await processFileExtract(jobOf(f.id), depsOf())).toEqual({
      status: 'skipped',
      reason: 'not_scanned',
    });
    expect(engine.calls).toBe(0);
  });

  it('doc-engine kesintisi: iş ertelenir, durum extracting kalır', async () => {
    const f = await seed(w.up);
    engine.next = new DocEngineUnavailableError('connect');
    const out = await processFileExtract(jobOf(f.id), depsOf());
    expect(out.status).toBe('deferred');
    expect(await rowOf(w.up, f.id)).toMatchObject({
      status: 'extracting',
      status_reason: 'doc_engine_error',
    });
  });
});

describe('KK-P21-dosya-4: RLS ve zincir', () => {
  it('başka büro bağlamında evrak görünmez (gone)', async () => {
    const f = await seed(w.up);
    engine.calls = 0;
    expect(
      await processFileExtract({ ...jobOf(f.id), orgId: w.b.org, userId: w.b.id }, depsOf()),
    ).toEqual({ status: 'skipped', reason: 'gone' });
    expect(engine.calls).toBe(0);
  });

  it('file.extract işi işleyiciden geçer; file.scan temiz sonucu file.extract kuyruğa alır', async () => {
    const f = await seed(w.up);
    engine.next = result();
    const queued: Parameters<EnqueueExtract>[0][] = [];
    const h = createFilesHandler({
      scan: {
        ...depsOf(),
        scanner: null,
      },
      extract: depsOf(),
      enqueueExtract: async (r) => {
        queued.push(r);
      },
    });
    const view = (name: string, data: unknown) => ({
      name,
      data,
      timestamp: Date.now(),
      attemptsMade: 0,
      moveToDelayed: async () => undefined,
    });
    const payload = { v: 1, orgId: w.up.org, fileId: f.id, userId: w.up.id };
    expect(await h(view('file.extract', payload))).toEqual({ status: 'ready' });
    const g = await seed(w.up, { status: 'uploaded', scanned: false });
    await h(view('file.scan', { ...payload, fileId: g.id }));
    expect(queued).toEqual([{ orgId: w.up.org, fileId: g.id, userId: w.up.id }]);
  });
});
