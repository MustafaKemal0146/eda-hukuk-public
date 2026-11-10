// Yazılım WebAuthn doğrulayıcısı (yalnız test; KK-P04b-7, KK-P04b-8): P-256 anahtar çifti, `none`
// attestation, kullanıcı doğrulaması (UV) bayraklı `authenticatorData`, imza sayacı. Gerçek tarayıcı
// sanal doğrulayıcısının (P04c E2E) sunucu tarafı karşılığıdır; `@simplewebauthn/server` doğrulamasından
// geçen yanıtlar üretir. CBOR kodlayıcı yalnız bu yapılar için asgaridir.
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  sign,
} from 'node:crypto';

const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | Buffer | string) => createHash('sha256').update(b).digest();

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(n, 1);
  return b;
}

type Cbor = number | string | Uint8Array | Cbor[] | Map<number | string, Cbor>;

export function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const s = Buffer.from(v, 'utf8');
    return Buffer.concat([head(3, s.length), s]);
  }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  const parts: Buffer[] = [head(5, v.size)];
  for (const [k, x] of v) parts.push(cbor(k), cbor(x));
  return Buffer.concat(parts);
}

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

export interface SoftAuthenticator {
  readonly credentialId: Buffer;
  counter: number;
  register(options: { challenge: string }): Record<string, unknown>;
  authenticate(
    options: { challenge: string },
    opts?: { counter?: number; userVerified?: boolean },
  ): Record<string, unknown>;
}

export function softAuthenticator(rpId: string, origin: string): SoftAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const credentialId = randomBytes(16);
  const rpHash = sha256(rpId);
  const cose = cbor(
    new Map<number, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, 'base64url')],
      [-3, Buffer.from(jwk.y, 'base64url')],
    ]),
  );
  const counterBytes = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
  };
  const clientData = (type: string, challenge: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
  const self: SoftAuthenticator = {
    credentialId,
    counter: 0,
    register(options) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(credentialId.length, 0);
      const authData = Buffer.concat([
        rpHash,
        Buffer.from([UP | UV | AT]),
        counterBytes(self.counter),
        Buffer.alloc(16),
        len,
        credentialId,
        cose,
      ]);
      const attestationObject = cbor(
        new Map<string, Cbor>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      );
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64u(clientData('webauthn.create', options.challenge)),
          attestationObject: b64u(attestationObject),
          transports: ['internal'],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
    authenticate(options, opts = {}) {
      const counter = opts.counter ?? self.counter + 1;
      if (opts.counter === undefined) self.counter = counter;
      const flags = UP | (opts.userVerified === false ? 0 : UV);
      const authData = Buffer.concat([rpHash, Buffer.from([flags]), counterBytes(counter)]);
      const cd = clientData('webauthn.get', options.challenge);
      const signature = sign(
        'sha256',
        Buffer.concat([authData, sha256(cd)]),
        privateKey as KeyObject,
      );
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64u(cd),
          authenticatorData: b64u(authData),
          signature: b64u(signature),
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
  };
  return self;
}

/** RFC 6238 TOTP (SHA-1, 6 hane, 30 sn) — `otpauth://` URI'sindeki base32 sırdan. */
export function totpFromUri(uri: string, at: number = Date.now()): string {
  const secret = new URL(uri).searchParams.get('secret') ?? '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const key = Buffer.from(bytes);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)), 0);
  const h = createHmac('sha1', key).update(counter).digest();
  const off = (h[h.length - 1] ?? 0) & 0x0f;
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}
