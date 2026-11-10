// Köken bazlı politika (026 §5). Köken etiketi hazırlayıcı tarafından yazılır; etiketsiz parça
// `user_text` (en sıkı) sayılır. Serbest (sözlük dışı) "2024/118 E." biçimli numaralar hiçbir kökende
// maskelenmez (Künye Kilidi girdisi bozulmasın; bilinçli artık risk).
import type { OriginKind, Tip } from '../types.ts';

export interface OriginPolicy {
  dictionary: boolean;
  /** Sözlükteki DOSYA kayıtları (müvekkilin kendi dosya numarası). */
  dictionaryDosya: boolean;
  learned: boolean;
  /** IBAN, EPOSTA, TCKN, TEL, PLAKA, TARIH_DOGUM (bağlamlı). */
  strongPatterns: boolean;
  /** VKN bağlam sözcüğü olmadan da (orta güven). */
  vknWithoutContext: boolean;
  health: boolean;
  /** SIRKET, ADRES, KISI sezgileri. */
  heuristics: boolean;
}

const USER_LIKE: ReadonlySet<OriginKind> = new Set([
  'user_text',
  'attachment',
  'file_mention',
  'case_binding',
  'case_tool_result',
]);

export function policyFor(origin: OriginKind): OriginPolicy {
  const userLike = USER_LIKE.has(origin);
  const publicSource = origin === 'corpus' || origin === 'live_source';
  return {
    dictionary: true,
    dictionaryDosya: !publicSource,
    learned: true,
    strongPatterns: true,
    vknWithoutContext: userLike,
    health: userLike,
    heuristics: userLike,
  };
}

/** verifyMasked ve `standard` algılama: sıkı yapısal tipler (026 §7.6.3, §7.7). */
export const STRICT_STRUCTURAL: ReadonlySet<Tip> = new Set([
  'IBAN',
  'EPOSTA',
  'TCKN',
  'TEL',
  'VKN',
  'PLAKA',
]);
