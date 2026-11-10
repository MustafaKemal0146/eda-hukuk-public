// @tk TK-28
// KK-021-10: servis JWT matrisi (021 §7.4). Anahtar çifti test başına üretilir.
import { createHmac } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createJwtVerifier, type JwtVerifier, spkiKid } from '../../src/auth/jwt.ts';
import { ed25519Pair, signToken } from '../helpers.ts';

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = (): number => Math.floor(Date.now() / 1000);

describe('KK-P11-2 / KK-021-10: servis JWT doğrulaması', () => {
  const keys = ed25519Pair();
  let verify: JwtVerifier;

  beforeAll(async () => {
    verify = await createJwtVerifier({ publicKeyPem: keys.publicKeyPem, audience: 'yargi-mcp' });
  });

  it('geçerli token (kid doğru, 60 sn, yalnız aud/iat/exp/org) kabul edilir', async () => {
    const t = await signToken(keys.privateKeyPem, { header: { kid: spkiKid(keys.publicKeyPem) } });
    expect(await verify(`Bearer ${t}`)).toEqual({ org: 'sys' });
    const org = await signToken(keys.privateKeyPem, { claims: { org: 'AbCdEfGhIjKlMnOpQrStUv' } });
    expect(await verify(`Bearer ${org}`)).toEqual({ org: 'AbCdEfGhIjKlMnOpQrStUv' });
  });

  const rejected: [string, () => Promise<string>][] = [
    ['yanlış aud', () => signToken(keys.privateKeyPem, { aud: 'api' })],
    ['süresi geçmiş', () => signToken(keys.privateKeyPem, { iat: now() - 200 })],
    ['exp - iat = 120', () => signToken(keys.privateKeyPem, { lifetimeSec: 120 })],
    ['fazladan sub', () => signToken(keys.privateKeyPem, { claims: { sub: 'u1' } })],
    ['fazladan jti', () => signToken(keys.privateKeyPem, { claims: { jti: 'x' } })],
    ['geçersiz org', () => signToken(keys.privateKeyPem, { claims: { org: 'org-1' } })],
    ['yanlış kid', () => signToken(keys.privateKeyPem, { header: { kid: '0000000000000000' } })],
    ['başka anahtar', () => signToken(ed25519Pair().privateKeyPem)],
    [
      'eksik org',
      async () => {
        const key = await importPKCS8(keys.privateKeyPem, 'EdDSA');
        const iat = now();
        return new SignJWT({})
          .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
          .setAudience('yargi-mcp')
          .setIssuedAt(iat)
          .setExpirationTime(iat + 60)
          .sign(key);
      },
    ],
    [
      'alg: none',
      async () =>
        `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ aud: 'yargi-mcp', iat: now(), exp: now() + 60, org: 'sys' })}.`,
    ],
    [
      'HS256 (açık anahtar sır olarak)',
      async () => {
        const head = b64({ alg: 'HS256', typ: 'JWT' });
        const body = b64({ aud: 'yargi-mcp', iat: now(), exp: now() + 60, org: 'sys' });
        const sig = createHmac('sha256', keys.publicKeyPem)
          .update(`${head}.${body}`)
          .digest('base64url');
        return `${head}.${body}.${sig}`;
      },
    ],
    [
      'imzasız',
      async () => {
        const t = await signToken(keys.privateKeyPem);
        return `${t.split('.').slice(0, 2).join('.')}.`;
      },
    ],
  ];

  for (const [name, make] of rejected) {
    it(`${name} → ret`, async () => {
      expect(await verify(`Bearer ${await make()}`)).toBeNull();
    });
  }

  it('Authorization başlığı yok veya Bearer değil → ret', async () => {
    expect(await verify(undefined)).toBeNull();
    expect(await verify(`Basic ${await signToken(keys.privateKeyPem)}`)).toBeNull();
  });
});
