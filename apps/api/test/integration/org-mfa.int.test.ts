// @tk TK-04 TK-05 TK-06 TK-07
// P04b kabul testleri (gerçek PostgreSQL + Valkey + Better Auth 1.7.7 organization/twoFactor/passkey;
// `setupIdentity` + `createAppSurface`). Saat yalnız `Date` sahtelenerek ilerletilir (davet ömrü,
// step-up penceresi, TOTP penceresi). Passkey yazılım doğrulayıcısıyla (`webauthn.ts`) sınanır.
//  KK-P04b-1  (KK-042-9)   kapasitesi 1 kalan bürodaki iki eşzamanlı davet kabulü: 200 + 409 SEAT_LIMIT.
//  KK-P04b-2  (KK-042-7)   davet ömrü, tek kullanım, farklı e-posta, doğrulanmamış davet eden, davetle
//                           kayıt ve anında verified, süresi dolmuş davet yeniyi engellemez, profession.
//  KK-P04b-3  (KK-042-15, KK-040-10) askı/çıkarma etkisi, step-up, rol kuralları, owner PATCH yok.
//  KK-P04b-4  (KK-042-13)  aktif büro değişimi.
//  KK-P04b-5  (KK-042-2)   kapalı yollar 404.
//  KK-P04b-6  (KK-042-10)  MFA matrisi.
//  KK-P04b-7  (KK-042-11)  TOTP/passkey, tekrar kullanım, yedek kod, trustDevice, son yöntem.
//  KK-P04b-8  (KK-042-12)  step-up.
//  KK-P04b-9  (KK-040-11)  idempotency.
//  KK-P04b-11 (KK-042-16)  personel/bayi üyeliği ve oturumu.
//  KK-P04b-12 (KK-042-20)  denetim olayları, metadata ve günlük gizliliği.
//  KK-P04b-14 (KK-042-14, KK-040-9) çerezde rol yok; üyelik her istekte DB'den.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { ApiErrorEnvelope } from '@eda/contracts/errors';
import { parseKekFile, unsealJobParams } from '@eda/crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createAppSurface } from '../../src/app.ts';
import { SESSION_COOKIE } from '../../src/auth/cookies.ts';
import { closeAuthDbPool } from '../../src/auth/pool.ts';
import { createValkeyClient } from '../../src/clients/valkey.ts';
import { createReadiness } from '../../src/health/ready.ts';
import { type IdentitySetup, setupIdentity } from '../../src/identity.ts';
import { softAuthenticator, totpFromUri } from './webauthn.ts';

const APP_URL = 'https://app.ornek.test';
const DOMAIN = 'ornek.test';
const PASSWORD = 'Guclu-ve-uzun-parola-2026';
const KEY = randomUUID().slice(0, 8);

let db: TestingDb;
let kek: Buffer;
let redis: Redis;
let queueRedis: Redis;
let setup: IdentitySetup;
let app: ReturnType<typeof createAppSurface>['app'];
const logLines: string[] = [];
const setCookies: string[] = [];
const secrets: string[] = [PASSWORD];
const emails: string[] = [];
let ipSeq = Math.floor(Math.random() * 60_000);

const realNow = () => Math.floor(performance.timeOrigin + performance.now());
const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));
const freshIp = () => {
  ipSeq += 1;
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.33`;
};
const mail = (tag: string) => {
  const e = `${tag}.${KEY}@${DOMAIN}`;
  emails.push(e);
  return e;
};
const idemKey = () => randomUUID();

interface CallOpts {
  readonly method?: string;
  readonly body?: unknown;
  readonly cookie?: string;
  readonly ip?: string;
  readonly headers?: Record<string, string>;
}

async function call(path: string, o: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {
    origin: APP_URL,
    'x-forwarded-for': o.ip ?? freshIp(),
    ...o.headers,
  };
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.cookie !== undefined) headers.cookie = o.cookie;
  const res = await app.request(`${APP_URL}${path}`, {
    method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
  });
  setCookies.push(...res.headers.getSetCookie());
  return res;
}

const cookieOf = (res: Response, name: string): string | null => {
  const c = res.headers
    .getSetCookie()
    .find((x) => x.startsWith(`${name}=`) && !x.includes('Max-Age=0'));
  return c === undefined ? null : (c.split(';')[0] ?? null);
};
function sessionCookie(res: Response): string {
  const c = cookieOf(res, SESSION_COOKIE);
  if (c === null) throw new Error('oturum çerezi yok');
  return c;
}
const join2 = (...c: (string | null)[]) => c.filter((x) => x !== null && x !== '').join('; ');

async function errorOf(res: Response) {
  return ApiErrorEnvelope.parse(await res.json()).error;
}
/** Better Auth biçimi (`{ code, message, reason? }`). */
async function authErr(res: Response): Promise<{ code?: string; reason?: string }> {
  return (await res.json()) as { code?: string; reason?: string };
}

const signUp = (email: string, extra: Record<string, unknown> = {}) =>
  call('/api/auth/sign-up/email', {
    body: {
      name: 'Örnek Avukat',
      email,
      password: PASSWORD,
      acceptTerms: true,
      acknowledgePrivacy: true,
      ...extra,
    },
  });
const signIn = (email: string, extra: Record<string, unknown> = {}) =>
  call('/api/auth/sign-in/email', { body: { email, password: PASSWORD, ...extra } });

async function userId(email: string): Promise<string> {
  const id = await db.auth.userIdByEmail(email);
  if (id === null) throw new Error('kullanıcı yok');
  return id;
}

async function templatesOf(uid: string): Promise<string[]> {
  return db.runner('eda_worker').withUserScope({ userId: uid }, async (tx) => {
    const r = await tx.query<{ template_code: string }>(
      'SELECT template_code FROM app.email_deliveries WHERE user_id = $1 ORDER BY created_at',
      [uid],
    );
    return r.rows.map((x) => x.template_code);
  });
}

async function verifyToken(uid: string): Promise<string> {
  return db.runner('eda_worker').withUserScope({ userId: uid }, async (tx) => {
    const r = await tx.query<{ id: string; sealed_params: Buffer | null }>(
      `SELECT id, sealed_params FROM app.email_deliveries
       WHERE user_id = $1 AND template_code = 'verify_email' ORDER BY created_at DESC LIMIT 1`,
      [uid],
    );
    const row = r.rows[0];
    if (row?.sealed_params == null) throw new Error('doğrulama satırı yok');
    const p = unsealJobParams(
      kek,
      { deliveryId: row.id, template: 'verify_email', userId: uid },
      row.sealed_params,
    );
    secrets.push(p.token ?? '');
    return p.token ?? '';
  });
}

interface U {
  readonly email: string;
  readonly uid: string;
  cookie: string;
}

/** Kayıt + doğrulama (bireysel büro açılır); isteğe bağlı `verified`. */
async function user(tag: string, verified = true): Promise<U> {
  const email = mail(tag);
  expect((await signUp(email)).status).toBe(200);
  const uid = await userId(email);
  const res = await call(
    `/api/auth/verify-email?token=${encodeURIComponent(await verifyToken(uid))}`,
  );
  expect(res.status).toBe(200);
  if (verified) await db.auth.setVerification(uid, 'verified');
  return { email, uid, cookie: sessionCookie(res) };
}

const tokenOf = (cookie: string): string => {
  const v = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  return v.slice(0, v.lastIndexOf('.'));
};

/** `signInAs` karşılığı (042 §14): oturum alanları sunucu bağdaştırıcısıyla (DB + Valkey). */
async function setSession(cookie: string, fields: Record<string, unknown>): Promise<void> {
  const ctx = await setup.identity.auth.$context;
  await ctx.internalAdapter.updateSession(tokenOf(cookie), fields);
}
const mfaOk = (cookie: string) => setSession(cookie, { mfaLevel: 'totp', stepUpAt: new Date() });
const stepUpNow = (cookie: string) => setSession(cookie, { stepUpAt: new Date() });

async function setActive(cookie: string, organizationId: string | null) {
  return call('/api/auth/organization/set-active', { body: { organizationId }, cookie });
}

interface Firm {
  readonly org: string;
  readonly owner: U;
}

/** Firma bürosu: owner verified + MFA'lı oturum + `seats` koltuk; aktif büro firma. */
async function firm(tag: string, seats = 10): Promise<Firm> {
  const owner = await user(`${tag}-sahip`);
  const org = await db.auth.insertOrg('Örnek Test Bürosu', 'firm');
  await db.auth.addMember(org, owner.uid, 'owner');
  await db.auth.grantSeats(org, seats);
  await db
    .runner('eda_app')
    .withTenant({ orgId: org, userId: owner.uid }, (tx) =>
      tx.query('INSERT INTO app.org_settings (org_id) VALUES ($1)', [org]),
    );
  expect((await setActive(owner.cookie, org)).status).toBe(200);
  await mfaOk(owner.cookie);
  return { org, owner };
}

async function invite(
  f: { org: string; owner: U },
  email: string,
  role = 'assistant',
  key = idemKey(),
) {
  return call('/api/v1/org/invitations', {
    body: { email, role },
    cookie: f.owner.cookie,
    headers: { 'idempotency-key': key },
  });
}

async function invitationId(org: string, email: string): Promise<string> {
  const rows = await db.auth.invitationRows(org);
  const r = rows.filter((x) => x.email === email && x.status === 'pending').at(-1);
  if (r === undefined) throw new Error('davet yok');
  secrets.push(r.id);
  return r.id;
}

/** Davetli mevcut kullanıcı: davet + kabul; üye kimliği. */
async function joinFirm(f: Firm, tag: string, role: string): Promise<U & { memberId: string }> {
  const u = await user(tag);
  expect((await invite(f, u.email, role)).status).toBe(201);
  // Doğrulanmış kullanıcı meslek profili gerektirmeden katılır (042 §4.2 adım 4).
  const inv = await invitationId(f.org, u.email);
  const acc = await call('/api/auth/organization/accept-invitation', {
    body: { invitationId: inv },
    cookie: u.cookie,
  });
  expect(acc.status).toBe(200);
  const body = (await acc.json()) as { member: { id: string } };
  return { ...u, memberId: body.member.id };
}

async function auditRows(action: string) {
  return db.jobsQuery<{ metadata: Record<string, unknown>; org_id: string | null }>(
    'SELECT metadata, org_id FROM app.audit_log WHERE action = $1 ORDER BY created_at',
    [action],
  );
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(realNow()));
  const pg = inject('pg');
  const v = inject('valkey');
  db = createTestingDb(pg);
  const kekFile = readFileSync(pathJoin(pg.secretsDir, 'kek_master'), 'utf8');
  kek = parseKekFile(kekFile).kek;
  redis = createValkeyClient(v, 'eda-api-it-p04b');
  queueRedis = createValkeyClient(v, 'eda-api-it-p04b-queue');
  await Promise.all([redis.connect(), queueRedis.connect()]);
  const logger = createLogger({
    service: 'eda-api-it',
    level: 'debug',
    destination: { write: (l) => logLines.push(l) },
  });
  setup = setupIdentity({
    edaEnv: 'test',
    appUrl: APP_URL,
    baseURL: APP_URL,
    secret: `test-${randomUUID()}-${randomUUID()}`,
    passkeyRpId: DOMAIN,
    kekFileContent: kekFile,
    hmacKey: Buffer.from(randomUUID()),
    redis,
    queueRedis,
    logger,
    rerankEnabled: false,
    maintenance: () => false,
    // Tüm dosya aynı UTC günü ortak sayaçları kullanır; günlük e-posta tavanı ayrı testte sınanır.
    emailDailyCaps: { global: 10_000_000, perIp: 10_000_000 },
  });
  const state = { draining: false };
  app = createAppSurface({
    surface: 'app',
    logger,
    state,
    maintenanceMode: () => false,
    jsonBodyMaxBytes: 65_536,
    ready: createReadiness({ probes: [], cacheMs: 0, version: 'test', state }),
    identity: setup.surface,
  }).app;
});

afterAll(async () => {
  vi.useRealTimers();
  await setup?.producer.close().catch(() => undefined);
  await Promise.all([redis?.quit(), queueRedis?.quit()]).catch(() => undefined);
  await closeAuthDbPool().catch(() => undefined);
  await db?.close();
});

describe('KK-P04b-1 (KK-042-9): eşzamanlı davet kabulünde koltuk', () => {
  it('kapasitesi 1 kalan büroda iki eşzamanlı kabulden biri 200, diğeri 409 SEAT_LIMIT_REACHED', async () => {
    const f = await firm('koltuk', 3);
    const a = await user('koltuk-a');
    const b = await user('koltuk-b');
    expect((await invite(f, a.email)).status).toBe(201);
    expect((await invite(f, b.email)).status).toBe(201);
    // Kapasite 2 (sahip + 1): iki bekleyen davetten yalnız biri kabul edilebilir.
    await db.auth.setSeats(f.org, 2);
    const ia = await invitationId(f.org, a.email);
    const ib = await invitationId(f.org, b.email);
    const [ra, rb] = await Promise.all([
      call('/api/auth/organization/accept-invitation', {
        body: { invitationId: ia },
        cookie: a.cookie,
      }),
      call('/api/auth/organization/accept-invitation', {
        body: { invitationId: ib },
        cookie: b.cookie,
      }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect((await authErr(loser)).code).toBe('SEAT_LIMIT_REACHED');
    expect(await db.auth.memberCount(f.org)).toBe(2);
    // Kaybeden davet yeniden bekliyor (kabul geri alındı); koltuk açılmadıkça kabul edilemez.
    const statuses = (await db.auth.invitationRows(f.org)).map((x) => x.status).sort();
    expect(statuses).toEqual(['accepted', 'pending']);
  });

  it('dolu büroya davet ön denetimi 409 SEAT_LIMIT_REACHED (üye + bekleyen davet)', async () => {
    const f = await firm('dolu', 2);
    expect((await invite(f, mail('dolu-1'))).status).toBe(201);
    const res = await invite(f, mail('dolu-2'));
    expect(res.status).toBe(409);
    const err = await errorOf(res);
    expect(err.code).toBe('SEAT_LIMIT_REACHED');
    expect(err.reason).toBe('seat_limit');
  });
});

describe('KK-P04b-2 (KK-042-7): davet akışı', () => {
  it('davetle kayıt: e-posta doğrulanmış açılır, bireysel büro yok; meslek profili olmadan 422 profession_required; profil sonrası kabul ve anında verified', async () => {
    const f = await firm('davetkayit');
    const email = mail('davetli-avukat');
    expect((await invite(f, email, 'lawyer')).status).toBe(201);
    const inv = await invitationId(f.org, email);
    // Geçersiz davet belirteci genel hata (varlık sızmaz).
    const bad = await signUp(email, { invitationToken: randomUUID() });
    expect(bad.status).toBe(400);
    expect((await authErr(bad)).code).toBe('INVITATION_INVALID');
    expect((await signUp(email, { invitationToken: inv })).status).toBe(200);
    const uid = await userId(email);
    expect(await db.auth.userState(uid)).toEqual({
      emailVerified: true,
      verificationStatus: 'pending_verification',
    });
    expect(await templatesOf(uid)).not.toContain('verify_email');
    const login = await signIn(email);
    expect(login.status).toBe(200);
    const cookie = sessionCookie(login);
    expect(await db.auth.memberships(uid)).toEqual([]);
    const view = await call(`/api/auth/organization/get-invitation?id=${inv}`, { cookie });
    expect(view.status).toBe(200);
    const early = await call('/api/auth/organization/accept-invitation', {
      body: { invitationId: inv },
      cookie,
    });
    expect(early.status).toBe(422);
    expect(await authErr(early)).toMatchObject({
      code: 'VALIDATION_FAILED',
      reason: 'profession_required',
    });
    const appl = await call('/api/v1/me/lawyer-application', {
      body: {
        kind: 'lawyer',
        baro: 'Ankara Barosu',
        sicilNo: `D${randomUUID().slice(0, 8)}`,
        declareProfession: true,
        invitationId: inv,
      },
      cookie,
    });
    expect(appl.status).toBe(200);
    expect(await appl.json()).toMatchObject({ profile: { verificationSource: 'org_invitation' } });
    expect(await templatesOf(uid)).not.toContain('lawyer_application_received');
    const ok = await call('/api/auth/organization/accept-invitation', {
      body: { invitationId: inv },
      cookie,
    });
    expect(ok.status).toBe(200);
    expect((await db.auth.userState(uid))?.verificationStatus).toBe('verified');
    const me = (await (await call('/api/v1/me', { cookie })).json()) as {
      activeOrg: { id: string; role: string } | null;
    };
    expect(me.activeOrg).toMatchObject({ id: f.org, role: 'lawyer' });
    // Tek kullanımlık.
    const again = await call('/api/auth/organization/accept-invitation', {
      body: { invitationId: inv },
      cookie,
    });
    expect(again.status).toBe(400);
  });

  it('farklı e-postalı oturum daveti okuyamaz ve kabul edemez (genel hata)', async () => {
    const f = await firm('baskaeposta');
    const target = mail('hedef');
    expect((await invite(f, target)).status).toBe(201);
    const inv = await invitationId(f.org, target);
    const other = await user('baska');
    const get = await call(`/api/auth/organization/get-invitation?id=${inv}`, {
      cookie: other.cookie,
    });
    const acc = await call('/api/auth/organization/accept-invitation', {
      body: { invitationId: inv },
      cookie: other.cookie,
    });
    expect(get.status).toBe(400);
    expect(acc.status).toBe(400);
    // Var olmayan davet kimliği aynı yanıtı verir (varlık ayrışmaz).
    const accText = JSON.stringify(await authErr(acc));
    const rnd = await call('/api/auth/organization/accept-invitation', {
      body: { invitationId: randomUUID() },
      cookie: other.cookie,
    });
    expect(rnd.status).toBe(400);
    expect(JSON.stringify(await authErr(rnd))).toBe(accText);
  });

  it('verified olmayan kullanıcı davet edemez (403 AUTH_PENDING_VERIFICATION)', async () => {
    const f = await firm('dogrulanmamis');
    await db.auth.setVerification(f.owner.uid, 'pending_verification');
    const res = await invite(f, mail('kimse'));
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('AUTH_PENDING_VERIFICATION');
  });

  it('kendi/mevcut üye adresi 409 already_member; geçerli bekleyen davet 409 invitation_pending; admin admin davet edemez', async () => {
    const f = await firm('cakisma');
    const self = await invite(f, f.owner.email);
    expect(self.status).toBe(409);
    expect((await errorOf(self)).reason).toBe('already_member');
    const e = mail('bekleyen');
    expect((await invite(f, e)).status).toBe(201);
    const dup = await invite(f, e);
    expect(dup.status).toBe(409);
    expect((await errorOf(dup)).reason).toBe('invitation_pending');
    const adm = await joinFirm(f, 'cakisma-admin', 'admin');
    await mfaOk(adm.cookie);
    const byAdmin = await call('/api/v1/org/invitations', {
      body: { email: mail('admin-adayi'), role: 'admin' },
      cookie: adm.cookie,
      headers: { 'idempotency-key': idemKey() },
    });
    expect(byAdmin.status).toBe(403);
    expect((await errorOf(byAdmin)).code).toBe('ORG_ROLE_INSUFFICIENT');
  });

  it('72 saat sonra davet kabul edilemez; süresi dolmuş bekleyen davet yeni daveti engellemez', async () => {
    const f = await firm('suresi');
    const u = await user('suresi-uye');
    expect((await invite(f, u.email)).status).toBe(201);
    const inv = await invitationId(f.org, u.email);
    advance(CONFIG_DEFAULTS['auth.inviteTtlHours'] * 3_600_000 + 60_000);
    const fresh = sessionCookie(await signIn(u.email));
    const late = await call('/api/auth/organization/accept-invitation', {
      body: { invitationId: inv },
      cookie: fresh,
    });
    expect(late.status).toBe(400);
    expect((await authErr(late)).code).toBe('INVITATION_INVALID');
    // Sahibin oturumu da boşta süresini aştı: yeniden giriş + MFA.
    f.owner.cookie = sessionCookie(await signIn(f.owner.email));
    expect((await setActive(f.owner.cookie, f.org)).status).toBe(200);
    await mfaOk(f.owner.cookie);
    expect((await invite(f, u.email)).status).toBe(201);
    const statuses = (await db.auth.invitationRows(f.org)).map((x) => x.status).sort();
    expect(statuses).toEqual(['canceled', 'pending']);
  });

  it('davet iptali ref ile; liste davet kimliğini döndürmez', async () => {
    const f = await firm('iptal');
    const e = mail('iptal-aday');
    const created = await invite(f, e);
    const dto = (await created.json()) as Record<string, unknown>;
    const inv = await invitationId(f.org, e);
    expect(JSON.stringify(dto)).not.toContain(inv);
    expect(dto.ref).toBe(createHash('sha256').update(inv).digest('hex').slice(0, 12));
    const list = await call('/api/v1/org/invitations', { cookie: f.owner.cookie });
    expect(list.status).toBe(200);
    expect(await list.clone().text()).not.toContain(inv);
    const del = await call(`/api/v1/org/invitations/${String(dto.ref)}`, {
      method: 'DELETE',
      cookie: f.owner.cookie,
    });
    expect(del.status).toBe(200);
    expect((await db.auth.invitationRows(f.org)).map((x) => x.status)).toEqual(['canceled']);
  });
});

describe('KK-P04b-3 (KK-042-15, KK-040-10): üye askısı, rol ve çıkarma', () => {
  it('askı step-up ister; askı sonrası oturumlarda aktif büro NULL, büroya dönüş 403 ORG_NOT_MEMBER; geri alma', async () => {
    const f = await firm('aski');
    const l = await joinFirm(f, 'aski-avukat', 'lawyer');
    advance((CONFIG_DEFAULTS['auth.stepUpWindowMin'] + 1) * 60_000);
    const denied = await call(`/api/v1/org/members/${l.memberId}`, {
      method: 'PATCH',
      body: { status: 'suspended' },
      cookie: f.owner.cookie,
    });
    expect(denied.status).toBe(403);
    const err = await errorOf(denied);
    expect(err.code).toBe('AUTH_STEP_UP_REQUIRED');
    expect(err.actions).toEqual(['step_up']);
    await stepUpNow(f.owner.cookie);
    const ok = await call(`/api/v1/org/members/${l.memberId}`, {
      method: 'PATCH',
      body: { status: 'suspended' },
      cookie: f.owner.cookie,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'suspended', role: 'lawyer' });
    for (const s of await db.auth.sessionRows(l.uid))
      expect(s.activeOrganizationId).not.toBe(f.org);
    const back = await setActive(l.cookie, f.org);
    expect(back.status).toBe(403);
    expect((await authErr(back)).code).toBe('ORG_NOT_MEMBER');
    const un = await call(`/api/v1/org/members/${l.memberId}`, {
      method: 'PATCH',
      body: { status: 'active' },
      cookie: f.owner.cookie,
    });
    expect(un.status).toBe(200);
    expect((await setActive(l.cookie, f.org)).status).toBe(200);
  });

  it("DB'de askıya alınan üyeliğin bir sonraki isteği 403 ORG_NOT_MEMBER (önbellek yok)", async () => {
    const f = await firm('dbaski');
    const l = await joinFirm(f, 'dbaski-avukat', 'lawyer');
    expect((await call('/api/v1/org/members', { cookie: l.cookie })).status).toBe(200);
    await db.auth.setMemberStatus(f.org, l.uid, 'suspended');
    const res = await call('/api/v1/org/members', { cookie: l.cookie });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('ORG_NOT_MEMBER');
  });

  it('çıkarma step-up ile; oturumlar temizlenir; içerik devri denetimi yazılır', async () => {
    const f = await firm('cikar');
    const l = await joinFirm(f, 'cikar-avukat', 'lawyer');
    await stepUpNow(f.owner.cookie);
    const del = await call(`/api/v1/org/members/${l.memberId}`, {
      method: 'DELETE',
      cookie: f.owner.cookie,
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ id: l.memberId, status: 'removed' });
    for (const s of await db.auth.sessionRows(l.uid))
      expect(s.activeOrganizationId).not.toBe(f.org);
    expect((await setActive(l.cookie, f.org)).status).toBe(403);
    const transfers = await auditRows('org.conversations.transferred');
    expect(transfers.some((r) => r.org_id === f.org)).toBe(true);
  });

  it('admin owner/admin üzerinde işlem yapamaz; kimse kendini yönetemez; owner rolü PATCH ile atanamaz; son owner kendini çıkaramaz', async () => {
    const f = await firm('roller');
    const a1 = await joinFirm(f, 'roller-admin1', 'admin');
    const a2 = await joinFirm(f, 'roller-admin2', 'admin');
    const l = await joinFirm(f, 'roller-avukat', 'lawyer');
    await mfaOk(a1.cookie);
    const ownerMember = (
      (await (await call('/api/v1/org/members', { cookie: f.owner.cookie })).json()) as {
        items: { id: string; role: string }[];
      }
    ).items.find((m) => m.role === 'owner');
    const patch = (cookie: string, id: string, body: unknown) =>
      call(`/api/v1/org/members/${id}`, { method: 'PATCH', body, cookie });
    const onOwner = await patch(a1.cookie, ownerMember?.id ?? '', { status: 'suspended' });
    expect((await errorOf(onOwner)).code).toBe('ORG_ROLE_INSUFFICIENT');
    const onAdmin = await patch(a1.cookie, a2.memberId, { role: 'lawyer' });
    expect((await errorOf(onAdmin)).code).toBe('ORG_ROLE_INSUFFICIENT');
    const promote = await patch(a1.cookie, l.memberId, { role: 'admin' });
    expect((await errorOf(promote)).code).toBe('ORG_ROLE_INSUFFICIENT');
    const self = await patch(a1.cookie, a1.memberId, { role: 'senior_lawyer' });
    expect(self.status).toBe(403);
    expect((await errorOf(self)).reason).toBe('policy_denied');
    const toOwner = await patch(f.owner.cookie, l.memberId, { role: 'owner' });
    expect(toOwner.status).toBe(422);
    const lastOwner = await call(`/api/v1/org/members/${ownerMember?.id ?? ''}`, {
      method: 'DELETE',
      cookie: f.owner.cookie,
    });
    expect(lastOwner.status).toBe(403);
    // Admin, owner/admin dışını yönetebilir.
    expect((await patch(a1.cookie, l.memberId, { role: 'trainee' })).status).toBe(200);
  });
});

describe('KK-P04b-4 (KK-042-13): aktif büro değişimi', () => {
  it('üyesi olunmayan ve askıdaki büroya geçiş reddedilir; önceki büro verisi 404; X-Eda-Org-Id uyuşmazlığı 409', async () => {
    const f = await firm('aktif');
    const l = await joinFirm(f, 'aktif-avukat', 'lawyer');
    const other = await firm('yabanci');
    const notMember = await setActive(l.cookie, other.org);
    expect(notMember.status).toBe(403);
    expect((await authErr(notMember)).code).toBe('ORG_NOT_MEMBER');
    // Bireysel büroya geç: firmanın üye kaynağı 404.
    const individual = (await db.auth.memberships(l.uid)).find((m) => m.kind === 'individual');
    expect((await setActive(l.cookie, individual?.orgId ?? '')).status).toBe(200);
    await stepUpNow(l.cookie);
    const foreign = await call(`/api/v1/org/members/${l.memberId}`, {
      method: 'PATCH',
      body: { status: 'suspended' },
      cookie: l.cookie,
    });
    expect(foreign.status).toBe(404);
    const mismatch = await call('/api/v1/org', {
      cookie: l.cookie,
      headers: { 'x-eda-org-id': f.org },
    });
    expect(mismatch.status).toBe(409);
    expect(await errorOf(mismatch)).toMatchObject({
      code: 'ORG_NO_ACTIVE',
      reason: 'active_org_changed',
    });
    await db.auth.setOrgSuspended(f.org, true);
    const suspended = await setActive(l.cookie, f.org);
    expect(suspended.status).toBe(403);
    expect(await authErr(suspended)).toMatchObject({
      code: 'AUTH_SUSPENDED',
      reason: 'org_suspended',
    });
    await db.auth.setOrgSuspended(f.org, false);
  });
});

describe('KK-P04b-5 (KK-042-2 genişletilmiş): kapalı yollar 404', () => {
  it('organization yönetimi, two-factor/get-totp-uri ve admin/* 404; açık yollar kurulu', async () => {
    const u = await user('yollar');
    for (const p of [
      'organization/create',
      'organization/update',
      'organization/delete',
      'organization/invite-member',
      'organization/remove-member',
      'organization/update-member-role',
      'organization/leave',
      'organization/list',
      'two-factor/get-totp-uri',
      'two-factor/send-otp',
      'admin/set-role',
      'admin/impersonate-user',
      'admin/list-users',
    ]) {
      const res = await call(`/api/auth/${p}`, { body: {}, cookie: u.cookie });
      expect(res.status, p).toBe(404);
    }
    expect((await call('/api/auth/passkey/list-user-passkeys', { cookie: u.cookie })).status).toBe(
      200,
    );
  });
});

describe('KK-P04b-6 (KK-042-10): MFA matrisi', () => {
  it("firm owner MFA'sız policy uçta 403 AUTH_MFA_REQUIRED, exempt uca erişir; mfa_required_all lawyer'ı kapsar; diğer roller serbest", async () => {
    const f = await firm('mfa');
    await setSession(f.owner.cookie, { mfaLevel: 'none' });
    const policy = await call('/api/v1/org/members', { cookie: f.owner.cookie });
    expect(policy.status).toBe(403);
    const err = await errorOf(policy);
    expect(err).toMatchObject({ code: 'AUTH_MFA_REQUIRED', reason: 'mfa_required_role' });
    expect(err.actions).toEqual(['enroll_totp', 'enroll_passkey']);
    expect((await call('/api/v1/org', { cookie: f.owner.cookie })).status).toBe(200);
    const me = (await (await call('/api/v1/me', { cookie: f.owner.cookie })).json()) as {
      activeOrg: { mfa: unknown };
    };
    expect(me.activeOrg.mfa).toEqual({ required: true, reason: 'mfa_required_role' });
    await mfaOk(f.owner.cookie);
    const l = await joinFirm(f, 'mfa-avukat', 'lawyer');
    expect((await call('/api/v1/org/members', { cookie: l.cookie })).status).toBe(200);
    await db
      .runner('eda_app')
      .withTenant({ orgId: f.org, userId: f.owner.uid }, (tx) =>
        tx.query('UPDATE app.org_settings SET mfa_required_all = true WHERE org_id = $1', [f.org]),
      );
    const all = await call('/api/v1/org/members', { cookie: l.cookie });
    expect(all.status).toBe(403);
    expect((await errorOf(all)).reason).toBe('mfa_required_org');
  });

  it("tek kişilik büro sahibi MFA'sız istemci verisi olmayan uçları kullanır; /me istemci verisi zorunluluğunu bildirir", async () => {
    const u = await user('bireysel');
    expect((await call('/api/v1/org', { cookie: u.cookie })).status).toBe(200);
    expect((await call('/api/v1/org/members', { cookie: u.cookie })).status).toBe(200);
    const me = (await (await call('/api/v1/me', { cookie: u.cookie })).json()) as {
      activeOrg: { mfa: unknown; kind: string };
    };
    expect(me.activeOrg.kind).toBe('individual');
    expect(me.activeOrg.mfa).toEqual({ required: true, reason: 'mfa_required_client_data' });
  });
});

describe('KK-P04b-7 (KK-042-11): TOTP ve passkey', () => {
  it('TOTP etkinleştirme mfa_level totp; trustDevice reddi; aynı kod ikinci kez reddedilir; girişte ikinci adım; yedek kod tek kullanımlık', async () => {
    const u = await user('totp');
    const enable = await call('/api/auth/two-factor/enable', {
      body: { password: PASSWORD },
      cookie: u.cookie,
    });
    expect(enable.status).toBe(200);
    const { totpURI, backupCodes } = (await enable.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    secrets.push(...backupCodes, new URL(totpURI).searchParams.get('secret') ?? '');
    const trust = await call('/api/auth/two-factor/verify-totp', {
      body: { code: totpFromUri(totpURI), trustDevice: true },
      cookie: u.cookie,
    });
    expect(trust.status).toBe(400);
    expect((await authErr(trust)).code).toBe('TRUST_DEVICE_DISABLED');
    const code = totpFromUri(totpURI);
    const ok = await call('/api/auth/two-factor/verify-totp', { body: { code }, cookie: u.cookie });
    expect(ok.status).toBe(200);
    u.cookie = sessionCookie(ok);
    const sessions = await db.auth.sessionRows(u.uid);
    expect(sessions.at(-1)?.mfaLevel).toBe('totp');
    expect(await db.auth.twoFactorEnabled(u.uid)).toBe(true);
    expect(await templatesOf(u.uid)).toContain('factor_changed');
    const replay = await call('/api/auth/two-factor/verify-totp', {
      body: { code },
      cookie: u.cookie,
    });
    expect(replay.status).toBe(401);
    // Kayıtlı MFA'lı kullanıcıda giriş ikinci adım ister: oturum çerezi yok.
    const pw = await signIn(u.email);
    expect(pw.status).toBe(200);
    expect(await pw.json()).toMatchObject({ twoFactorRedirect: true });
    expect(cookieOf(pw, SESSION_COOKIE)).toBeNull();
    const pending = cookieOf(pw, '__Host-eda.two_factor');
    expect(pending).not.toBeNull();
    advance(31_000);
    const second = await call('/api/auth/two-factor/verify-totp', {
      body: { code: totpFromUri(totpURI) },
      cookie: pending ?? '',
    });
    expect(second.status).toBe(200);
    expect((await db.auth.sessionRows(u.uid)).at(-1)?.mfaLevel).toBe('totp');
    const viaBackup = async () => {
      const r = await signIn(u.email);
      return call('/api/auth/two-factor/verify-backup-code', {
        body: { code: backupCodes[0] },
        cookie: cookieOf(r, '__Host-eda.two_factor') ?? '',
      });
    };
    expect((await viaBackup()).status).toBe(200);
    expect((await viaBackup()).status).toBe(401);
  });

  it('mfa_level istemci değeriyle yazılamaz', async () => {
    const u = await user('istemci');
    const r = await signIn(u.email, { mfaLevel: 'passkey', stepUpAt: '2020-01-01T00:00:00Z' });
    expect(r.status).toBe(200);
    expect((await db.auth.sessionRows(u.uid)).at(-1)?.mfaLevel).toBe('none');
  });

  it('passkey kaydı oturumun mfa_level ve step_up_at değerini yükseltmez (Y-1); passkey girişi passkey yazar; sayaç geriye giderse giriş reddedilir', async () => {
    const u = await user('passkey');
    const auth = softAuthenticator(DOMAIN, APP_URL);
    const before = (await db.auth.sessionRows(u.uid)).at(-1);
    advance(60_000);
    const opts = await call('/api/auth/passkey/generate-register-options', { cookie: u.cookie });
    expect(opts.status).toBe(200);
    const challenge = cookieOf(opts, '__Host-eda.passkey_challenge');
    expect(challenge).not.toBeNull();
    const reg = await call('/api/auth/passkey/verify-registration', {
      body: { response: auth.register((await opts.json()) as { challenge: string }) },
      cookie: join2(u.cookie, challenge),
    });
    expect(reg.status).toBe(200);
    expect(await db.auth.passkeyCount(u.uid)).toBe(1);
    // Yeni (yazılım) doğrulayıcı kendini ispat etmez: düzey ve step-up zamanı DEĞİŞMEZ.
    const afterReg = (await db.auth.sessionRows(u.uid)).at(-1);
    expect(afterReg?.mfaLevel).toBe('none');
    expect(afterReg?.stepUpAt?.getTime()).toBe(before?.stepUpAt?.getTime());
    const login = async (counter?: number) => {
      const o = await call('/api/auth/passkey/generate-authenticate-options');
      const c = cookieOf(o, '__Host-eda.passkey_challenge');
      return call('/api/auth/passkey/verify-authentication', {
        body: {
          response: auth.authenticate(
            (await o.json()) as { challenge: string },
            counter === undefined ? {} : { counter },
          ),
        },
        cookie: c ?? '',
      });
    };
    const ok = await login();
    expect(ok.status).toBe(200);
    const sess = await db.auth.sessionRows(u.uid);
    expect(sess.at(-1)?.mfaLevel).toBe('passkey');
    const cloned = await login(0);
    expect(cloned.status).toBe(401);
    expect((await authErr(cloned)).code).toBe('PASSKEY_COUNTER');
    const fails = await auditRows('auth.login.failure');
    expect(fails.some((r) => r.metadata.reason === 'passkey_counter')).toBe(true);
  });

  it('zorunlu rolün son yöntemi kaldırılamaz; zorunlu olmayan kullanıcı step-up ile kaldırır', async () => {
    const f = await firm('sonyontem');
    const enable = await call('/api/auth/two-factor/enable', {
      body: { password: PASSWORD },
      cookie: f.owner.cookie,
    });
    const { totpURI } = (await enable.json()) as { totpURI: string };
    const ok = await call('/api/auth/two-factor/verify-totp', {
      body: { code: totpFromUri(totpURI) },
      cookie: f.owner.cookie,
    });
    expect(ok.status).toBe(200);
    f.owner.cookie = sessionCookie(ok);
    const blocked = await call('/api/auth/two-factor/disable', {
      body: { password: PASSWORD },
      cookie: f.owner.cookie,
    });
    expect(blocked.status).toBe(403);
    expect(await errorOf(blocked)).toMatchObject({
      code: 'AUTH_FORBIDDEN',
      reason: 'mfa_required_role',
    });

    const u = await user('kaldir');
    const en2 = await call('/api/auth/two-factor/enable', {
      body: { password: PASSWORD },
      cookie: u.cookie,
    });
    const uri2 = ((await en2.json()) as { totpURI: string }).totpURI;
    advance(31_000);
    const v2 = await call('/api/auth/two-factor/verify-totp', {
      body: { code: totpFromUri(uri2) },
      cookie: u.cookie,
    });
    u.cookie = sessionCookie(v2);
    advance((CONFIG_DEFAULTS['auth.stepUpWindowMin'] + 1) * 60_000);
    const noStep = await call('/api/auth/two-factor/disable', {
      body: { password: PASSWORD },
      cookie: u.cookie,
    });
    expect(noStep.status).toBe(403);
    expect((await errorOf(noStep)).code).toBe('AUTH_STEP_UP_REQUIRED');
    advance(31_000);
    const step = await call('/api/v1/me/step-up', {
      body: { method: 'totp', code: totpFromUri(uri2) },
      cookie: u.cookie,
    });
    expect(step.status).toBe(200);
    const off = await call('/api/auth/two-factor/disable', {
      body: { password: PASSWORD },
      cookie: u.cookie,
    });
    expect(off.status).toBe(200);
    expect(await db.auth.twoFactorEnabled(u.uid)).toBe(false);
    // Kaldırma oturumu döndürür ama mfa_level düşmez.
    expect((await db.auth.sessionRows(u.uid)).at(-1)?.mfaLevel).toBe('totp');
  });
});

describe('KK-P04b-8 (KK-042-12): step-up', () => {
  it('pencere dışında kimlik yolları 403; parola step-up sonrası geçer; oturum yaratmaz, mfa_level düşmez', async () => {
    const u = await user('stepup');
    advance((CONFIG_DEFAULTS['auth.stepUpWindowMin'] + 1) * 60_000);
    for (const p of [
      'change-password',
      'two-factor/disable',
      'two-factor/generate-backup-codes',
      'passkey/delete-passkey',
    ]) {
      const r = await call(`/api/auth/${p}`, { body: {}, cookie: u.cookie });
      expect(r.status, p).toBe(403);
      expect((await errorOf(r)).code, p).toBe('AUTH_STEP_UP_REQUIRED');
    }
    await setSession(u.cookie, { mfaLevel: 'totp' });
    const before = await db.auth.sessionRows(u.uid);
    const s = await call('/api/v1/me/step-up', {
      body: { method: 'password', password: PASSWORD },
      cookie: u.cookie,
    });
    // MFA'sı kayıtlı olmayan kullanıcıda parola yöntemi geçerlidir (042 §6.1).
    expect(s.status).toBe(200);
    const dto = (await s.json()) as { stepUpAt: string; expiresAt: string };
    expect(new Date(dto.expiresAt).getTime() - new Date(dto.stepUpAt).getTime()).toBe(
      CONFIG_DEFAULTS['auth.stepUpWindowMin'] * 60_000,
    );
    const after = await db.auth.sessionRows(u.uid);
    expect(after.length).toBe(before.length);
    expect(after.at(-1)?.mfaLevel).toBe('totp');
    const newPassword = 'Bambaska-uzun-parola-2026';
    secrets.push(newPassword);
    const change = await call('/api/auth/change-password', {
      body: { currentPassword: PASSWORD, newPassword },
      cookie: u.cookie,
    });
    expect(change.status).toBe(200);
  });

  it("6. hatalı deneme 429; MFA'lı kullanıcıda parola yöntemi reddedilir", async () => {
    const u = await user('stepup-hata');
    for (let i = 0; i < CONFIG_DEFAULTS['rateLimit.stepUpPerUserPerMin']; i++) {
      const r = await call('/api/v1/me/step-up', {
        body: { method: 'password', password: `yanlis-parola-${i}` },
        cookie: u.cookie,
      });
      expect(r.status).toBe(422);
    }
    const sixth = await call('/api/v1/me/step-up', {
      body: { method: 'password', password: 'yanlis-parola-6' },
      cookie: u.cookie,
    });
    expect(sixth.status).toBe(429);
    expect((await errorOf(sixth)).reason).toBe('step_up');
    const m = await user('stepup-yontem');
    const en = await call('/api/auth/two-factor/enable', {
      body: { password: PASSWORD },
      cookie: m.cookie,
    });
    const uri = ((await en.json()) as { totpURI: string }).totpURI;
    const v = await call('/api/auth/two-factor/verify-totp', {
      body: { code: totpFromUri(uri) },
      cookie: m.cookie,
    });
    m.cookie = sessionCookie(v);
    const wrong = await call('/api/v1/me/step-up', {
      body: { method: 'password', password: PASSWORD },
      cookie: m.cookie,
    });
    expect(wrong.status).toBe(403);
    expect((await errorOf(wrong)).reason).toBe('policy_denied');
  });

  it('passkey step-up oturumlu meydan okumayla oturum yaratmadan geçer', async () => {
    const u = await user('stepup-passkey');
    const auth = softAuthenticator(DOMAIN, APP_URL);
    const opts = await call('/api/auth/passkey/generate-register-options', { cookie: u.cookie });
    const reg = await call('/api/auth/passkey/verify-registration', {
      body: { response: auth.register((await opts.json()) as { challenge: string }) },
      cookie: join2(u.cookie, cookieOf(opts, '__Host-eda.passkey_challenge')),
    });
    expect(reg.status).toBe(200);
    advance((CONFIG_DEFAULTS['auth.stepUpWindowMin'] + 1) * 60_000);
    const sessions = (await db.auth.sessionRows(u.uid)).length;
    const o = await call('/api/auth/passkey/generate-authenticate-options', { cookie: u.cookie });
    const s = await call('/api/v1/me/step-up', {
      body: {
        method: 'passkey',
        response: auth.authenticate((await o.json()) as { challenge: string }),
      },
      cookie: join2(u.cookie, cookieOf(o, '__Host-eda.passkey_challenge')),
    });
    expect(s.status).toBe(200);
    expect((await db.auth.sessionRows(u.uid)).length).toBe(sessions);
    // Step-up `mfa_level`ı yükseltmez (yalnız `step_up_at`); kayıt da yükseltmedi.
    expect((await db.auth.sessionRows(u.uid)).at(-1)?.mfaLevel).toBe('none');
  });

  it("yeni oturum açılışı step_up_at'i günceller", async () => {
    const u = await user('stepup-giris');
    advance(60 * 60_000);
    const r = await signIn(u.email);
    const at = (await db.auth.sessionRows(u.uid)).at(-1)?.stepUpAt;
    expect(r.status).toBe(200);
    expect(Math.abs((at?.getTime() ?? 0) - Date.now())).toBeLessThan(5_000);
  });
});

describe('KK-P04b-8 / KK-042-11 (Y-1): passkey ekleme step-up ister', () => {
  it('pencere dışında passkey kayıt uçları 403 AUTH_STEP_UP_REQUIRED; parola step-up sonrası kayıt geçer', async () => {
    const u = await user('y1-pencere');
    const auth = softAuthenticator(DOMAIN, APP_URL);
    advance((CONFIG_DEFAULTS['auth.stepUpWindowMin'] + 1) * 60_000);
    // Çalınmış çerez senaryosu: oturum çerezi tek başına yeni doğrulayıcı kaydedemez.
    const blockedOpts = await call('/api/auth/passkey/generate-register-options', {
      cookie: u.cookie,
    });
    expect(blockedOpts.status).toBe(403);
    expect((await errorOf(blockedOpts)).code).toBe('AUTH_STEP_UP_REQUIRED');
    const blockedReg = await call('/api/auth/passkey/verify-registration', {
      body: { response: {} },
      cookie: u.cookie,
    });
    expect(blockedReg.status).toBe(403);
    expect((await errorOf(blockedReg)).code).toBe('AUTH_STEP_UP_REQUIRED');
    expect(await db.auth.passkeyCount(u.uid)).toBe(0);
    const s = await call('/api/v1/me/step-up', {
      body: { method: 'password', password: PASSWORD },
      cookie: u.cookie,
    });
    expect(s.status).toBe(200);
    const opts = await call('/api/auth/passkey/generate-register-options', { cookie: u.cookie });
    expect(opts.status).toBe(200);
    const reg = await call('/api/auth/passkey/verify-registration', {
      body: { response: auth.register((await opts.json()) as { challenge: string }) },
      cookie: join2(u.cookie, cookieOf(opts, '__Host-eda.passkey_challenge')),
    });
    expect(reg.status).toBe(200);
    expect(await db.auth.passkeyCount(u.uid)).toBe(1);
  });

  it('ilk passkey kaydı serbest ama oturumu yükseltmez: büro MFA kapısı açılmaz, passkey ile girişte açılır', async () => {
    const f = await firm('y1-kapi');
    await setSession(f.owner.cookie, { mfaLevel: 'none', stepUpAt: new Date() });
    const auth = softAuthenticator(DOMAIN, APP_URL);
    const gated = () => call('/api/v1/org/members', { cookie: f.owner.cookie });
    expect((await errorOf(await gated())).code).toBe('AUTH_MFA_REQUIRED');
    const opts = await call('/api/auth/passkey/generate-register-options', {
      cookie: f.owner.cookie,
    });
    const reg = await call('/api/auth/passkey/verify-registration', {
      body: { response: auth.register((await opts.json()) as { challenge: string }) },
      cookie: join2(f.owner.cookie, cookieOf(opts, '__Host-eda.passkey_challenge')),
    });
    expect(reg.status).toBe(200);
    // Kayıttan sonra da kapı kapalı: yazılım doğrulayıcı kaydı MFA yerine geçmez.
    const still = await gated();
    expect(still.status).toBe(403);
    expect((await errorOf(still)).code).toBe('AUTH_MFA_REQUIRED');
    // Güçlü düzey yalnız passkey ile GİRİŞTE kazanılır.
    const o = await call('/api/auth/passkey/generate-authenticate-options');
    const login = await call('/api/auth/passkey/verify-authentication', {
      body: { response: auth.authenticate((await o.json()) as { challenge: string }) },
      cookie: cookieOf(o, '__Host-eda.passkey_challenge') ?? '',
    });
    expect(login.status).toBe(200);
    expect((await db.auth.sessionRows(f.owner.uid)).at(-1)?.mfaLevel).toBe('passkey');
  });
});

describe('KK-P04b-9 (KK-040-11): idempotency (POST /api/v1/org/invitations)', () => {
  it('aynı anahtar + gövde tek davet ve Idempotency-Replayed; farklı gövde 422; anahtarsız 422; işlemde 409', async () => {
    const f = await firm('idem');
    const key = idemKey();
    const e = mail('idem-aday');
    const first = await invite(f, e, 'assistant', key);
    expect(first.status).toBe(201);
    const second = await invite(f, e, 'assistant', key);
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(await second.json()).toEqual(await first.json());
    expect((await db.auth.invitationRows(f.org)).length).toBe(1);
    const reused = await invite(f, mail('idem-baska'), 'assistant', key);
    expect(reused.status).toBe(422);
    expect((await errorOf(reused)).code).toBe('VALIDATION_IDEMPOTENCY_KEY_REUSED');
    const none = await call('/api/v1/org/invitations', {
      body: { email: mail('idem-anahtarsiz'), role: 'assistant' },
      cookie: f.owner.cookie,
    });
    expect(none.status).toBe(422);
    expect((await errorOf(none)).reason).toBe('idempotency_key_required');
    // Eşzamanlı ikinci istek: aynı anahtar işlem sürerken 409 + Retry-After.
    const busyKey = idemKey();
    const busyBody = { email: mail('idem-mesgul'), role: 'assistant' };
    const sha = (v: string) => createHash('sha256').update(v).digest('hex');
    const sameRoute = await redis.set(
      `eda:idem:${f.org}:${f.owner.uid}:${sha(`${busyKey}-2`)}`,
      JSON.stringify({
        st: 'in_progress',
        route: 'POST /api/v1/org/invitations',
        rh: sha(JSON.stringify({ email: busyBody.email, role: 'assistant' })),
      }),
      'EX',
      60,
    );
    expect(sameRoute).toBe('OK');
    const busy2 = await call('/api/v1/org/invitations', {
      body: { email: busyBody.email, role: 'assistant' },
      cookie: f.owner.cookie,
      headers: { 'idempotency-key': `${busyKey}-2` },
    });
    expect(busy2.status).toBe(409);
    expect((await errorOf(busy2)).code).toBe('VALIDATION_IDEMPOTENCY_IN_PROGRESS');
    expect(busy2.headers.get('retry-after')).toBe('1');
    // Saklanan yanıt yalnız kimlik + durum + enum taşır.
    const stored = await redis.get(`eda:idem:${f.org}:${f.owner.uid}:${sha(key)}`);
    const body = (JSON.parse(stored ?? '{}') as { body: Record<string, unknown> }).body;
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'ref', 'role', 'status']);
    expect(stored).not.toContain(e);
  });
});

describe('KK-P04b-11 (KK-042-16): personel ve bayi üyeliği', () => {
  it('personel hesabı uygulama yüzeyinde oturum açamaz; bayi kullanıcısı daveti kabul edemez', async () => {
    const staff = await user('personel');
    await db.auth.setPlatformRole(staff.uid, 'support');
    const login = await signIn(staff.email);
    // D-8: doğru parolada bile yanlış parolayla aynı 401 (personel hesabı olduğu sızmaz).
    expect(login.status).toBe(401);
    expect(login.headers.getSetCookie()).toEqual([]);
    const f = await firm('bayi');
    // Üyeliği olmayan (davetle kayıt) kullanıcı bayi kullanıcısı yapılır.
    const pEmail = mail('bayi-kullanici');
    expect((await invite(f, pEmail)).status).toBe(201);
    const inv = await invitationId(f.org, pEmail);
    expect((await signUp(pEmail, { invitationToken: inv })).status).toBe(200);
    const pUid = await userId(pEmail);
    await db.auth.makePartnerUser(pUid, `T${KEY.toUpperCase()}`);
    const pCookie = sessionCookie(await signIn(pEmail));
    const acc = await call('/api/auth/organization/accept-invitation', {
      body: { invitationId: inv },
      cookie: pCookie,
    });
    expect(acc.status).toBe(403);
    expect(await db.auth.memberships(pUid)).toEqual([]);
    // Better Auth sunucu API'siyle doğrudan üye ekleme de reddedilir (beforeAddMember).
    const direct = await setup.identity.auth.api
      .addMember({
        body: { userId: staff.uid, organizationId: f.org, role: 'lawyer' } as never,
      })
      .catch((e: unknown) => e);
    expect(direct).toBeInstanceOf(Error);
  });
});

describe('KK-P04b-12 (KK-042-20): denetim olayları ve gizlilik', () => {
  it('org ve MFA akışları 042 §13 olaylarını yazar; davet denetiminde kimlik/e-posta yok', async () => {
    for (const a of [
      'org.member.invited',
      'org.member.joined',
      'org.member.role_changed',
      'org.member.suspended',
      'org.member.unsuspended',
      'org.member.removed',
      'auth.mfa.enrolled',
      'auth.mfa.removed',
      'auth.passkey.added',
      'auth.step_up',
    ]) {
      expect((await auditRows(a)).length, a).toBeGreaterThan(0);
    }
    for (const r of await auditRows('org.member.invited')) {
      expect(String(r.metadata.invitationRef)).toMatch(/^[0-9a-f]{12}$/);
      const text = JSON.stringify(r.metadata);
      for (const e of emails) expect(text).not.toContain(e);
    }
  });

  it('günlükte e-posta, davet kimliği, kod ve parola yok', () => {
    const log = logLines.join('\n');
    expect(log.length).toBeGreaterThan(0);
    for (const e of emails) expect(log).not.toContain(e);
    for (const s of secrets.filter((x) => x.length >= 6)) expect(log).not.toContain(s);
  });
});

describe("KK-P04b-14 (KK-042-14, KK-040-9): rol bilgisi çerezde yok; üyelik her istekte DB'den", () => {
  it('rol değişikliği bir sonraki istekte etkili; çerez adları ve öznitelikleri', async () => {
    const f = await firm('rolanlik');
    const l = await joinFirm(f, 'rolanlik-avukat', 'lawyer');
    await stepUpNow(f.owner.cookie);
    expect(
      (
        await call(`/api/v1/org/members/${l.memberId}`, {
          method: 'PATCH',
          body: { role: 'trainee' },
          cookie: f.owner.cookie,
        })
      ).status,
    ).toBe(200);
    const me = (await (await call('/api/v1/me', { cookie: l.cookie })).json()) as {
      activeOrg: { role: string };
    };
    expect(me.activeOrg.role).toBe('trainee');
    const allowed = new Set([
      '__Host-eda.session_token',
      '__Host-eda.dont_remember',
      '__Host-eda.session_data',
      '__Host-eda.two_factor',
      '__Host-eda.passkey_challenge',
    ]);
    expect(setCookies.length).toBeGreaterThan(0);
    for (const c of setCookies) {
      const name = c.split('=')[0] ?? '';
      expect(allowed.has(name), name).toBe(true);
      // Değer opak imzalı belirteçtir (JWT/JSON değil; rol veya izin taşımaz).
      const value = decodeURIComponent(c.slice(name.length + 1).split(';')[0] ?? '');
      expect(value.split('.').length, name).toBeLessThanOrEqual(2);
      // İlk parça opak tanımlayıcıdır (JSON/JWT gövdesi değil); ikinci parça imza.
      expect(value.split('.')[0] ?? '', name).toMatch(/^[A-Za-z0-9_-]*$/);
      const attrs = c
        .split(';')
        .slice(1)
        .map((x) => x.trim().toLowerCase());
      expect(attrs).toContain('secure');
      expect(attrs).toContain('httponly');
      expect(attrs).toContain('samesite=lax');
      expect(attrs).toContain('path=/');
      expect(attrs.some((x) => x.startsWith('domain='))).toBe(false);
    }
  });
});
