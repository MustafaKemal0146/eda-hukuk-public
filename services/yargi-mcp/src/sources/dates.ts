// Kaynak tarih biçimleri ↔ ISO (021 Tuzak 9): Bedesten `GG.AA.YYYY` / ISO zaman damgası.

/** `GG.AA.YYYY` veya `GG/AA/YYYY` → `YYYY-MM-DD`; geçersizse null. */
export function trDateToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm}-${dd}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** ISO zaman damgasının gün kısmı (`2026-07-31T11:57:47.000+00:00` → `2026-07-31`). */
export function isoTimestampDay(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(s);
  return m?.[1] ?? null;
}

/** Bedesten tarih süzgeci (canlı doğrulandı 2026-10-10): başlangıç/bitiş UTC gün sınırı. */
export function bedestenRange(from: string | null, to: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (from) out.kararTarihiStart = `${from}T00:00:00.000Z`;
  if (to) out.kararTarihiEnd = `${to}T23:59:59.999Z`;
  return out;
}

export function isoDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
