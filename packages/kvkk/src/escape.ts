// Token taklidi kaçışlaması (026 §7.6.2): girdide `\[(TIP)_[A-Z2-7]{4,6}\]` gramerine uyan her dizinin
// (ASCII büyük/küçük harf duyarsız) açan köşeli parantezi tam genişlikli "［" (U+FF3B) olur. Kaçışlanmış
// dizi geri çözme gramerine uymaz ve olduğu gibi akar. Kaynak etiketleri ([K3]) gramere uymaz.
import { escapeRegex } from './tokens/grammar.ts';

export const ESCAPE_BRACKET = '\uFF3B';

export function escapeTokenLike(text: string): { text: string; escaped: number } {
  let escaped = 0;
  const out = text.replace(escapeRegex(), (m) => {
    escaped += 1;
    return `${ESCAPE_BRACKET}${m.slice(1)}`;
  });
  return { text: out, escaped };
}

/** Kaçışlanmış dizilerin aralıkları (korunan bölge; algılayıcı aday üretmez). */
export function escapedRanges(text: string): [number, number][] {
  const rx = escapeRegex();
  const out: [number, number][] = [];
  const probe = text.replaceAll(ESCAPE_BRACKET, '[');
  for (const m of probe.matchAll(rx)) {
    if (text.charAt(m.index) === ESCAPE_BRACKET) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}
