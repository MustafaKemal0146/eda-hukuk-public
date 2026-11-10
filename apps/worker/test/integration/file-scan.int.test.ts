// @tk TK-28 TK-06
// P20 `file.scan` kabul testleri (gerçek PostgreSQL; `eda_worker` rolü ve RLS açık; nesne deposu bellek
// içi sahte port; tarayıcı sahte). KK-P20-19..24:
//  KK-P20-19 temiz tarama ve idempotentlik        KK-P20-20 zararlı: karantina, scanned_at NULL, fail-closed
//  KK-P20-21 altyapı kesintisi durumu değiştirmez  KK-P20-22 bütünlük ve eksik nesne
//  KK-P20-23 RLS ve bağlam                         KK-P20-24 eda_worker sistem custody politikası
import { randomBytes, randomUUID } from 'node:crypto';
import {
  createSegmentEncryptor,
  deriveVariantKey,
  generateFileKey,
  layoutOf,
  unwrapDek,
  wrapDek,
  wrapFileKey,
} from '@eda/crypto';
import { createKeyring } from '@eda/db/keyring';
import { createMemoryObjectStore, createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import { DelayedError, UnrecoverableError } from 'bullmq';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  ScannerUnavailableError,
  type ScanResult,
  type VirusScanner,
} from '../../src/files/scanner.ts';
import { createFilesHandler } from '../../src/files.ts';
import { Metrics } from '../../src/metrics.ts';
import {
  type FileScanDeps,
  type FileScanJobView,
  processFileScan,
} from '../../src/processors/files/file-scan.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: { host: string; port: number; database: string; secretsDir: string };
  }
}

const KEK = Buffer.alloc(32, 0x3c);
const NAME_MARK = `ADSOYAD-${randomUUID().slice(0, 8)}`;
const SIGNATURE = 'Win.Test.EICAR_HDB-1';

let db: TestingDb;
const store = createMemoryObjectStore();
const metrics = new Metrics();
const logLines: string[] = [];

interface Person {
  readonly id: string;
  readonly org: string;
}
const w = {} as {
  orgA: string;
  orgB: string;
  up: Person;
  other: Person;
  owner: Person;
  b: Person;
};

const runnerApp = () => db.runner('eda_app');
const inOrg = <T>(p: Person, fn: Parameters<ReturnType<typeof runnerApp>['withTenant']>[1]) =>
  runnerApp().withTenant({ orgId: p.org, userId: p.id }, fn) as Promise<T>;

/** Sahte tarayıcı: akışı tüketir (çözülmüş baytları toplar) ve ayarlanan sonucu döner. */
class FakeScanner implements VirusScanner {
  result: ScanResult | Error = { status: 'clean' };
  ageDays = 0.5;
  scans = 0;
  seen: Buffer[] = [];
  async scan(source: AsyncIterable<Uint8Array>): Promise<ScanResult> {
    this.scans += 1;
    this.seen = [];
    for await (const c of source) this.seen.push(Buffer.from(c));
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
  async databaseAgeDays(): Promise<number> {
    return this.ageDays;
  }
}

const scanner = new FakeScanner();

function depsOf(over: Partial<FileScanDeps> = {}): FileScanDeps {
  return {
    db: db.runner('eda_worker'),
    store,
    keyring: createKeyring({ keks: [{ kek: KEK, kekVersion: 1 }] }),
    scanner,
    logger: createLogger({
      service: 'it',
      level: 'debug',
      destination: { write: (l) => logLines.push(l) },
    }),
    metrics,
    ...over,
  };
}

const jobOf = (
  fileId: string,
  who: Person = w.up,
  over: Partial<FileScanJobView> = {},
): FileScanJobView => ({
  orgId: who.org,
  fileId,
  userId: who.id,
  deferrals: 0,
  enqueuedAt: new Date(),
  ...over,
});

interface Seeded {
  readonly id: string;
  readonly key: string;
  readonly content: Buffer;
}

/** Yükleme hattının ürettiği biçimde evrak: şifreli nesne + `files` satırı (status uploaded). */
async function seedFile(
  owner: Person,
  o: { caseId?: string | null; size?: number; name?: string } = {},
): Promise<Seeded> {
  const id = randomUUID();
  const caseId = o.caseId ?? null;
  const key =
    caseId === null ? `org/${owner.org}/inbox/${id}` : `org/${owner.org}/case/${caseId}/${id}`;
  const content = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(o.size ?? 150_000)]);
  const fileKey = generateFileKey();
  const ctx = { orgId: owner.org, fileId: id, keyVersion: 1 };
  const enc = createSegmentEncryptor(ctx, deriveVariantKey(fileKey, 'orig'));
  store.objects.set(key, Buffer.concat([...enc.push(content), ...enc.finish()]));
  // Büro DEK'i testte sabit (beforeAll'da yazılan); dosya anahtarı o DEK ile sarılır.
  const dekRow = await inOrg<{ rows: { wrapped_dek: Buffer }[] }>(owner, (tx) =>
    tx.query('SELECT wrapped_dek FROM app.org_keys WHERE org_id = $1 AND key_version = 1', [
      owner.org,
    ]),
  );
  const wrappedDek = dekRow.rows[0]?.wrapped_dek;
  if (wrappedDek === undefined) throw new Error('DEK yok');
  const realDek = unwrapDek(KEK, { orgId: owner.org, dekVersion: 1, kekVersion: 1 }, wrappedDek);
  const wrapped = wrapFileKey(realDek, ctx, fileKey);
  const name = o.name ?? `${NAME_MARK}.pdf`;
  await inOrg(owner, (tx) =>
    tx.query(
      `INSERT INTO app.files (id, org_id, case_id, origin, uploaded_by, original_name, name_fold, file_type,
         mime_type, size_bytes, sha256, object_key, key_version, wrap_dek_version, wrapped_file_key,
         inbox_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, 'pdf', 'application/pdf', $7, $8, $9, 1, 1, $10, $11)`,
      [
        id,
        owner.org,
        caseId,
        caseId === null ? 'chat_attachment' : 'case_upload',
        owner.id,
        name,
        content.length,
        randomBytes(32),
        key,
        wrapped,
        caseId === null ? new Date(Date.now() + 86_400_000) : null,
      ],
    ),
  );
  return { id, key, content };
}

async function rowOf(p: Person, id: string) {
  const r = await inOrg<{ rows: Record<string, unknown>[] }>(p, (tx) =>
    tx.query('SELECT * FROM app.files WHERE id = $1', [id]),
  );
  return r.rows[0];
}

async function newCase(p: Person, visibility: 'org' | 'restricted' = 'org'): Promise<string> {
  const r = await inOrg<{ rows: { id: string }[] }>(p, (tx) =>
    tx.query(
      `INSERT INTO app.cases (org_id, owner_id, created_by, title, title_fold, visibility)
       VALUES ($1, $2, $2, 'Örnek dava', 'ornek dava', $3) RETURNING id`,
      [p.org, p.id, visibility],
    ),
  );
  const id = r.rows[0]?.id ?? '';
  if (visibility === 'restricted') {
    await inOrg(p, (tx) =>
      tx.query(
        'INSERT INTO app.case_members (org_id, case_id, user_id, added_by) VALUES ($1,$2,$3,$3)',
        [p.org, id, p.id],
      ),
    );
  }
  return id;
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
  w.orgA = await db.auth.insertOrg('Örnek Büro A', 'firm');
  w.orgB = await db.auth.insertOrg('Örnek Büro B', 'firm');
  await db.auth.grantSeats(w.orgA, 10);
  await db.auth.grantSeats(w.orgB, 5);
  w.up = await person(w.orgA, 'yukleyen', 'lawyer');
  w.other = await person(w.orgA, 'diger', 'lawyer');
  w.owner = await person(w.orgA, 'sahip', 'owner');
  w.b = await person(w.orgB, 'baska', 'owner');
  for (const p of [w.owner, w.b]) {
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

// ---------- KK-P20-19 ----------

describe('KK-P20-19: temiz tarama', () => {
  it('çözülmüş baytlar tarayıcıya akar; scanned_at yazılır; uploaded -> extracting; ikinci koşu no-op', async () => {
    const f = await seedFile(w.up);
    scanner.result = { status: 'clean' };
    scanner.scans = 0;
    const out = await processFileScan(jobOf(f.id), depsOf());
    expect(out).toEqual({ status: 'clean' });
    expect(Buffer.concat(scanner.seen).equals(f.content)).toBe(true);
    const row = await rowOf(w.up, f.id);
    expect(row).toMatchObject({ status: 'extracting', status_reason: null });
    expect(row?.scanned_at).toBeInstanceOf(Date);
    // Idempotent: tekrar koşu taramaz.
    const again = await processFileScan(jobOf(f.id), depsOf());
    expect(again).toEqual({ status: 'skipped', reason: 'already_scanned' });
    expect(scanner.scans).toBe(1);
  });

  it('dava evrakı da taranır (dava erişimi olan yükleyen bağlamında)', async () => {
    const caseId = await newCase(w.up);
    const f = await seedFile(w.up, { caseId });
    scanner.result = { status: 'clean' };
    expect((await processFileScan(jobOf(f.id), depsOf())).status).toBe('clean');
    expect((await rowOf(w.up, f.id))?.scanned_at).not.toBeNull();
  });

  it('CLAMAV_ENABLED=false (tarayıcı yok): taramadan geçer, sayaç artar, ad/içerik loglanmaz', async () => {
    const f = await seedFile(w.up);
    const before = metrics.get('eda_file_scan_skipped_total');
    const out = await processFileScan(jobOf(f.id), depsOf({ scanner: null }));
    expect(out).toEqual({ status: 'clean_unscanned' });
    expect(metrics.get('eda_file_scan_skipped_total')).toBe(before + 1);
    expect((await rowOf(w.up, f.id))?.status).toBe('extracting');
  });
});

// ---------- KK-P20-20 ----------

describe('KK-P20-20: zararlı yazılım (fail-closed)', () => {
  it('quarantined + av_detected; scanned_at NULL; imza adı DB’de yok, yalnız günlükte', async () => {
    const f = await seedFile(w.up);
    scanner.result = { status: 'infected', signature: SIGNATURE };
    const out = await processFileScan(jobOf(f.id), depsOf());
    expect(out).toEqual({ status: 'infected' });
    const row = await rowOf(w.up, f.id);
    expect(row).toMatchObject({
      status: 'quarantined',
      status_reason: 'av_detected',
      scanned_at: null,
    });
    expect(JSON.stringify(row)).not.toContain('EICAR');
    const custody = await inOrg<{ rows: unknown[] }>(w.up, (tx) =>
      tx.query('SELECT 1 FROM app.custody_events WHERE file_id = $1', [f.id]),
    );
    expect(custody.rows).toEqual([]);
    expect(logLines.some((l) => l.includes(SIGNATURE))).toBe(true);
    expect(logLines.filter((l) => l.includes(NAME_MARK))).toEqual([]);
    // Karantinadaki evrak yeniden işlenmez; terminal.
    scanner.result = { status: 'clean' };
    expect(await processFileScan(jobOf(f.id), depsOf())).toEqual({
      status: 'skipped',
      reason: 'quarantined',
    });
    expect((await rowOf(w.up, f.id))?.scanned_at).toBeNull();
  });
});

// ---------- KK-P20-21 ----------

describe('KK-P20-21: altyapı kesintisi durumu değiştirmez', () => {
  it('clamd kapalı: scanning kalır, av_unavailable bilgi amaçlı, scanned_at NULL; dönünce tamamlanır', async () => {
    const f = await seedFile(w.up);
    scanner.result = new ScannerUnavailableError('connect');
    const out = await processFileScan(jobOf(f.id), depsOf());
    expect(out).toMatchObject({ status: 'deferred', reason: 'connect' });
    expect((out as { untilMs: number }).untilMs).toBeGreaterThan(Date.now());
    const mid = await rowOf(w.up, f.id);
    expect(mid).toMatchObject({
      status: 'scanning',
      status_reason: 'av_unavailable',
      scanned_at: null,
    });
    scanner.result = { status: 'clean' };
    expect((await processFileScan(jobOf(f.id), depsOf())).status).toBe('clean');
    expect(await rowOf(w.up, f.id)).toMatchObject({ status: 'extracting', status_reason: null });
  });

  it('imza veritabanı eski (> files.clamavMaxDbAgeDays): taramaz, bekletir (fail-closed)', async () => {
    const f = await seedFile(w.up);
    scanner.result = { status: 'clean' };
    scanner.ageDays = 9;
    scanner.scans = 0;
    try {
      const out = await processFileScan(jobOf(f.id), depsOf());
      expect(out).toMatchObject({ status: 'deferred', reason: 'database_stale' });
      expect(scanner.scans).toBe(0);
      expect((await rowOf(w.up, f.id))?.scanned_at).toBeNull();
    } finally {
      scanner.ageDays = 0.5;
    }
  });

  it('objstore kapalı: deferred storage; durum scanning, evrak failed olmaz', async () => {
    const f = await seedFile(w.up);
    store.unavailable = true;
    try {
      const out = await processFileScan(jobOf(f.id), depsOf());
      expect(out).toMatchObject({ status: 'deferred', reason: 'storage' });
    } finally {
      store.unavailable = false;
    }
    expect((await rowOf(w.up, f.id))?.status).toBe('scanning');
  });

  it('24 saati aşan bekleme: gave_up, durum değişmez (alarm)', async () => {
    const f = await seedFile(w.up);
    scanner.result = new ScannerUnavailableError('timeout');
    const old = new Date(Date.now() - 25 * 3_600_000);
    const out = await processFileScan(jobOf(f.id, w.up, { enqueuedAt: old }), depsOf());
    expect(out).toEqual({ status: 'gave_up', reason: 'dependency_unavailable' });
    expect((await rowOf(w.up, f.id))?.scanned_at).toBeNull();
  });

  it('erteleme gecikmesi üstel artar ve jobs.deferMaxDelaySec ile sınırlanır', async () => {
    const { deferDelayMs } = await import('../../src/processors/files/file-scan.ts');
    expect(deferDelayMs(0)).toBe(30_000);
    expect(deferDelayMs(1)).toBe(60_000);
    expect(deferDelayMs(2)).toBe(120_000);
    expect(deferDelayMs(20)).toBe(900_000);
  });
});

// ---------- KK-P20-22 ----------

describe('KK-P20-22: bütünlük ve eksik nesne', () => {
  it('bozuk segment: tarayıcı doğrulanmamış bayt görmez; evrak failed + integrity_failed', async () => {
    const f = await seedFile(w.up, { size: 200_000 });
    const obj = store.objects.get(f.key) as Buffer;
    obj[obj.length - 5] = (obj[obj.length - 5] ?? 0) ^ 0x01;
    scanner.result = { status: 'clean' };
    const before = metrics.get('eda_file_integrity_failures_total');
    const out = await processFileScan(jobOf(f.id), depsOf());
    expect(out).toEqual({ status: 'failed', reason: 'integrity_failed' });
    expect(Buffer.concat(scanner.seen).length).toBeLessThanOrEqual(f.content.length - 1);
    expect(
      f.content.subarray(0, Buffer.concat(scanner.seen).length).equals(Buffer.concat(scanner.seen)),
    ).toBe(true);
    expect(await rowOf(w.up, f.id)).toMatchObject({
      status: 'failed',
      status_reason: 'integrity_failed',
      scanned_at: null,
    });
    expect(metrics.get('eda_file_integrity_failures_total')).toBe(before + 1);
  });

  it('kesilmiş nesne (son segment atılmış) integrity_failed', async () => {
    const f = await seedFile(w.up, { size: 140_000 });
    const obj = store.objects.get(f.key) as Buffer;
    store.objects.set(f.key, obj.subarray(0, obj.length - layoutOf(obj.length).lastCipherBytes));
    scanner.result = { status: 'clean' };
    const out = await processFileScan(jobOf(f.id), depsOf());
    expect(out).toEqual({ status: 'failed', reason: 'integrity_failed' });
  });

  it('nesne yok: failed + object_missing', async () => {
    const f = await seedFile(w.up);
    store.objects.delete(f.key);
    expect(await processFileScan(jobOf(f.id), depsOf())).toEqual({
      status: 'failed',
      reason: 'object_missing',
    });
    expect((await rowOf(w.up, f.id))?.status_reason).toBe('object_missing');
  });

  it('yanlış bağlamla (başka evrakın nesnesi) bağlanmış nesne çözülemez', async () => {
    const a = await seedFile(w.up);
    const b = await seedFile(w.up);
    store.objects.set(b.key, store.objects.get(a.key) as Buffer);
    scanner.result = { status: 'clean' };
    expect((await processFileScan(jobOf(b.id), depsOf())).status).toBe('failed');
  });
});

// ---------- KK-P20-23 ----------

describe('KK-P20-23: RLS ve bağlam', () => {
  it('silinmek üzere işaretli evrakta iş durur; taranmaz', async () => {
    const f = await seedFile(w.up);
    await inOrg(w.up, (tx) =>
      tx.query(
        'UPDATE app.files SET delete_requested_at = now(), delete_requested_by = $2 WHERE id = $1',
        [f.id, w.up.id],
      ),
    );
    scanner.scans = 0;
    expect(await processFileScan(jobOf(f.id), depsOf())).toEqual({
      status: 'skipped',
      reason: 'deleted',
    });
    expect(scanner.scans).toBe(0);
  });

  it('başka büronun evrakı görünmez (gone); kullanıcı o büroda üye değilse ORG_NOT_MEMBER', async () => {
    const f = await seedFile(w.up);
    const asB = {
      orgId: w.orgB,
      fileId: f.id,
      userId: w.b.id,
      deferrals: 0,
      enqueuedAt: new Date(),
    };
    expect(await processFileScan(asB, depsOf())).toEqual({ status: 'skipped', reason: 'gone' });
    const crossed = { ...asB, orgId: w.orgA };
    await expect(processFileScan(crossed, depsOf())).rejects.toMatchObject({
      code: 'ORG_NOT_MEMBER',
    });
  });

  it('kısıtlı davada yükleyen ekip dışındaysa evrak görünmez (gone)', async () => {
    const caseId = await newCase(w.up, 'restricted');
    const f = await seedFile(w.up, { caseId });
    // Aynı iş, davaya erişimi olmayan başka avukat kimliğiyle (yük sahteciliği) koşarsa evrak görünmez.
    const forged = await processFileScan(jobOf(f.id, w.other), depsOf());
    expect(forged).toEqual({ status: 'skipped', reason: 'gone' });
    expect((await rowOf(w.up, f.id))?.scanned_at).toBeNull();
  });

  it('inbox evrakı yalnız yükleyenin bağlamında görünür', async () => {
    const f = await seedFile(w.up);
    expect(await processFileScan(jobOf(f.id, w.other), depsOf())).toEqual({
      status: 'skipped',
      reason: 'gone',
    });
  });
});

// ---------- işleyici ----------

describe('KK-P20-23: BullMQ işleyicisi', () => {
  const view = (name: string, data: unknown, moved: number[] = []) => ({
    name,
    data,
    timestamp: Date.now(),
    attemptsMade: 0,
    moveToDelayed: async (t: number) => {
      moved.push(t);
    },
  });

  it('bilinmeyen iş adı ve geçersiz yük kalıcı hatadır (UnrecoverableError)', async () => {
    const h = createFilesHandler({ scan: depsOf() });
    await expect(h(view('file.ocr', {}))).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(h(view('file.scan', { v: 1, fileId: 'x' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await expect(
      h(
        view('file.scan', {
          v: 1,
          orgId: w.orgA,
          fileId: randomUUID(),
          userId: w.up.id,
          name: 'ad.pdf',
        }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('altyapı kesintisi: moveToDelayed + DelayedError (deneme tüketmez)', async () => {
    const f = await seedFile(w.up);
    scanner.result = new ScannerUnavailableError('connect');
    const moved: number[] = [];
    const h = createFilesHandler({ scan: depsOf() });
    await expect(
      h(view('file.scan', { v: 1, orgId: w.orgA, fileId: f.id, userId: w.up.id }, moved)),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(moved).toHaveLength(1);
  });

  it('yükleyen büro üyesi değilse UnrecoverableError', async () => {
    const f = await seedFile(w.up);
    const h = createFilesHandler({ scan: depsOf() });
    await expect(
      h(view('file.scan', { v: 1, orgId: w.orgB, fileId: f.id, userId: w.up.id })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('temiz sonuç döner', async () => {
    const f = await seedFile(w.up);
    scanner.result = { status: 'clean' };
    const h = createFilesHandler({ scan: depsOf() });
    expect(
      await h(view('file.scan', { v: 1, orgId: w.orgA, fileId: f.id, userId: w.up.id })),
    ).toEqual({
      status: 'clean',
    });
  });
});

// ---------- KK-P20-24 ----------

describe('KK-P20-24: eda_worker sistem custody politikası (0046)', () => {
  const worker = () => db.runner('eda_worker');

  it('worker `actor_type = system` + `actor_id NULL` + `delete` olayını yazabilir', async () => {
    const f = await seedFile(w.up);
    await worker().withTenant({ orgId: w.orgA, userId: w.up.id }, (tx) =>
      tx.query(
        `INSERT INTO app.custody_events (org_id, file_id, case_id, event, actor_type, actor_id, metadata)
         VALUES ($1, $2, NULL, 'delete', 'system', NULL, '{"reason":"retention","size_bytes":1,"file_type":"pdf"}')`,
        [w.orgA, f.id],
      ),
    );
    const r = await inOrg<{ rows: { actor_type: string; actor_id: string | null }[] }>(w.up, (tx) =>
      tx.query('SELECT actor_type, actor_id FROM app.custody_events WHERE file_id = $1', [f.id]),
    );
    expect(r.rows).toEqual([{ actor_type: 'system', actor_id: null }]);
  });

  it('başka olay, başka aktör türü veya aktörsüz kullanıcı olayı reddedilir; UPDATE/DELETE yok', async () => {
    const f = await seedFile(w.up);
    const attempt = (event: string, type: string, actor: string | null) =>
      worker().withTenant({ orgId: w.orgA, userId: w.up.id }, (tx) =>
        tx.query(
          `INSERT INTO app.custody_events (org_id, file_id, event, actor_type, actor_id, metadata)
           VALUES ($1, $2, $3, $4, $5, '{}')`,
          [w.orgA, f.id, event, type, actor],
        ),
      );
    await expect(attempt('view', 'system', null)).rejects.toThrow();
    await expect(attempt('download', 'system', null)).rejects.toThrow();
    await expect(attempt('delete', 'user', null)).rejects.toThrow();
    await expect(attempt('delete', 'platform_staff', null)).rejects.toThrow();
    // Başka büro kimliğiyle (kiracı kapısı) yazılamaz.
    await expect(
      worker().withTenant({ orgId: w.orgB, userId: w.b.id }, (tx) =>
        tx.query(
          `INSERT INTO app.custody_events (org_id, file_id, event, actor_type, actor_id, metadata)
           VALUES ($1, $2, 'delete', 'system', NULL, '{}')`,
          [w.orgA, f.id],
        ),
      ),
    ).rejects.toThrow();
    await worker().withTenant({ orgId: w.orgA, userId: w.up.id }, (tx) =>
      tx.query(
        `INSERT INTO app.custody_events (org_id, file_id, event, actor_type, actor_id, metadata)
         VALUES ($1, $2, 'delete', 'system', NULL, '{}')`,
        [w.orgA, f.id],
      ),
    );
    await expect(
      worker().withTenant({ orgId: w.orgA, userId: w.up.id }, (tx) =>
        tx.query(`UPDATE app.custody_events SET event = 'view' WHERE file_id = $1`, [f.id]),
      ),
    ).rejects.toThrow();
    await expect(
      worker().withTenant({ orgId: w.orgA, userId: w.up.id }, (tx) =>
        tx.query('DELETE FROM app.custody_events WHERE file_id = $1', [f.id]),
      ),
    ).rejects.toThrow();
  });

  it('eda_app (api) sistem olayı yazamaz', async () => {
    const f = await seedFile(w.up);
    await expect(
      inOrg(w.up, (tx) =>
        tx.query(
          `INSERT INTO app.custody_events (org_id, file_id, event, actor_type, actor_id, metadata)
           VALUES ($1, $2, 'delete', 'system', NULL, '{}')`,
          [w.orgA, f.id],
        ),
      ),
    ).rejects.toThrow();
  });
});
