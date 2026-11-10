// @tk TK-28
// KK-021-10: servis JWT imzası — claim'ler yalnız aud/iat/exp/org, exp - iat = 60, sub/jti yok, kid başlığı;
// org HMAC türetmesi (021 §5.3). Anahtarlar test başına üretilir.
import { createHash, createPublicKey } from 'node:crypto';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { errorAction, isRetryable } from '../src/mcp/errors.ts';
import { createServiceJwtSigner, deriveOrgClaim, SYSTEM_ORG } from '../src/mcp/jwt.ts';
import { ed25519Pair } from './mcp-helpers.ts';

describe('KK-021-10: servis JWT imzalama', () => {
  it('EdDSA, kid = SPKI SHA-256 ilk 16 hex, claim kümesi tam ve 60 sn', async () => {
    const keys = ed25519Pair();
    const signer = await createServiceJwtSigner({
      privateKeyPem: keys.privateKeyPem,
      audience: 'yargi-mcp',
    });
    const token = await signer.sign(SYSTEM_ORG);
    const header = decodeProtectedHeader(token);
    const der = createPublicKey(keys.publicKeyPem).export({ type: 'spki', format: 'der' });
    expect(header).toEqual({
      alg: 'EdDSA',
      typ: 'JWT',
      kid: createHash('sha256').update(der).digest('hex').slice(0, 16),
    });
    const { payload } = await jwtVerify(token, await importSPKI(keys.publicKeyPem, 'EdDSA'), {
      audience: 'yargi-mcp',
    });
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'org']);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(60);
    expect(payload.org).toBe('sys');
  });

  it('org claim: 22 karakter base64url, deterministik, büroya göre farklı', () => {
    const key = 'test-hmac-anahtari';
    const a = deriveOrgClaim(key, 'org-1');
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(deriveOrgClaim(key, 'org-1')).toBe(a);
    expect(deriveOrgClaim(key, 'org-2')).not.toBe(a);
  });
});

describe('021 §6.4: hata eylemleri', () => {
  it('yoğun/erişilemez yeniden denenir; doğrulama/bulunamadı/PII kalıcıdır', () => {
    const e = (code: Parameters<typeof errorAction>[0]) => ({
      code,
      reason: null,
      retry_after_ms: null,
      source: null,
      origin: 'tool' as const,
    });
    expect(isRetryable(e('SOURCE_BUSY'))).toBe(true);
    expect(isRetryable(e('SOURCE_UNAVAILABLE'))).toBe(true);
    expect(isRetryable(e('VALIDATION_FAILED'))).toBe(false);
    expect(errorAction('SOURCE_DOCUMENT_NOT_FOUND')).toBe('not_found');
    expect(errorAction('SOURCE_PII_BLOCKED')).toBe('pii_blocked');
  });
});
