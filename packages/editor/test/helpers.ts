// Test yardımcıları: fikstür okuma ve kısa JSON kurucuları (DOM yok).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseDocJson } from '../src/schema/parse-doc.ts';

export type Json = Record<string, unknown>;

export function fixture<T = Json>(name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')) as T;
}

/** Fikstürü şemadan geçirir; şema hatası varsa testi düşürür. */
export function pm(json: unknown): PMNode {
  const parsed = parseDocJson(json);
  if (parsed.doc === null) {
    throw new Error(`şema hatası: ${parsed.issues.map((i) => `${i.code}@${i.path}`).join(', ')}`);
  }
  return parsed.doc;
}

export const text = (value: string, ...marks: (string | Json)[]): Json =>
  marks.length === 0
    ? { type: 'text', text: value }
    : {
        type: 'text',
        text: value,
        marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)),
      };

export const para = (...content: Json[]): Json =>
  content.length === 0 ? { type: 'paragraph' } : { type: 'paragraph', content };

export const heading = (value: string, level = 1): Json => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});

export const list = (ordered: boolean, ...items: string[]): Json => ({
  type: ordered ? 'orderedList' : 'bulletList',
  content: items.map((i) => ({ type: 'listItem', content: [para(text(i))] })),
});

export const table = (rows: number, cols: number): Json => ({
  type: 'table',
  content: Array.from({ length: rows }, (_r, r) => ({
    type: 'tableRow',
    content: Array.from({ length: cols }, (_c, c) => ({
      type: 'tableCell',
      content: [para(text(`H${r}-${c}`))],
    })),
  })),
});

export const section = (blockId: string, role: string, ...content: Json[]): Json => ({
  type: 'section',
  attrs: { blockId, rev: 1, role },
  content,
});

export const doc = (...sections: Json[]): Json => ({ type: 'doc', content: sections });

export const citation = (citationId: string | null, raw: string, status = 'pending'): Json => ({
  type: 'citation',
  attrs: { citationId, raw, sourceRef: null, status, attestKey: null },
});
