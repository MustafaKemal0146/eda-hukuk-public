// @tk TK-28
// Gerçek PG + Valkey + Mailpit (`pnpm --filter @eda/worker test:int`; TEST yığını):
// KK-P04a-12 (KK-045-4): aynı dedupe_key iki kez -> tek satır ve Mailpit'te tek ileti.
// KK-P04a-13 (KK-045-3): ileti multipart/alternative, ek yok; Message-ID ve X-Entity-Ref-ID teslimat
// kimliği. KK-P04a-11 (KK-045-5): belirteç params, BullMQ yükü ve Valkey değerlerinde düz metin değil;
// gönderim sonrası sealed_params NULL; kimlik şablonunda removeOnComplete: true.
// KK-P04a-14 (KK-045-10): doğrulanmamış alıcıya password_changed gitmez.
// KK-P04a-15 (KK-045-15): development/test'te smtp + Mailpit çalışır; ileti Mailpit API'sinde görünür.
// KK-P04b-2 (KK-042-7, 045 §7.3): davet e-postası davet edenin satırından davet adresine gider,
// tek düğme + aynı bağlantının metni (`/davet/<kimlik>`); davet artık beklemiyorsa gönderilmez.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emailJobOptions } from '@eda/contracts/notifications';
import { BULLMQ_PREFIX } from '@eda/contracts/queues';
import { parseKekFile, sealJobParams } from '@eda/crypto';
import { enqueueEmailRow } from '@eda/db/email';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createEmailTransport, type EmailTransport } from '@eda/email/transport';
import { createLogger } from '@eda/observability/logger';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Metrics } from '../../src/metrics.ts';
import {
  type EmailSendDeps,
  processEmailSend,
} from '../../src/processors/notifications/email-send.ts';
import { createValkey } from '../../src/valkey.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: { host: string; port: number; database: string; secretsDir: string };
    mailpit: { smtpUrl: string; apiUrl: string };
  }
}

const APP_DOMAIN = 'ornek.test';
const TOKEN = `belirtec-${randomUUID().replaceAll('-', '')}`;
let db: TestingDb;
let transport: EmailTransport;
let kek: Buffer;
let redis: Redis;
let deps: EmailSendDeps;
const logLines: string[] = [];

async function mailpit<T>(path: string): Promise<T> {
  const res = await fetch(`${inject('mailpit').apiUrl}${path}`);
  if (!res.ok) throw new Error(`mailpit ${path}: ${res.status}`);
  return (await res.json()) as T;
}

type Summary = { ID: string };
async function messagesTo(address: string): Promise<Summary[]> {
  const r = await mailpit<{ messages: Summary[] }>(
    `/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  return r.messages;
}

async function newUser(verified: boolean): Promise<{ id: string; email: string }> {
  const email = `alici.${randomUUID().slice(0, 12)}@${APP_DOMAIN}`;
  const id = await db.auth.insertUser({ name: 'Örnek Alıcı', email, emailVerified: verified });
  return { id, email };
}

beforeAll(async () => {
  const pg = inject('pg');
  db = createTestingDb(pg);
  kek = parseKekFile(readFileSync(join(pg.secretsDir, 'kek_master'), 'utf8')).kek;
  transport = createEmailTransport({
    edaEnv: 'test',
    transport: 'smtp',
    smtpUrl: inject('mailpit').smtpUrl,
    from: `E.D.A. Hukuk <bildirim@${APP_DOMAIN}>`,
    timeoutMs: 10_000,
  });
  const v = inject('valkey');
  redis = createValkey(
    { VALKEY_URL: v.url, VALKEY_USERNAME: v.username, VALKEY_PASSWORD_FILE: v.passwordFile },
    'eda-worker-it',
  );
  await redis.connect();
  const worker = db.runner('eda_worker');
  deps = {
    db: worker,
    kek,
    transport,
    rate: { hit: async () => 1 },
    logger: createLogger({ service: 'it', destination: { write: (l) => logLines.push(l) } }),
    metrics: new Metrics(),
    appUrl: 'https://app.ornek.test',
    appDomain: APP_DOMAIN,
    companyName: null,
  };
});

afterAll(async () => {
  transport?.close();
  await redis?.quit();
  await db?.close();
});

interface EnqueueOpts {
  readonly template?: 'verify_email' | 'password_changed';
  readonly dedupeKey?: string;
  readonly token?: string | null;
}

/** Üretim sözleşmesi: kimlik önceden üretilir, belirteç bu kimlikle mühürlenir (045 §6.2 madde 3). */
async function enqueue(userId: string, o: EnqueueOpts = {}): Promise<string | null> {
  const template = o.template ?? 'verify_email';
  const id = randomUUID();
  const token = o.token === undefined ? TOKEN : o.token;
  const sealed =
    token === null ? null : sealJobParams(kek, { deliveryId: id, template, userId }, { token });
  return db.runner('eda_worker').withUserScope({ userId }, (tx) =>
    enqueueEmailRow(tx, {
      id,
      kind: template === 'verify_email' ? 'email_verification' : 'password_changed',
      template,
      templateVersion: '2026-10-11.1',
      class: template === 'verify_email' ? 'action' : 'security',
      userId,
      orgId: null,
      invitationId: null,
      dedupeKey: o.dedupeKey ?? `it:${randomUUID()}`,
      params:
        template === 'verify_email'
          ? { expiresInMin: 60 }
          : { changedAt: new Date().toISOString() },
      sealed,
      expiresAt: new Date(Date.now() + 3_600_000),
    }),
  );
}

type Message = {
  ID: string;
  MessageID: string;
  To: { Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
  Attachments: unknown[];
  Inline: unknown[];
};

describe('KK-P04a-15, KK-P04a-13, KK-P04a-12: Mailpit üzerinden gerçek gönderim', () => {
  it('verify_email: alıcı, konu, metin + HTML, ek yok, Message-ID / X-Entity-Ref-ID; dedupe tek ileti', async () => {
    const u = await newUser(false);
    const dedupeKey = `verify_email:${u.id}:${Math.floor(Date.now() / 60_000)}`;
    const id = await enqueue(u.id, { dedupeKey });
    const dup = await enqueue(u.id, { dedupeKey });
    expect(id).not.toBeNull();
    expect(dup).toBeNull();
    if (id === null) throw new Error('kayıt yok');
    expect(await processEmailSend({ deliveryId: id, lastAttempt: false }, deps)).toEqual({
      status: 'sent',
    });
    // İkinci çalıştırma yan etkisizdir (nihai durum).
    expect(await processEmailSend({ deliveryId: id, lastAttempt: false }, deps)).toEqual({
      status: 'skipped',
      reason: 'final',
    });
    const list = await messagesTo(u.email);
    expect(list).toHaveLength(1);
    const m = await mailpit<Message>(`/api/v1/message/${list[0]?.ID}`);
    expect(m.To.map((t) => t.Address)).toEqual([u.email]);
    expect(m.Subject).toBe('E-posta adresinizi doğrulayın');
    expect(m.MessageID).toBe(`${id}@${APP_DOMAIN}`);
    expect(m.Text).toContain(`https://app.ornek.test/eposta-dogrulama#token=${TOKEN}`);
    expect(m.HTML).toContain('lang="tr"');
    expect(m.Attachments).toEqual([]);
    expect(m.Inline).toEqual([]);
    const headers = await mailpit<Record<string, string[]>>(
      `/api/v1/message/${list[0]?.ID}/headers`,
    );
    expect(headers['X-Entity-Ref-Id'] ?? headers['X-Entity-Ref-ID']).toEqual([id]);
    expect(headers['Auto-Submitted']).toEqual(['auto-generated']);
    expect(headers['Content-Type']?.[0] ?? '').toMatch(/multipart\/alternative/);
  });

  it('KK-P04a-11: gönderim sonrası sealed_params NULL; params ve günlükte belirteç yok', async () => {
    const u = await newUser(true);
    const id = await enqueue(u.id);
    if (id === null) throw new Error('kayıt yok');
    await processEmailSend({ deliveryId: id, lastAttempt: false }, deps);
    const row = await db
      .runner('eda_worker')
      .withUserScope({ userId: u.id }, (tx) =>
        tx.query<{ status: string; sealed_params: Buffer | null; params: unknown }>(
          'SELECT status, sealed_params, params FROM app.email_deliveries WHERE id = $1',
          [id],
        ),
      );
    expect(row.rows[0]?.status).toBe('sent');
    expect(row.rows[0]?.sealed_params).toBeNull();
    expect(JSON.stringify(row.rows[0]?.params)).not.toContain(TOKEN);
    expect(logLines.join('\n')).not.toContain(TOKEN);
    expect(logLines.join('\n')).not.toContain(u.email);
  });

  it('KK-P04a-11 (KK-042-21): BullMQ yükü yalnız { v, deliveryId }; Valkey değerlerinde belirteç yok', async () => {
    const prefix = `${BULLMQ_PREFIX}:it-${randomUUID().slice(0, 8)}`;
    const q = new Queue('notifications', { connection: redis, prefix });
    try {
      const deliveryId = randomUUID();
      const opts = emailJobOptions(deliveryId, 'action', 'verify_email');
      expect(opts.removeOnComplete).toBe(true);
      await q.add('email.send', { v: 1, deliveryId }, opts);
      const job = await q.getJob(deliveryId);
      expect(job?.data).toEqual({ v: 1, deliveryId });
      let cursor = '0';
      const keys: string[] = [];
      do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== '0');
      for (const k of keys) {
        const type = await redis.type(k);
        const dump =
          type === 'hash'
            ? JSON.stringify(await redis.hgetall(k))
            : type === 'string'
              ? ((await redis.get(k)) ?? '')
              : '';
        expect(dump).not.toContain(TOKEN);
        expect(dump).not.toContain('@');
      }
    } finally {
      await q.obliterate({ force: true }).catch(() => undefined);
      await q.close();
    }
  });

  it('KK-P04a-14: doğrulanmamış alıcıya password_changed gitmez (suppressed unverified)', async () => {
    const u = await newUser(false);
    const id = await enqueue(u.id, { template: 'password_changed', token: null });
    if (id === null) throw new Error('kayıt yok');
    expect(await processEmailSend({ deliveryId: id, lastAttempt: false }, deps)).toEqual({
      status: 'suppressed',
      reason: 'unverified',
    });
    expect(await messagesTo(u.email)).toHaveLength(0);
  });
});

describe('KK-P04b-2 (KK-042-7): davet e-postası', () => {
  async function invitationDelivery(inviter: string, invitationId: string): Promise<string> {
    const id = randomUUID();
    const sealed = sealJobParams(
      kek,
      { deliveryId: id, template: 'invitation', userId: inviter },
      { token: invitationId },
    );
    const out = await db.runner('eda_worker').withUserScope({ userId: inviter }, (tx) =>
      enqueueEmailRow(tx, {
        id,
        kind: 'invitation',
        template: 'invitation',
        templateVersion: '2026-10-11.1',
        class: 'action',
        userId: inviter,
        orgId: null,
        invitationId,
        dedupeKey: `it:${randomUUID()}`,
        params: { role: 'lawyer', expiresInHours: 72 },
        sealed,
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    );
    if (out === null) throw new Error('kayıt yok');
    return out;
  }

  it('davet adresine tek düğme + metin bağlantısı; bekleyen olmayan davet suppressed', async () => {
    const inviter = await newUser(true);
    const org = await db.auth.insertOrg('Örnek Davet Bürosu', 'firm');
    await db.auth.addMember(org, inviter.id, 'owner');
    const target = `davetli.${randomUUID().slice(0, 12)}@${APP_DOMAIN}`;
    const inv = await db.auth.insertInvitation(org, target, 'lawyer', inviter.id);
    const id = await invitationDelivery(inviter.id, inv);
    expect(await processEmailSend({ deliveryId: id, lastAttempt: false }, deps)).toEqual({
      status: 'sent',
    });
    const list = await messagesTo(target);
    expect(list).toHaveLength(1);
    expect(await messagesTo(inviter.email)).toHaveLength(0);
    const m = await mailpit<Message>(`/api/v1/message/${list[0]?.ID}`);
    const link = `https://app.ornek.test/davet/${inv}`;
    expect(m.Text).toContain(link);
    // 045 §7.3: bir düğme + aynı bağlantının metin hâli; başka bağlantı yok.
    const hrefs = [...m.HTML.matchAll(/href="([^"]*)"/g)].map((x) => x[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(new Set(hrefs)).toEqual(new Set([link]));
    expect(logLines.join('\n')).not.toContain(inv);
    expect(logLines.join('\n')).not.toContain(target);
    const canceled = await db.auth.insertInvitation(org, `iptal.${target}`, 'lawyer', inviter.id);
    await db.auth.setInvitationStatus(canceled, 'canceled');
    const id2 = await invitationDelivery(inviter.id, canceled);
    expect(await processEmailSend({ deliveryId: id2, lastAttempt: false }, deps)).toEqual({
      status: 'suppressed',
      reason: 'no_recipient',
    });
  });
});
