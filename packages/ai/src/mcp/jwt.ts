// yargi-mcp servis JWT imzalama (021 §5.3): EdDSA (Ed25519 PKCS#8), başlık {alg, typ, kid}; claim'ler
// yalnız aud, iat, exp = iat + 60, org. `sub`/`jti` yok; her çağrıda yeni imza (önbelleklenmez).
import { createHash, createHmac, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { importPKCS8, SignJWT } from 'jose';

export const SERVICE_JWT_LIFETIME_SEC = 60;
/** Sistem işleri (corpus.*, canary) için sabit `org` (P11 K10; AS adayı). */
export const SYSTEM_ORG = 'sys';
const ORG_LABEL = 'yargi-mcp/org/v1';

export type ServiceJwtSigner = {
  /** `org`: deriveOrgClaim çıktısı veya SYSTEM_ORG. */
  sign(org: string): Promise<string>;
  readonly kid: string;
};

/** `base64url(HMAC-SHA256(key, "yargi-mcp/org/v1" ‖ org_id))` ilk 22 karakter. */
export function deriveOrgClaim(hmacKey: Uint8Array | string, orgId: string): string {
  return createHmac('sha256', hmacKey)
    .update(`${ORG_LABEL}${orgId}`)
    .digest('base64url')
    .slice(0, 22);
}

/** `kid` = SPKI DER SHA-256 ilk 16 hex (özel anahtardan türetilen açık anahtarın). */
export function kidFromPrivateKey(privateKeyPem: string): string {
  const der = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export async function createServiceJwtSigner(opts: {
  privateKeyPem: string;
  audience: string;
  /** Test için saniye cinsinden saat. */
  nowSec?: () => number;
}): Promise<ServiceJwtSigner> {
  const key = await importPKCS8(opts.privateKeyPem, 'EdDSA');
  const kid = kidFromPrivateKey(opts.privateKeyPem);
  const nowSec = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));
  return {
    kid,
    async sign(org) {
      const iat = nowSec();
      return new SignJWT({ org })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid })
        .setAudience(opts.audience)
        .setIssuedAt(iat)
        .setExpirationTime(iat + SERVICE_JWT_LIFETIME_SEC)
        .sign(key);
    },
  };
}

/** Özel anahtar dosyadan okunur (`INTERNAL_JWT_PRIVATE_KEY_FILE`); değer loglanmaz. */
export async function loadServiceJwtSigner(opts: {
  privateKeyFile: string;
  audience: string;
}): Promise<ServiceJwtSigner> {
  const pem = await readFile(opts.privateKeyFile, 'utf8');
  return createServiceJwtSigner({ privateKeyPem: pem, audience: opts.audience });
}
