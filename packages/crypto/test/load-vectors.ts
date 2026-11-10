// Bilinen-cevap vektörlerini yükler (test/vectors/*.json; sentetik değerler).
import { readFileSync } from 'node:fs';

export type KeyVectors = {
  variants: { fileKey: string; variant: string; key: string }[];
  wrapDek: {
    kek: string;
    dek: string;
    orgId: string;
    dekVersion: number;
    kekVersion: number;
    nonce: string;
    aad: string;
    wrapped: string;
  }[];
  wrapFileKey: {
    dek: string;
    fileKey: string;
    orgId: string;
    fileId: string;
    keyVersion: number;
    nonce: string;
    aad: string;
    wrapped: string;
  }[];
};

export type FieldVectors = {
  encryptField: {
    dek: string;
    orgId: string;
    table: string;
    rowId: string;
    column: string;
    keyVersion: number;
    value: string;
    nonce: string;
    aad: string;
    sealed: string;
  }[];
  orgSearch: {
    hmacPseudonymKey: string;
    orgId: string;
    info: string;
    orgSearchKey: string;
    input: string;
    normalized: string;
    hmac: string;
  }[];
};

function load(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./vectors/${name}`, import.meta.url), 'utf8'));
}

export const keyVectors = load('keys.json') as KeyVectors;
export const fieldVectors = load('field.json') as FieldVectors;

export const hex = (s: string): Buffer => Buffer.from(s, 'hex');

/** Ardışık bayt deseni (sentetik test anahtarı). */
export const seq = (start: number, n: number): Buffer =>
  Buffer.from(Array.from({ length: n }, (_, i) => (start + i) & 0xff));

/** Tamponun bir baytını çevirerek bozulmuş kopyasını döndürür. */
export function flipByte(buf: Uint8Array, index: number): Buffer {
  const out = Buffer.from(buf);
  out[index] = (out[index] ?? 0) ^ 0x01;
  return out;
}
