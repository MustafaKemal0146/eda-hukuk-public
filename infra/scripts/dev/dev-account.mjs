// Geliştirme hesabı kurar (yalnız dev yığını): kayıt -> e-posta doğrulama (Mailpit) -> meslek başvurusu
// -> `approve-user` -> isteğe bağlı TOTP kurulumu. Parola ortam değişkeninden (DEV_ACCOUNT_PASSWORD)
// okunur; komut satırına yazılmaz. Kullanım: make dev-account EMAIL=<e-posta> [TOTP=1]
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const BASE = process.env.DEV_APP_URL ?? 'https://app.eda.localhost:8443';
const MAILPIT = process.env.DEV_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const email = process.env.DEV_ACCOUNT_EMAIL;
const password = process.env.DEV_ACCOUNT_PASSWORD;
const wantTotp = process.env.DEV_ACCOUNT_TOTP === '1';
if (!email || !password) {
  console.error('dev-account: DEV_ACCOUNT_EMAIL ve DEV_ACCOUNT_PASSWORD gerekli');
  process.exit(2);
}
if (!BASE.includes('.localhost')) {
  console.error('dev-account: yalnız *.localhost dev adresinde çalışır');
  process.exit(2);
}
// Dev CA yerel olarak güvenilmez; yalnız bu süreç ve yalnız .localhost için.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let cookies = '';
async function call(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      origin: BASE,
      cookie: cookies,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length > 0) {
    const jar = new Map(
      cookies
        .split('; ')
        .filter(Boolean)
        .map((c) => [c.split('=')[0], c]),
    );
    for (const c of set) {
      const kv = c.split(';')[0];
      if (/Max-Age=0/i.test(c)) jar.delete(kv.split('=')[0]);
      else jar.set(kv.split('=')[0], kv);
    }
    cookies = [...jar.values()].join('; ');
  }
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}
  return raw ? { res, json, text } : { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b32 = (s) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/\s|=/g, '').toUpperCase())
    bits += A.indexOf(c).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
};
const totp = (secret, t = Date.now()) => {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', b32(secret)).update(c).digest();
  const o = h[19] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
};

// 1) kayıt (var olan hesapta yanıt aynıdır)
const su = await call('/api/auth/sign-up/email', {
  method: 'POST',
  body: { name: 'Dev Avukat', email, password, acceptTerms: true, acknowledgePrivacy: true },
});
if (su.status !== 200) {
  console.error('kayıt başarısız', su.status, su.json?.code ?? '');
  process.exit(1);
}
// 2) doğrulama e-postası
let token = null;
for (let i = 0; i < 15 && token === null; i++) {
  await sleep(1000);
  const list = await (
    await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
  ).json();
  for (const m of list.messages ?? []) {
    const d = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
    const hit = /token=([A-Za-z0-9._-]+)/.exec(`${d.Text ?? ''}${d.HTML ?? ''}`);
    if (hit) {
      token = hit[1];
      break;
    }
  }
}
if (token) {
  const v = await call(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
  console.log('e-posta doğrulama', v.status);
} else console.log('doğrulama e-postası yok (hesap önceden doğrulanmış olabilir)');

// 3) giriş + meslek başvurusu + onay
let si = await call('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });
if (si.json?.twoFactorRedirect) {
  console.log('hesapta iki adımlı doğrulama zaten etkin; başvuru/onay adımları atlandı');
  process.exit(0);
}
// (baro, sicil) benzersizdir: e-postadan türetilen sentetik sicil.
const sicil = String(
  parseInt(crypto.createHash('sha1').update(email).digest('hex').slice(0, 8), 16) % 1e8,
).padStart(8, '0');
const app = await call('/api/v1/me/lawyer-application', {
  method: 'POST',
  body: { kind: 'lawyer', baro: 'Ankara Barosu', sicilNo: sicil, declareProfession: true },
});
console.log('meslek başvurusu', app.status);
try {
  const out = execFileSync(
    'infra/scripts/dev/dc.sh',
    ['dev', 'exec', '-T', 'api', 'node', 'dist/cli.js', 'approve-user', '--email', email],
    { encoding: 'utf8' },
  );
  console.log(out.trim().split('\n').at(-1));
} catch (e) {
  console.log(
    'approve-user:',
    String(e.stderr ?? e.message)
      .trim()
      .split('\n')
      .at(-1),
  );
}
si = await call('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });

// 4) TOTP (isteğe bağlı)
if (wantTotp) {
  // Hız sınırı (429) durumunda `Retry-After` kadar beklenir (en çok 3 deneme).
  const withRetry = async (fn) => {
    for (let i = 0; ; i++) {
      const r = await fn();
      if (r.status !== 429 || i >= 3) return r;
      await sleep(15000);
    }
  };
  const en = await withRetry(() =>
    call('/api/auth/two-factor/enable', { method: 'POST', body: { password } }),
  );
  const secret = new URL(en.json.totpURI).searchParams.get('secret');
  const ok = await withRetry(() =>
    call('/api/auth/two-factor/verify-totp', { method: 'POST', body: { code: totp(secret) } }),
  );
  console.log('TOTP kurulumu', ok.status);
  console.log(`TOTP anahtarı (yalnız dev): ${secret}`);
}
console.log(`hazır: ${email}`);
