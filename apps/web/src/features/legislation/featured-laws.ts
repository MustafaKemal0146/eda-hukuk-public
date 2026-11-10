// Sık kullanılan kanunlar (053-05 §3.1; 034 §9.1 çalışma listesi): yalnız kanun numaraları. Kanun ADI
// koda gömülmez; çip etiketi @eda/legal kısaltma sözlüğünden (081 §6), sözlükte yoksa numara.
import { lawByNo } from '@eda/legal/kunye';

export const FEATURED_LAWS = [
  '4721',
  '6098',
  '6102',
  '6100',
  '5271',
  '2004',
  '5237',
  '4857',
  '6502',
  '2577',
  '2709',
] as const;

export function featuredLaws(): { lawNo: string; abbr: string | null }[] {
  return FEATURED_LAWS.map((lawNo) => ({ lawNo, abbr: lawByNo(lawNo)?.display ?? null }));
}
