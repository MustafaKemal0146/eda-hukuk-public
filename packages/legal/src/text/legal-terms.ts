// Hukuk terimi sözlüğü (023 §10.1 (b), §3.2). Hevesli getirim tetikleyicisi bu sözlüğü kullanır: korunan
// terimler (`infra/postgres/tsearch_data/tr_hukuk_protected.syn` sol sütunu; eşitlik DB testinde
// sınanır) + kanun kısaltmaları (`kunye/law-aliases.ts`, tek kaynak). Liste hukuk onayı bekler;
// yeni terim yalnız 023 §3.5 yordamıyla eklenir. Yalnız veri ve eşleme; saf.
import { LAW_ALIASES } from '../kunye/law-aliases.ts';
import { tr_normalize } from './normalize.ts';

/** 023 §3.2 korunan terimler (`tr_normalize` biçimi), .syn dosyasındaki sırayla. */
export const PROTECTED_LEGAL_TERMS = [
  'kanun',
  'kanunu',
  'kanunun',
  'kanuna',
  'kanunda',
  'kanundan',
  'kanunla',
  'kanunlar',
  'kanunları',
  'kanunların',
  'madde',
  'maddesi',
  'maddesinin',
  'maddesine',
  'maddesinde',
  'maddeye',
  'maddeler',
  'maddeleri',
  'kıdem',
  'kıdemi',
  'kıdemin',
  'daire',
  'dairesi',
  'dairesinin',
  'dairesince',
  'işveren',
  'işverenin',
  'işverene',
  'hüküm',
  'hükmü',
  'hükmün',
  'hükümleri',
  'fıkra',
  'fıkrası',
  'fıkrasının',
  'bent',
  'bendi',
  'bendinin',
  'mahkeme',
  'mahkemesi',
  'mahkemenin',
  'mahkemece',
  'yargıtay',
  'yargıtayın',
  'danıştay',
  'danıştayın',
  'temyiz',
  'temyizi',
  'istinaf',
  'istinafı',
  'tazminat',
  'tazminatı',
  'tazminatın',
  'zamanaşımı',
  'zamanaşımına',
  'vekalet',
  'vekaleti',
  'vekaletname',
] as const;

/**
 * Gündelik sözcükle çakışan kısaltmalar terim sayılmaz: `AY` (Anayasa görüntü kısaltması) "ay"
 * sözcüğüdür; madde atfı bağlamı (R2) zaten `ay m.` desenini yakalar.
 */
const AMBIGUOUS_ABBREVIATIONS: ReadonlySet<string> = new Set(['ay']);

/** Kanun kısaltmaları ve takma adları (`tr_normalize` biçimi), uzundan kısaya. */
export const LAW_ABBREVIATION_TERMS: readonly string[] = [
  ...new Set(
    LAW_ALIASES.flatMap((a) => [a.display, ...a.aliases])
      .filter((n): n is string => n !== null)
      .map((n) => tr_normalize(n))
      .filter((n) => !AMBIGUOUS_ABBREVIATIONS.has(n)),
  ),
].sort((x, y) => y.length - x.length || (x < y ? -1 : x > y ? 1 : 0));

const PROTECTED_SET: ReadonlySet<string> = new Set(PROTECTED_LEGAL_TERMS);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ABBR_RE = new RegExp(
  `(?<![\\p{L}\\d])(?:${LAW_ABBREVIATION_TERMS.map(escapeRe).join('|')})(?![\\p{L}\\d])`,
  'u',
);

/** Girdi `tr_normalize` edilmiş metindir (023 §2.3); en az bir hukuk terimi veya kanun kısaltması var mı. */
export function hasLegalTerm(normalizedText: string): boolean {
  for (const word of normalizedText.match(/\p{L}+/gu) ?? []) {
    if (PROTECTED_SET.has(word)) return true;
  }
  return ABBR_RE.test(normalizedText);
}
