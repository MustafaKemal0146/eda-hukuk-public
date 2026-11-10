// İş parametresi mühürleme (045 §6.2 madde 3; 002 §26 madde 86): e-posta bağlantı belirteci gibi
// sırlar `email_deliveries.sealed_params` (bytea) alanına AEAD ile yazılır; Valkey iş yüküne, loga
// veya `params` kolonuna girmez.
// Anahtar: HKDF-SHA256(kek_master, salt=∅, info="email-job-v1", L=32).
// AAD: "eda/v1/email-job" ‖ 0x00 ‖ deliveryId (16) ‖ lp(template) ‖ kullanıcı bayrağı (1) ‖ userId (16)?
// (lp = uint16 BE uzunluk öneki; userId yoksa bayrak 0x00 ve kimlik baytı yok).
// Çıktı: nonce (12) ‖ şifreli JSON ‖ etiket (16). Saf: yalnız node:crypto.
import { hkdfSync } from 'node:crypto';
import { concatAad, labelBytes, lengthPrefixed, uuidBytes } from './aad.ts';
import { CryptoError } from './errors.ts';
import { assertKey, KEY_BYTES, open, randomNonce, sealWithNonce } from './gcm.ts';
import { wipe } from './wipe.ts';

export const JOB_PARAMS_INFO = 'email-job-v1';
export const JOB_PARAMS_AAD_LABEL = 'eda/v1/email-job';

/** Mühür bağlamı: teslimat kimliği, şablon kodu ve (varsa) alıcı kullanıcı kimliği. */
export type JobParamsContext = {
  deliveryId: string;
  template: string;
  userId: string | null;
};

/** Mühürlenen değerler: düz anahtar -> metin (ör. `{ token }`). */
export type SealedParams = Readonly<Record<string, string>>;

const TEMPLATE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const EMPTY_SALT = Buffer.alloc(0);
const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/** `HKDF-SHA256(kek, ∅, "email-job-v1", 32)`. */
export function deriveJobParamsKey(kek: Uint8Array): Buffer {
  assertKey(kek, 'KEK');
  return Buffer.from(
    hkdfSync('sha256', kek, EMPTY_SALT, Buffer.from(JOB_PARAMS_INFO, 'ascii'), KEY_BYTES),
  );
}

export function jobParamsAad(ctx: JobParamsContext): Buffer {
  if (!TEMPLATE_RE.test(ctx.template)) {
    throw new CryptoError('invalid_input', 'Şablon kodu küçük harfle başlayan snake_case olmalı.');
  }
  return concatAad([
    labelBytes(JOB_PARAMS_AAD_LABEL),
    uuidBytes(ctx.deliveryId),
    lengthPrefixed(ctx.template),
    ...(ctx.userId === null ? [Buffer.of(0x00)] : [Buffer.of(0x01), uuidBytes(ctx.userId)]),
  ]);
}

function encodeParams(params: SealedParams): Buffer {
  for (const [k, v] of Object.entries(params)) {
    if (typeof v !== 'string' || k === '') {
      throw new CryptoError('invalid_input', 'Mühürlenecek parametreler anahtar -> metin olmalı.');
    }
  }
  return Buffer.from(JSON.stringify(params), 'utf8');
}

/** Parametreleri mühürler (her çağrıda yeni nonce). */
export function sealJobParams(
  kek: Uint8Array,
  ctx: JobParamsContext,
  params: SealedParams,
): Buffer {
  return sealJobParamsWithNonce(kek, ctx, params, randomNonce());
}

/** Yalnız bilinen-cevap testleri içindir; paket kökünden dışa aktarılmaz. */
export function sealJobParamsWithNonce(
  kek: Uint8Array,
  ctx: JobParamsContext,
  params: SealedParams,
  nonce: Uint8Array,
): Buffer {
  const key = deriveJobParamsKey(kek);
  const plain = encodeParams(params);
  try {
    return sealWithNonce(key, nonce, jobParamsAad(ctx), plain);
  } finally {
    wipe(key);
    wipe(plain);
  }
}

/** Mührü açar; bağlam (AAD), anahtar veya bayt uyuşmazsa `auth_failed`. */
export function unsealJobParams(
  kek: Uint8Array,
  ctx: JobParamsContext,
  sealed: Uint8Array,
): SealedParams {
  const key = deriveJobParamsKey(kek);
  let plain: Buffer | undefined;
  try {
    plain = open(key, jobParamsAad(ctx), sealed);
    const parsed: unknown = JSON.parse(utf8Strict.decode(plain));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CryptoError('auth_failed', 'Mühürlü parametreler beklenen biçimde değil.');
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string') {
        throw new CryptoError('auth_failed', 'Mühürlü parametreler beklenen biçimde değil.');
      }
      out[k] = v;
    }
    return out;
  } finally {
    wipe(key);
    if (plain !== undefined) wipe(plain);
  }
}
