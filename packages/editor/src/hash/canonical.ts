// Kanonik JSON (RFC 8785, JCS) ve belge özeti (054 §8.2, §9.3). Saf: `node:crypto` değil WebCrypto
// (`globalThis.crypto.subtle`; tarayıcı ve Node 24 aynı kod) — bu yüzden özetler async'tir.

/**
 * RFC 8785 serileştirmesi: nesne anahtarları UTF-16 kod birimi sırasıyla, boşluksuz; sayı ve dizgeler
 * ECMAScript `JSON.stringify` kuralıyla (RFC 8785 §3.2.2). Sonlu olmayan sayı reddedilir.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Kanonik JSON sonlu olmayan sayı içeremez.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  throw new TypeError('Kanonik JSON yalnız JSON değerlerini serileştirir.');
}

/** `rev` öznitelikleri çıkarılmış derin kopya (blockId ve rol dahil kalır; 054 §3.2, §8.2). */
export function stripRev(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRev);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'attrs' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const { rev: _rev, ...rest } = v as Record<string, unknown>;
        out[k] = stripRev(rest);
      } else {
        out[k] = stripRev(v);
      }
    }
    return out;
  }
  return value;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Belge özeti: `SHA-256(canonicalJson(rev'siz belge JSON'u))`, küçük harf onaltılık. Girdi şemadan
 * geçmiş `toJSON` çıktısı olmalıdır (iki taraf aynı normalleştirmeyi kullanır).
 */
export function docHash(doc: unknown): Promise<string> {
  return sha256Hex(canonicalJson(stripRev(doc)));
}

/** Blok özeti: tek section JSON'unun rev'siz kanonik özeti (sunucunun `rev` hesabı, P17b). */
export function blockDigest(section: unknown): Promise<string> {
  return sha256Hex(canonicalJson(stripRev(section)));
}
