// Servis JWT doğrulaması (021 §5.3): EdDSA (Ed25519), aud = INTERNAL_JWT_AUDIENCE, exp - iat ≤ 60,
// claim kümesi tam olarak {aud, iat, exp, org}; `sub`/`jti` yok. Ret = HTTP 401 gövdesiz (çağıran).
// AS-P11-11: SDK 2.3.1 `createMcpHandler` seçeneklerinde `expectedResource` yok (021 Açık Soru 8);
// audience yalnız jose ile doğrulanır.
import { createHash, createPublicKey } from 'node:crypto';
import { importSPKI, jwtVerify } from 'jose';

const MAX_LIFETIME_SEC = 60;
const CLOCK_TOLERANCE_SEC = 5;
const ALLOWED_CLAIMS = new Set(['aud', 'iat', 'exp', 'org']);
const ORG_CLAIM = /^([A-Za-z0-9_-]{22}|sys)$/;

export type VerifiedService = { org: string };
export type JwtVerifier = (authorization: string | undefined) => Promise<VerifiedService | null>;

/** `kid` = SPKI DER SHA-256 ilk 16 hex (021 Yeni Tanımlanan Adlar). */
export function spkiKid(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export async function createJwtVerifier(opts: {
  publicKeyPem: string;
  audience: string;
  /** Test için saniye cinsinden şimdiki zaman. */
  currentDate?: () => Date;
}): Promise<JwtVerifier> {
  const key = await importSPKI(opts.publicKeyPem, 'EdDSA');
  const kid = spkiKid(opts.publicKeyPem);
  return async (authorization) => {
    const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization ?? '');
    if (!m?.[1]) return null;
    try {
      const { payload, protectedHeader } = await jwtVerify(m[1], key, {
        algorithms: ['EdDSA'],
        audience: opts.audience,
        clockTolerance: CLOCK_TOLERANCE_SEC,
        typ: 'JWT',
        requiredClaims: ['iat', 'exp', 'org'],
        ...(opts.currentDate ? { currentDate: opts.currentDate() } : {}),
      });
      if (protectedHeader.kid !== undefined && protectedHeader.kid !== kid) return null;
      if (Object.keys(payload).some((k) => !ALLOWED_CLAIMS.has(k))) return null;
      if (payload.aud !== opts.audience) return null;
      const { iat, exp, org } = payload;
      if (typeof iat !== 'number' || typeof exp !== 'number') return null;
      if (exp - iat <= 0 || exp - iat > MAX_LIFETIME_SEC) return null;
      if (typeof org !== 'string' || !ORG_CLAIM.test(org)) return null;
      return { org };
    } catch {
      return null;
    }
  };
}
