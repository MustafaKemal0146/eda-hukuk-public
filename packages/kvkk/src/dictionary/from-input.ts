// `sourcesFromInput` (026 §7.1): düz sözlük girdisini DictionarySource listesine çevirir. Kimlik
// kuralları 026 §4.4, görünen değer kuralları §4.7. Paket DB'ye erişmez.
import { asciiLower } from '../fold.ts';
import { resolveLimits } from '../limits.ts';
import type { DictionaryInput, DictionarySource, KvkkLimits, Tip } from '../types.ts';
import { entitySurfaces, esasSurfaces, kararSurfaces, personSurfaces } from './variants.ts';

function person(
  out: DictionarySource[],
  ownerId: string,
  identity: string,
  firstName: string | undefined,
  lastName: string | undefined,
  aliases: readonly string[] | undefined,
  limits: KvkkLimits,
): void {
  const f = (firstName ?? '').trim();
  const l = (lastName ?? '').trim();
  if (!f && !l) return;
  const display = [f, l].filter((x) => x.length > 0).join(' ');
  const surfaces = personSurfaces(f, l, limits.weakVariantMinChars, aliases ?? []);
  if (surfaces.length > 0) out.push({ ownerId, tip: 'KISI', identity, display, surfaces });
}

function entity(
  out: DictionarySource[],
  ownerId: string,
  identity: string,
  name: string | undefined,
  aliases: readonly string[] | undefined,
): void {
  const n = (name ?? '').trim();
  if (!n) return;
  out.push({ ownerId, tip: 'SIRKET', identity, display: n, surfaces: entitySurfaces(n, aliases) });
}

function value(out: DictionarySource[], ownerId: string, tip: Tip, raw: string | undefined): void {
  const v = (raw ?? '').trim();
  if (!v) return;
  out.push({ ownerId, tip, identity: `${ownerId}:${asciiLower(tip)}`, display: v, surfaces: [v] });
}

function splitName(full: string): { first: string; last: string } {
  const ws = full.trim().split(/\s{1,16}/u);
  if (ws.length < 2) return { first: ws[0] ?? '', last: '' };
  return { first: ws.slice(0, -1).join(' '), last: ws[ws.length - 1] ?? '' };
}

export function sourcesFromInput(
  input: DictionaryInput,
  opts: { maskOwnCaseNumber: boolean; limits?: Partial<KvkkLimits> },
): DictionarySource[] {
  const limits = resolveLimits(opts.limits);
  const out: DictionarySource[] = [];
  for (const c of input.clients) {
    if (c.kind === 'person') person(out, c.id, c.id, c.firstName, c.lastName, c.aliases, limits);
    else entity(out, c.id, c.id, c.entityName, c.aliases);
    value(out, c.id, 'TCKN', c.tckn);
    value(out, c.id, 'VKN', c.vkn);
    value(out, c.id, 'EPOSTA', c.email);
    value(out, c.id, 'TEL', c.phone);
    value(out, c.id, 'ADRES', c.address);
  }
  for (const p of input.parties) {
    const owner = p.clientId ?? p.id;
    if (p.kind === 'person') person(out, owner, owner, p.firstName, p.lastName, undefined, limits);
    else entity(out, owner, owner, p.entityName, undefined);
    if (p.counselName) {
      const { first, last } = splitName(p.counselName);
      person(out, p.id, `${p.id}:counsel`, first, last, undefined, limits);
    }
    value(out, owner, 'ADRES', p.address);
  }
  if (opts.maskOwnCaseNumber) {
    for (const k of input.cases) {
      if (k.esasNo) {
        out.push({
          ownerId: k.id,
          tip: 'DOSYA',
          identity: `${k.id}:esas`,
          display: k.esasNo.trim(),
          surfaces: esasSurfaces(k.esasNo),
        });
      }
      if (k.kararNo) {
        out.push({
          ownerId: k.id,
          tip: 'DOSYA',
          identity: `${k.id}:karar`,
          display: k.kararNo.trim(),
          surfaces: kararSurfaces(k.kararNo),
        });
      }
      if (k.officeFileCode) {
        out.push({
          ownerId: k.id,
          tip: 'DOSYA',
          identity: `${k.id}:kod`,
          display: k.officeFileCode.trim(),
          surfaces: [k.officeFileCode.trim()],
        });
      }
    }
  }
  return out;
}
