// Daire kodu → görünen ad / kısa ad (081 §4.2; 082 §6 kataloğu gelene dek kod kuralından türetilir).
// Aralıklar 025 §5.3 / 021 §5.7.1: Yargıtay hukuk ve ceza 1–23, Danıştay 1–17.

export type ChamberInfo = { name: string; short: string };

const NAMED: Readonly<Record<string, ChamberInfo>> = {
  HGK: { name: 'Hukuk Genel Kurulu', short: 'HGK' },
  CGK: { name: 'Ceza Genel Kurulu', short: 'CGK' },
  IBK: { name: 'İçtihadı Birleştirme Büyük Genel Kurulu', short: 'İBBGK' },
  BGK: { name: 'İçtihadı Birleştirme Büyük Genel Kurulu', short: 'İBBGK' },
  HBK: { name: 'Hukuk Daireleri Başkanlar Kurulu', short: 'HDBK' },
  CBK: { name: 'Ceza Daireleri Başkanlar Kurulu', short: 'CDBK' },
  IDDK: { name: 'İdare Dava Daireleri Kurulu', short: 'İDDK' },
  VDDK: { name: 'Vergi Dava Daireleri Kurulu', short: 'VDDK' },
  DBGK: { name: 'Büyük Genel Kurul', short: 'DBGK' },
  HUKUK: { name: 'Hukuk Bölümü', short: 'Hukuk Bölümü' },
  CEZA: { name: 'Ceza Bölümü', short: 'Ceza Bölümü' },
  GENEL: { name: 'Genel Kurulu', short: 'Genel Kurulu' },
};

export const CHAMBER_RANGES = { H: 23, C: 23, D: 17 } as const;

/** Bilinen kurul kodu ya da aralık içi daire numarası mı (025 §5.6 `unknown_chamber`). */
export function isKnownChamber(code: string): boolean {
  if (code in NAMED) return true;
  const m = /^([HCD])(\d{1,2})$/.exec(code);
  if (!m?.[1] || !m[2]) return false;
  const n = Number(m[2]);
  return n >= 1 && n <= CHAMBER_RANGES[m[1] as keyof typeof CHAMBER_RANGES];
}

export function chamberInfo(code: string): ChamberInfo | null {
  const named = NAMED[code];
  if (named) return named;
  const m = /^([HCD])(\d{1,2})$/.exec(code);
  if (!m?.[1] || !m[2]) return null;
  const n = m[2];
  if (m[1] === 'H') return { name: `${n}. Hukuk Dairesi`, short: `${n}. HD` };
  if (m[1] === 'C') return { name: `${n}. Ceza Dairesi`, short: `${n}. CD` };
  return { name: `${n}. Daire`, short: `${n}. D.` };
}
