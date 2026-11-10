// Ek gerçekleme (026 §7.5 (3)): kesmeli özel ad biçiminde gövde değişmez (yumuşama yok); yalnız ek
// gövdenin son sesine göre kurulur.
import type { Morpheme } from './morphemes.ts';
import { harmony2, harmony4, type StemInfo, type Vowel } from './phonology.ts';

interface State extends StemInfo {
  afterPoss3: boolean;
}

export function realizeChain(chain: readonly Morpheme[], stem: StemInfo): string {
  let st: State = { ...stem, afterPoss3: false };
  let out = '';
  const set = (
    s: string,
    lastVowel: Vowel,
    endsWithVowel: boolean,
    hardEnd: boolean,
    p = false,
  ) => {
    out += s;
    st = { lastVowel, endsWithVowel, hardEnd, afterPoss3: p };
  };
  for (const m of chain) {
    const a2 = harmony2(st.lastVowel);
    const i4 = harmony4(st.lastVowel);
    switch (m) {
      case 'PLURAL':
        set(`l${a2}r`, a2, false, false);
        break;
      case 'POSS3':
        set(st.endsWithVowel ? `s${i4}` : i4, i4, true, false, true);
        break;
      case 'GEN':
        set(`${st.endsWithVowel ? 'n' : ''}${i4}n`, i4, false, false);
        break;
      case 'DAT':
        set(`${st.afterPoss3 ? 'n' : st.endsWithVowel ? 'y' : ''}${a2}`, a2, true, false);
        break;
      case 'ACC':
        set(`${st.afterPoss3 ? 'n' : st.endsWithVowel ? 'y' : ''}${i4}`, i4, true, false);
        break;
      case 'LOC':
        set(`${st.afterPoss3 ? 'nd' : st.hardEnd ? 't' : 'd'}${a2}`, a2, true, false);
        break;
      case 'ABL':
        set(`${st.afterPoss3 ? 'nd' : st.hardEnd ? 't' : 'd'}${a2}n`, a2, false, false);
        break;
      case 'INS':
        set(`${st.endsWithVowel ? 'y' : ''}l${a2}`, a2, true, false);
        break;
      case 'COP':
        set(`${st.hardEnd ? 't' : 'd'}${i4}r`, i4, false, false);
        break;
      case 'KI':
        set('ki', 'i', true, false);
        break;
    }
  }
  return out;
}
