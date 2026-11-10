// @tk TK-28
// KK-P04a-14 (KK-045-10): doğrulanmamış alıcıya `password_changed` gitmez (`suppressed`, `unverified`);
// yasaklı alıcıya yalnız `account_suspended` gider. KK-P04a-11: süresi geçen satır gönderilmez ve
// `expired` olur; iş yükü yalnız `{ v, deliveryId }`. Geçici hata yeniden denenir, kalıcı hata
// (`recipient_rejected`) denenmez; son denemede `failed`. Hız sınırı ertelemesi deneme tüketmez.
// Günlükte alıcı adresi, ad ve belirteç yoktur. Sahte DB/taşıma; ağsız.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { sealJobParams } from '@eda/crypto';
import type { DeliveryRow, DeliveryUpdate } from '@eda/db/email';
import {
  type EmailMessage,
  EmailTransportConfigError,
  EmailTransportError,
} from '@eda/email/transport';
import { createLogger } from '@eda/observability/logger';
import { DelayedError, UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { Metrics } from '../src/metrics.ts';
import { createNotificationsHandler, startNotificationsWorker } from '../src/notifications.ts';
import {
  EmailRetryableError,
  type EmailSendDeps,
  processEmailSend,
} from '../src/processors/notifications/email-send.ts';

const USER = '0198d2a4-0000-7000-8000-0000000000a1';
const DELIVERY = '0198d2a4-0000-7000-8000-0000000000d1';
const KEK = Buffer.alloc(32, 9);
const TOKEN = 'gizli-belirtec-0123456789abcdefgh';
const NOW = new Date('2026-10-11T08:00:00Z');

type Recipient = { email: string; name: string; emailVerified: boolean; banned: boolean };

function world(over: Partial<DeliveryRow> = {}, rcpt: Partial<Recipient> = {}) {
  const row: DeliveryRow = {
    id: DELIVERY,
    orgId: null,
    userId: USER,
    invitationId: null,
    kind: 'password_changed',
    templateCode: 'password_changed',
    templateVersion: '2026-10-11.1',
    class: 'security',
    params: { changedAt: '2026-10-11T07:59:00Z' },
    sealedParams: null,
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    status: 'queued',
    attempts: 0,
    ...over,
  };
  const recipient: Recipient = {
    email: 'alici@ornek.test',
    name: 'Örnek Alıcı',
    emailVerified: true,
    banned: false,
    ...rcpt,
  };
  const updates: DeliveryUpdate[] = [];
  const sent: EmailMessage[] = [];
  const lines: string[] = [];
  let sendImpl: (m: EmailMessage) => Promise<{ providerMessageId: string }> = async (m) => {
    sent.push(m);
    return { providerMessageId: 'mp-1' };
  };
  // Sahte tx: lockDelivery / getEmailRecipient / updateDelivery SQL'lerini taklit eder.
  const tx = {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM app.email_delivery_route')) {
        return { rows: [{ user_id: row.userId, org_id: row.orgId }] };
      }
      if (sql.includes('FROM app.email_deliveries WHERE id = $1 FOR UPDATE')) {
        return {
          rows: [
            {
              id: row.id,
              org_id: row.orgId,
              user_id: row.userId,
              invitation_id: null,
              kind: row.kind,
              template_code: row.templateCode,
              template_version: row.templateVersion,
              class: row.class,
              params: row.params,
              sealed_params: row.sealedParams,
              expires_at: row.expiresAt,
              status: row.status,
              attempts: row.attempts,
            },
          ],
        };
      }
      // Alıcı okuması (`getEmailRecipient`).
      if (sql.includes('SELECT email, name, email_verified, banned')) {
        return {
          rows: [
            {
              email: recipient.email,
              name: recipient.name,
              email_verified: recipient.emailVerified,
              banned: recipient.banned,
            },
          ],
        };
      }
      if (sql.startsWith('UPDATE app.email_deliveries')) {
        const status = /status = '(\w+)'/.exec(sql)?.[1] ?? String(values[1]);
        updates.push({ status, errorCode: (values[1] ?? values[2] ?? null) as string } as never);
        (row as { status: string }).status = status;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`beklenmeyen sorgu: ${sql}`);
    },
  };
  let hits = 0;
  const deps: EmailSendDeps = {
    db: {
      withNoTenant: (_r, fn) => fn(tx as never),
      withUserScope: (_c, fn) => fn(tx as never),
    },
    kek: KEK,
    transport: { send: (m) => sendImpl(m), close: () => undefined },
    rate: { hit: async () => ++hits },
    logger: createLogger({
      service: 't',
      level: 'debug',
      destination: { write: (l) => lines.push(l) },
    }),
    metrics: new Metrics(),
    appUrl: 'https://app.ornek.test',
    appDomain: 'ornek.test',
    companyName: null,
    now: () => NOW,
  };
  return {
    row,
    deps,
    updates,
    sent,
    lines,
    setSend: (f: typeof sendImpl) => {
      sendImpl = f;
    },
    setHits: (n: number) => {
      hits = n;
    },
  };
}

const job = { deliveryId: DELIVERY, lastAttempt: false };

describe('KK-P04a-14 (KK-045-10): alıcı kuralları', () => {
  it('doğrulanmamış alıcıya password_changed gitmez: suppressed unverified', async () => {
    const w = world({}, { emailVerified: false });
    expect(await processEmailSend(job, w.deps)).toEqual({
      status: 'suppressed',
      reason: 'unverified',
    });
    expect(w.sent).toHaveLength(0);
    expect(w.row.status).toBe('suppressed');
  });

  it('doğrulanmamış alıcıya verify_email gider', async () => {
    const sealed = sealJobParams(
      KEK,
      { deliveryId: DELIVERY, template: 'verify_email', userId: USER },
      { token: TOKEN },
    );
    const w = world(
      {
        templateCode: 'verify_email',
        kind: 'email_verification',
        class: 'action',
        params: { expiresInMin: 60 },
        sealedParams: sealed,
      },
      { emailVerified: false },
    );
    expect(await processEmailSend(job, w.deps)).toEqual({ status: 'sent' });
    expect(w.sent[0]?.text).toContain(`#token=${TOKEN}`);
    expect(w.sent[0]?.headers).toMatchObject({
      'Message-ID': `<${DELIVERY}@ornek.test>`,
      'X-Entity-Ref-ID': DELIVERY,
      'Auto-Submitted': 'auto-generated',
      'Reply-To': 'destek@ornek.test',
    });
  });

  it('yasaklı alıcıya yalnız account_suspended gider; diğerleri suppressed banned', async () => {
    const w = world({}, { banned: true });
    expect(await processEmailSend(job, w.deps)).toEqual({ status: 'suppressed', reason: 'banned' });
  });
});

describe('KK-P04a-11: süre aşımı, mühür ve sızıntı', () => {
  it('expires_at geçmiş satır gönderilmez ve expired olur', async () => {
    const w = world({ expiresAt: new Date(NOW.getTime() - 1) });
    expect(await processEmailSend(job, w.deps)).toEqual({ status: 'expired' });
    expect(w.sent).toHaveLength(0);
    expect(w.row.status).toBe('expired');
  });

  it('günlükte alıcı adresi, ad ve belirteç yoktur', async () => {
    const sealed = sealJobParams(
      KEK,
      { deliveryId: DELIVERY, template: 'password_reset', userId: USER },
      { token: TOKEN },
    );
    const w = world({
      templateCode: 'password_reset',
      kind: 'password_reset',
      class: 'action',
      params: { expiresInMin: 60 },
      sealedParams: sealed,
    });
    await processEmailSend(job, w.deps);
    const log = w.lines.join('\n');
    expect(log).toContain('email.sent');
    expect(log).not.toContain('alici@ornek.test');
    expect(log).not.toContain('Örnek Alıcı');
    expect(log).not.toContain(TOKEN);
  });

  it('bozuk mühür kalıcı hatadır (payload_invalid), gönderim yapılmaz', async () => {
    const w = world({
      templateCode: 'verify_email',
      kind: 'email_verification',
      class: 'action',
      params: { expiresInMin: 60 },
      sealedParams: Buffer.alloc(40, 1),
    });
    expect(await processEmailSend(job, w.deps)).toEqual({
      status: 'failed',
      code: 'payload_invalid',
    });
    expect(w.sent).toHaveLength(0);
  });
});

describe('045 §6.6: hata sınıfları ve hız sınırı', () => {
  it('geçici hata queued + yeniden deneme; son denemede failed', async () => {
    const w = world();
    w.setSend(async () => {
      throw new EmailTransportError('provider_unavailable');
    });
    await expect(processEmailSend(job, w.deps)).rejects.toBeInstanceOf(EmailRetryableError);
    expect(w.row.status).toBe('queued');
    expect(await processEmailSend({ ...job, lastAttempt: true }, w.deps)).toEqual({
      status: 'failed',
      code: 'provider_unavailable',
    });
  });

  it('recipient_rejected kalıcıdır: yeniden denenmez', async () => {
    const w = world();
    w.setSend(async () => {
      throw new EmailTransportError('recipient_rejected');
    });
    expect(await processEmailSend(job, w.deps)).toEqual({
      status: 'failed',
      code: 'recipient_rejected',
    });
  });

  it('action/service sınıfında saatlik adres sınırı aşılırsa ertelenir (deneme sayılmaz)', async () => {
    const w = world({
      templateCode: 'lawyer_application_received',
      kind: 'lawyer_application_received',
      class: 'service',
      params: { slaBusinessHours: 4 },
    });
    w.setHits(CONFIG_DEFAULTS['notifications.emailPerAddressPerHour']);
    const out = await processEmailSend(job, w.deps);
    expect(out.status).toBe('deferred');
    expect(w.sent).toHaveLength(0);
    expect(w.row.status).toBe('queued');
  });

  it('işleyici: ertelemede moveToDelayed + DelayedError; geçersiz yük ve bilinmeyen iş kalıcı', async () => {
    const w = world({
      templateCode: 'lawyer_application_received',
      kind: 'lawyer_application_received',
      class: 'service',
      params: { slaBusinessHours: 4 },
    });
    w.setHits(CONFIG_DEFAULTS['notifications.emailPerAddressPerHour']);
    const handler = createNotificationsHandler(w.deps);
    let delayedTo = 0;
    const base = {
      name: 'email.send',
      data: { v: 1, deliveryId: DELIVERY },
      attemptsMade: 0,
      opts: { attempts: 5 },
      moveToDelayed: async (ts: number) => {
        delayedTo = ts;
      },
    };
    await expect(handler(base, 'tok')).rejects.toBeInstanceOf(DelayedError);
    expect(delayedTo).toBeGreaterThan(NOW.getTime());
    await expect(
      handler({ ...base, data: { v: 1, deliveryId: DELIVERY, token: TOKEN } }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(handler({ ...base, name: 'push.send' })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});

describe('KK-P04a-15 (KK-045-15): production ortamında smtp ile worker başlamaz', () => {
  it('startNotificationsWorker sır okumadan EmailTransportConfigError fırlatır (main çıkış kodu 1)', () => {
    const env = {
      EDA_ENV: 'production',
      EMAIL_TRANSPORT: 'smtp',
      SMTP_URL: 'smtp://mailpit:1025',
      EMAIL_FROM: 'E.D.A. Hukuk <bildirim@ornek.test>',
      KEK_MASTER_FILE: '/olmayan/kek_master',
      APP_URL: 'https://app.ornek.test',
    };
    const logger = createLogger({ service: 't', destination: { write: () => undefined } });
    expect(() =>
      startNotificationsWorker(env as never, {} as never, logger, new Metrics()),
    ).toThrow(EmailTransportConfigError);
  });
});
