// get_decision çıktı biçimi (021 §5.8): bölüm metni üst sınırı aşarsa paragraf sınırında bölünür.
// Bölümleme `@eda/legal/sections` (034 §6) ile yapılır; bu dosya yalnız MCP yanıtını şekillendirir.
import type { DecisionSection } from '@eda/legal/sections';

/** Bölüm > maxChars ise paragraf sınırında bölünür (aynı rol, ardışık numara). */
export function capSections(sections: DecisionSection[], maxChars: number): DecisionSection[] {
  const out: DecisionSection[] = [];
  for (const s of sections) {
    if (s.text.length <= maxChars) {
      out.push(s);
      continue;
    }
    let cur = '';
    for (const para of s.text.split(/\n\n+/)) {
      const pieces = para.length > maxChars ? hardSplit(para, maxChars) : [para];
      for (const p of pieces) {
        if (cur.length > 0 && cur.length + 2 + p.length > maxChars) {
          out.push({ role: s.role, text: cur });
          cur = '';
        }
        cur = cur.length > 0 ? `${cur}\n\n${p}` : p;
      }
    }
    if (cur.length > 0) out.push({ role: s.role, text: cur });
  }
  return out;
}

function hardSplit(s: string, max: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    const cut = rest.lastIndexOf(' ', max);
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest.length > 0) out.push(rest);
  return out;
}
