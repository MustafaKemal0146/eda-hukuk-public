// Seed kimlik ad alanları (032 §10.7, §11.2): deterministik kimlik = uuidv5(ad alanı, ad). Ad alanları
// sabittir ve DEĞİŞTİRİLMEZ (değişirse platform şablonu ve örnek dünya kimlikleri kayar).
import { createHash } from 'node:crypto';

/** Dev örnek dünyası ve seed kaynaklı satırlar (`uuidv5(NS_SEED, ad)`). */
export const NS_SEED = '2c86eddb-e5ff-489d-95a9-72dc6f721bdc';
/** Platform şablonları (`uuidv5(NS_TEMPLATE, 'platform-template:' + slug)`; P18). */
export const NS_TEMPLATE = 'afea53db-0ba9-46ec-bff6-5f1d15735a15';

/** RFC 9562 UUID sürüm 5 (SHA-1, ad alanı + ad). */
export function uuidv5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  if (ns.length !== 16) throw new RangeError('uuidv5: ad alanı geçerli bir uuid olmalı');
  const hash = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  const b = hash.subarray(0, 16);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function seedId(name: string): string {
  return uuidv5(NS_SEED, name);
}

export function templateId(slug: string): string {
  return uuidv5(NS_TEMPLATE, `platform-template:${slug}`);
}
