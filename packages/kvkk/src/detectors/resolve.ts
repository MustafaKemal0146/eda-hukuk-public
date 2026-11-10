// Çakışma çözümü (026 §6.1): adaylar (öncelik azalan, uzunluk azalan, başlangıç artan) sırayla kabul
// edilir; kabul edilmiş bir adayla kısmen/tamamen örtüşen aday tümüyle atılır (bölünmez). Korunan
// aralıklar (kaçışlanmış token, preMasked tokenlar) hiçbir adaya verilmez.
import type { Candidate } from './candidate.ts';

function compare(a: Candidate, b: Candidate): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const la = a.end - a.start;
  const lb = b.end - b.start;
  if (la !== lb) return lb - la;
  if (a.start !== b.start) return a.start - b.start;
  // Tam eşitlikte determinizm: tip ve kaynak adına göre.
  const ka = `${a.tip}\u0000${a.source}\u0000${a.identity ?? ''}`;
  const kb = `${b.tip}\u0000${b.source}\u0000${b.identity ?? ''}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export function resolveCandidates(
  candidates: readonly Candidate[],
  length: number,
  occupied?: Uint8Array,
): Candidate[] {
  const taken = occupied ? occupied.slice() : new Uint8Array(length);
  const sorted = [...candidates].filter((c) => c.end > c.start).sort(compare);
  const accepted: Candidate[] = [];
  for (const c of sorted) {
    const s = c.start;
    const e = c.suffix ? Math.max(c.end, c.suffix.end) : c.end;
    let free = true;
    for (let i = s; i < e; i += 1) {
      if (taken[i] === 1) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    for (let i = s; i < e; i += 1) taken[i] = 1;
    accepted.push(c);
  }
  return accepted.sort((a, b) => a.start - b.start);
}
