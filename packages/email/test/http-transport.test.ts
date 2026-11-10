// @tk TK-28
// KK-045-11 / KK-P04a-15: HTTP e-posta taşıması (Resend, Brevo) sahte node:http sunucusuna karşı.
// Ağa çıkılmaz. Sınananlar: istek biçimi, hata sınıfları (429/5xx geçici, 4xx kalıcı), zaman aşımı,
// çift yeniden deneme yokluğu, sırrın ve alıcının hata iletisine sızmaması.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createEmailTransport,
  createHttpEmailTransport,
  EmailTransportConfigError,
  EmailTransportError,
  providerFromApiUrl,
} from '../src/transport/index.ts';

const API_KEY = 'sentetik-anahtar-1234567890';
const FROM = 'E.D.A. Hukuk <bildirim@ornek.test>';
const msg = {
  to: 'alici@ornek.test',
  subject: 'Gizli konu',
  html: '<p>Gizli govde</p>',
  text: 'Gizli govde',
  headers: {
    'Reply-To': 'destek@ornek.test',
    'Message-ID': '<d1@ornek.test>',
    'X-Entity-Ref-ID': 'd1',
    'Auto-Submitted': 'auto-generated',
  },
};

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}
let server: Server;
let base: string;
let seen: Seen[];
let reply: (n: number) => { status: number; body?: string; delayMs?: number; location?: string };

beforeEach(async () => {
  seen = [];
  reply = () => ({ status: 200, body: '{}' });
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => {
      raw += c.toString('utf8');
    });
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      const r = reply(seen.length);
      const send = () => {
        res.writeHead(r.status, {
          'Content-Type': 'application/json',
          ...(r.location === undefined ? {} : { Location: r.location }),
        });
        res.end(r.body ?? '');
      };
      if (r.delayMs === undefined) send();
      else setTimeout(send, r.delayMs);
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((ok) => server.close(() => ok()));
});

const make = (provider: 'resend' | 'brevo', timeoutMs = 2000) =>
  createHttpEmailTransport({ baseUrl: base, apiKey: API_KEY, from: FROM, timeoutMs }, provider);

async function failure(p: Promise<unknown>): Promise<EmailTransportError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(EmailTransportError);
    return err as EmailTransportError;
  }
  throw new Error('hata bekleniyordu');
}

describe('KK-045-11: Resend taşıması', () => {
  it('POST /emails, Bearer, gövde şeması; yalnız ileti kimliği döner', async () => {
    reply = () => ({ status: 200, body: JSON.stringify({ id: 'resend-id-1' }) });
    const out = await make('resend').send(msg);
    expect(out).toEqual({ providerMessageId: 'resend-id-1' });
    expect(seen).toHaveLength(1);
    const s = seen[0] as Seen;
    expect(s.method).toBe('POST');
    expect(s.url).toBe('/emails');
    expect(s.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(s.headers['idempotency-key']).toBe('d1');
    expect(s.headers['content-type']).toBe('application/json');
    expect(s.body).toEqual({
      from: FROM,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      reply_to: 'destek@ornek.test',
      headers: {
        'Message-ID': '<d1@ornek.test>',
        'X-Entity-Ref-ID': 'd1',
        'Auto-Submitted': 'auto-generated',
      },
    });
  });

  it('yanıtta kimlik yoksa Message-ID başlığı kullanılır', async () => {
    const out = await make('resend').send(msg);
    expect(out.providerMessageId).toBe('<d1@ornek.test>');
  });

  it('doğrulanmamış gönderen alan adı sender_unverified olur', async () => {
    reply = () => ({
      status: 403,
      body: JSON.stringify({
        name: 'validation_error',
        message: 'The ornek.test domain is not verified.',
      }),
    });
    expect((await failure(make('resend').send(msg))).code).toBe('sender_unverified');
  });
});

describe('KK-045-11: Brevo taşıması', () => {
  it('POST /v3/smtp/email, api-key başlığı, gövde şeması', async () => {
    reply = () => ({ status: 201, body: JSON.stringify({ messageId: '<brevo-1@smtp>' }) });
    const out = await make('brevo').send(msg);
    expect(out).toEqual({ providerMessageId: '<brevo-1@smtp>' });
    const s = seen[0] as Seen;
    expect(s.url).toBe('/v3/smtp/email');
    expect(s.headers['api-key']).toBe(API_KEY);
    expect(s.headers.authorization).toBeUndefined();
    expect(s.body).toEqual({
      sender: { name: 'E.D.A. Hukuk', email: 'bildirim@ornek.test' },
      to: [{ email: msg.to }],
      subject: msg.subject,
      htmlContent: msg.html,
      textContent: msg.text,
      replyTo: { email: 'destek@ornek.test' },
      headers: {
        'Message-ID': '<d1@ornek.test>',
        'X-Entity-Ref-ID': 'd1',
        'Auto-Submitted': 'auto-generated',
      },
    });
  });

  it('401 provider_auth', async () => {
    reply = () => ({ status: 401, body: '{"message":"Key not found"}' });
    expect((await failure(make('brevo').send(msg))).code).toBe('provider_auth');
  });
});

describe('KK-045-11: hata sınıfları (her iki sağlayıcı)', () => {
  const cases: Array<[number, string]> = [
    [429, 'provider_rate_limited'],
    [500, 'provider_unavailable'],
    [503, 'provider_unavailable'],
    [401, 'provider_auth'],
    [422, 'recipient_rejected'],
    [400, 'recipient_rejected'],
    [413, 'message_too_large'],
    [404, 'payload_invalid'],
  ];
  for (const provider of ['resend', 'brevo'] as const) {
    for (const [status, code] of cases) {
      it(`${provider}: ${status} -> ${code}; taşıma içinde yeniden deneme yok`, async () => {
        reply = () => ({ status, body: '{"message":"ayrinti"}' });
        const err = await failure(make(provider).send(msg));
        expect(err.code).toBe(code);
        expect(seen).toHaveLength(1);
      });
    }
  }

  it('zaman aşımı timeout olur', async () => {
    reply = () => ({ status: 200, body: '{}', delayMs: 400 });
    const err = await failure(make('resend', 50).send(msg));
    expect(err.code).toBe('timeout');
    expect(seen).toHaveLength(1);
  });

  it('bağlantı hatası provider_unavailable olur', async () => {
    const t = createHttpEmailTransport(
      { baseUrl: 'http://127.0.0.1:1', apiKey: API_KEY, from: FROM, timeoutMs: 1000 },
      'resend',
    );
    expect((await failure(t.send(msg))).code).toBe('provider_unavailable');
  });

  it('yönlendirme izlenmez (anahtar başka ana bilgisayara gitmez)', async () => {
    reply = () => ({ status: 302, location: 'http://127.0.0.1:1/x' });
    expect((await failure(make('resend').send(msg))).code).toBe('provider_unavailable');
    expect(seen).toHaveLength(1);
  });

  it('satır sonu içeren değer sağlayıcıya gitmeden reddedilir', async () => {
    const err = await failure(make('resend').send({ ...msg, subject: 'a\r\nBcc: x@ornek.test' }));
    expect(err.code).toBe('payload_invalid');
    expect(seen).toHaveLength(0);
  });

  it('hata iletisi ve alanları API anahtarını, alıcıyı, konuyu ve gövdeyi taşımaz', async () => {
    const leaks = [API_KEY, msg.to, msg.subject, 'Gizli govde'];
    for (const provider of ['resend', 'brevo'] as const) {
      for (const status of [400, 401, 429, 500]) {
        reply = () => ({ status, body: JSON.stringify({ echo: leaks }) });
        const err = await failure(make(provider).send(msg));
        const dump = JSON.stringify({ m: err.message, s: err.stack, c: err.cause, o: { ...err } });
        for (const l of leaks) expect(dump).not.toContain(l);
      }
    }
    const down = createHttpEmailTransport(
      { baseUrl: 'http://127.0.0.1:1', apiKey: API_KEY, from: FROM, timeoutMs: 500 },
      'resend',
    );
    const err = await failure(down.send(msg));
    expect(`${err.message}${err.stack}${String(err.cause)}`).not.toContain(API_KEY);
    expect(`${err.message}${err.stack}`).not.toContain(msg.to);
  });
});

describe('KK-045-15: HTTP taşıma seçimi', () => {
  it('adaptör EMAIL_API_URL ana bilgisayarına göre seçilir', () => {
    expect(providerFromApiUrl('https://api.resend.com')).toBe('resend');
    expect(providerFromApiUrl('https://api.brevo.com/')).toBe('brevo');
    expect(() => providerFromApiUrl('https://baska.ornek.test')).toThrow(EmailTransportConfigError);
    expect(() => providerFromApiUrl('degil')).toThrow(EmailTransportConfigError);
  });

  it('production, beta-synthetic ve staging ortamında http kurulur; anahtar/adres eksikse hata', () => {
    for (const edaEnv of ['production', 'beta-synthetic', 'staging']) {
      const cfg = { edaEnv, transport: 'http' as const, from: FROM, timeoutMs: 1000 };
      expect(() => createEmailTransport(cfg)).toThrow(EmailTransportConfigError);
      expect(() => createEmailTransport({ ...cfg, apiUrl: 'https://api.resend.com' })).toThrow(
        EmailTransportConfigError,
      );
      expect(() =>
        createEmailTransport({ ...cfg, apiUrl: 'https://api.resend.com', apiKey: '' }),
      ).toThrow(EmailTransportConfigError);
      const t = createEmailTransport({
        ...cfg,
        apiUrl: 'https://api.brevo.com',
        apiKey: API_KEY,
      });
      t.close();
    }
  });
});
