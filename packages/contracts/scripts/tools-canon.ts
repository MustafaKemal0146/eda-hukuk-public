// Araç tanımlarının kanonik JSON'u (021 §4.15, eda-canon-v1) ve strict alt küme denetimi (021 §4.1).
// gen-tools betiği ve tools-lock testi aynı fonksiyonları kullanır; çalışma zamanı üretilmiş dosyayı okur.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ToolContract } from '../src/tools/common.ts';

const KEY_ORDER = [
  'type',
  'description',
  'enum',
  'pattern',
  'minimum',
  'maximum',
  'anyOf',
  'items',
  'properties',
  'required',
  'additionalProperties',
];
const ALLOWED = new Set(KEY_ORDER);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function canonSchema(node: Json, path: string, errors: string[]): Json {
  if (Array.isArray(node)) return node.map((n, i) => canonSchema(n, `${path}[${i}]`, errors));
  if (node === null || typeof node !== 'object') return node;
  // Zod `type: [X, "null"]` üretir; strict alt küme yalnız anyOf null birleşimine izin verir.
  if (Array.isArray(node.type)) {
    const types = node.type as Json[];
    const base = types.filter((t) => t !== 'null');
    if (types.length === 2 && base.length === 1) {
      const { description, type: _t, ...rest } = node;
      const rewritten: Record<string, Json> = {
        anyOf: [{ type: base[0] as Json, ...rest }, { type: 'null' }],
      };
      if (description !== undefined) rewritten.description = description;
      return canonSchema(rewritten, path, errors);
    }
    errors.push(`${path}: desteklenmeyen tür dizisi`);
  }
  for (const k of Object.keys(node)) {
    if (!ALLOWED.has(k)) errors.push(`${path}: izinsiz anahtar sözcük '${k}'`);
  }
  if (node.type === 'object') {
    const props = Object.keys((node.properties as Record<string, Json>) ?? {});
    const req = (node.required as string[]) ?? [];
    if (props.length !== req.length || props.some((p) => !req.includes(p))) {
      errors.push(`${path}: tüm alanlar required olmalı`);
    }
    if (node.additionalProperties !== false)
      errors.push(`${path}: additionalProperties false olmalı`);
  }
  if (Array.isArray(node.anyOf)) {
    const branches = node.anyOf as Json[];
    const nulls = branches.filter(
      (b) => b !== null && typeof b === 'object' && (b as { type?: Json }).type === 'null',
    );
    if (branches.length !== 2 || nulls.length !== 1)
      errors.push(`${path}: anyOf yalnız null birleşimi`);
  }
  const out: Record<string, Json> = {};
  for (const k of KEY_ORDER) {
    if (!(k in node)) continue;
    const v = node[k] as Json;
    if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = Object.fromEntries(
        Object.entries(v).map(([pk, pv]) => [pk, canonSchema(pv, `${path}.${pk}`, errors)]),
      );
    } else if (k === 'items' || k === 'anyOf') {
      out[k] = canonSchema(v, `${path}.${k}`, errors);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export type CanonTool = { name: string; description: string; parameters: Json };

export function canonTool(t: ToolContract, errors: string[] = []): CanonTool {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(t.name)) errors.push(`${t.name}: ad deseni`);
  if (t.description.length > 300) errors.push(`${t.name}: açıklama 300 karakteri aşıyor`);
  const raw = z.toJSONSchema(t.inputSchema, { io: 'input', unrepresentable: 'throw' }) as Record<
    string,
    Json
  >;
  delete raw.$schema;
  return {
    name: t.name,
    description: t.description.normalize('NFC'),
    parameters: canonSchema(raw, t.name, errors),
  };
}

export function canonJson(value: unknown): string {
  return JSON.stringify(value).normalize('NFC');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function buildLock(tools: readonly ToolContract[]) {
  const errors: string[] = [];
  const canon = tools.map((t) => canonTool(t, errors));
  const set = canonJson(canon);
  return {
    generated: canon,
    errors,
    lock: {
      version: 1,
      canonicalization: 'eda-canon-v1',
      algorithm: 'sha256',
      tools: canon.map((c) => {
        const s = canonJson(c);
        return { name: c.name, sha256: sha256(s), chars: s.length };
      }),
      set_sha256: sha256(set),
      approx_tokens: Math.ceil(set.length / 3),
    },
  };
}
