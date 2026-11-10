// Yasal sayfa içerik modeli (053-12 §7-§10). Metinler `legal.*` katalog ad alanındadır ve ham okunur
// (`t.raw`): `{{...}}` yer tutucuları ICU söz diziminden bağımsızdır. Burada yalnız biçim ve doldurma.
import { fillConfig } from './placeholders.ts';

export type LegalTable = {
  caption: string;
  head: string[];
  rows: string[][];
};

export type LegalSection = {
  id: string;
  title: string;
  /** Numarasız bölüm (ek). */
  unnumbered?: boolean;
  paragraphs?: string[];
  list?: string[];
  table?: LegalTable;
  note?: string;
  links?: { href: string; label: string }[];
};

function fillTable(t: LegalTable): LegalTable {
  return {
    caption: fillConfig(t.caption),
    head: t.head.map((c) => fillConfig(c)),
    rows: t.rows.map((r) => r.map((c) => fillConfig(c))),
  };
}

export function fillSection(s: LegalSection): LegalSection {
  return {
    id: s.id,
    title: fillConfig(s.title),
    ...(s.unnumbered ? { unnumbered: true } : {}),
    ...(s.paragraphs ? { paragraphs: s.paragraphs.map((p) => fillConfig(p)) } : {}),
    ...(s.list ? { list: s.list.map((p) => fillConfig(p)) } : {}),
    ...(s.table ? { table: fillTable(s.table) } : {}),
    ...(s.note ? { note: fillConfig(s.note) } : {}),
    ...(s.links ? { links: s.links } : {}),
  };
}

export const fillLegalTable = fillTable;
