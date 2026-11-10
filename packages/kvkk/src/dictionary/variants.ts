// Yüzey türetimi (026 §7.2): her kayıttan foldChars sonrası otomata girecek yüzeyler. Tek sözcüklü
// yüzey yalnız uzunluk >= kvkk.weakVariantMinChars ise ve LEGAL_TERMS köküyle çakışmıyorsa üretilir.

import { stripCompanySuffix } from '../detectors/company.ts';
import { isLegalTermWord } from '../detectors/legal-terms.ts';

function words(s: string): string[] {
  return s
    .trim()
    .split(/\s{1,16}/u)
    .filter((w) => w.length > 0);
}

function letters(s: string): number {
  let n = 0;
  for (const ch of s) if (/\p{L}/u.test(ch)) n += 1;
  return n;
}

function singleOk(w: string, minChars: number): boolean {
  return letters(w) >= minChars && !isLegalTermWord(w);
}

/** Kişi yüzeyleri: tüm adlar + soyad, ilk ad + soyad, ters sıra, "Soyad, Adlar", baş harfli, tekiller. */
export function personSurfaces(
  firstName: string,
  lastName: string,
  minChars: number,
  aliases: readonly string[] = [],
): string[] {
  const out = new Set<string>();
  const given = words(firstName);
  const last = lastName.trim();
  const first = given[0];
  if (first && last) {
    const all = given.join(' ');
    out.add(`${all} ${last}`);
    out.add(`${first} ${last}`);
    out.add(`${last} ${first}`);
    out.add(`${last} ${all}`);
    out.add(`${last}, ${all}`);
    const initial = [...first][0] ?? '';
    if (initial) {
      out.add(`${initial}. ${last}`);
      out.add(`${initial}.${last}`);
    }
  }
  if (last && !last.includes(' ') && singleOk(last, minChars)) out.add(last);
  if (last.includes(' ')) out.add(last);
  if (first && singleOk(first, minChars)) out.add(first);
  for (const alias of aliases) {
    const ws = words(alias);
    if (ws.length >= 2) {
      const aLast = ws[ws.length - 1] ?? '';
      for (const s of personSurfaces(ws.slice(0, -1).join(' '), aLast, minChars)) out.add(s);
    } else if (ws[0] && singleOk(ws[0], minChars)) {
      out.add(ws[0]);
    }
  }
  return [...out];
}

/** Kurum yüzeyleri: unvanın tamamı, en uzun unvan eki atılmış çekirdek ad (>= 2 sözcük veya >= 6 harf). */
export function entitySurfaces(name: string, aliases: readonly string[] = []): string[] {
  const out = new Set<string>();
  for (const n of [name, ...aliases]) {
    const full = n.trim();
    if (!full) continue;
    out.add(full);
    const core = stripCompanySuffix(full);
    if (core && (words(core).length >= 2 || letters(core) >= 6) && !isLegalTermWord(core)) {
      out.add(core);
    }
  }
  return [...out];
}

/** Dosya no yüzeyleri (026 §7.2): yalnız bağlı davanın kayıtlı numaraları. */
export function esasSurfaces(no: string): string[] {
  const n = no.trim();
  return [n, `${n} E.`, `${n} Esas`, `E. ${n}`, `E.${n}`];
}

export function kararSurfaces(no: string): string[] {
  const n = no.trim();
  return [n, `${n} K.`, `${n} Karar`, `K. ${n}`, `K.${n}`];
}
