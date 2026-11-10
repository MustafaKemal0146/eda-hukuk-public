// Çıktı biçimleme (083 §5.3 `toIstanbulIso`, İ9; KK-083-13/14). Intl yalnız bu dosyada ve yalnız
// saat dilimi ofsetini okumak için kullanılır; tarih aritmetiği yapılmaz (P22.4 statik tarama istisnası).
import { type CivilDay, toIso } from './civil-date.ts';

export const DEADLINE_TIME_ZONE = 'Europe/Istanbul';

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DEADLINE_TIME_ZONE,
  timeZoneName: 'longOffset',
});

/** Verilen UTC anında İstanbul ofseti (dakika). "GMT+03:00" -> 180; "GMT" -> 0. */
function offsetMinutesAt(utcMs: number): number {
  const part = offsetFormatter.formatToParts(utcMs).find((p) => p.type === 'timeZoneName');
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(part?.value ?? '');
  if (m === null) throw new Error('Saat dilimi ofseti okunamadı.');
  if (m[1] === undefined) return 0;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -v : v;
}

function formatOffset(min: number): string {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

export function parseLocalTime(hhmm: string): number {
  const m = TIME_RE.exec(hhmm);
  if (m === null) throw new RangeError(`Geçersiz saat: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Sivil gün + yerel saat -> ofsetli ISO 8601 (`2026-03-19T13:00:00+03:00`). Ofset, yerel duvar
 * saatinin denk geldiği andaki İstanbul ofsetidir (iki geçişli çözüm).
 */
export function toIstanbulIso(day: CivilDay, hhmm: string): string {
  const wallMs = day * MS_PER_DAY + parseLocalTime(hhmm) * MS_PER_MIN;
  const first = offsetMinutesAt(wallMs);
  const offset = offsetMinutesAt(wallMs - first * MS_PER_MIN);
  return `${toIso(day)}T${hhmm}:00${formatOffset(offset)}`;
}

/** Anahtarları özyinelemeli sıralı JSON (parmak izi girdisi ve bayt eşitliği denetimi). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}
