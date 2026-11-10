// Kanonik numara ve tarih (025 §5.5, 081 §3). `canonicalizeCaseNo` tek kaynaktır: korpus alımı (034)
// ve sorgu hazırlığı (023) bu işlevi içe aktarır.
import { tr_normalize } from '../text/normalize.ts';

export type CanonNo = {
  year: number;
  group: number | null;
  seq: number;
  canon: string;
  literal: string;
};

export function canonicalizeCaseNo(
  year: number,
  seq: number,
  group: number | null = null,
  literal?: string,
): CanonNo {
  const canon = group === null ? `${year}/${seq}` : `${year}/${group}-${seq}`;
  return { year, group, seq, canon, literal: literal ?? canon };
}

/** "2024/0123", "2023/3-451", "2018/(13)-1076" → kanonik; biçim dışı `null`. */
export function parseCaseNo(text: string): CanonNo | null {
  const m = /^\s*((?:19|20)\d{2})\s*\/\s*(?:\(?(\d{1,2})\)?\s*-\s*)?(\d{1,7})\s*$/u.exec(text);
  if (!m?.[1] || !m[3]) return null;
  return canonicalizeCaseNo(
    Number(m[1]),
    Number(m[3]),
    m[2] === undefined ? null : Number(m[2]),
    text.trim(),
  );
}

export type CaseNoWarning = 'esas_year_2digit' | 'unparsed';

export type ParsedCaseNoText = {
  /** Esas (AYM bireysel başvuruda başvuru numarası `esas_no` kolonuna yazılır; 034 §8.2). */
  esas: CanonNo | null;
  karar: CanonNo | null;
  /** `B. No:` etiketi görüldü (AYM bireysel başvuru). */
  basvuru: boolean;
  warnings: CaseNoWarning[];
};

const NO_BODY = String.raw`(?<![\d/])(\d{2,4})\s*[/-]\s*(?:\(?(\d{1,2})\)?\s*-\s*)?(\d{1,7})`;
const LABELLED = new RegExp(
  String.raw`(?:(?<!\p{L})(b\.?\s*no|başvuru\s+no|esas\s+no|karar\s+no|esas|karar|e|k)\s*[:.]?\s*)?${NO_BODY}(?:\s*(e|k|esas|karar)\b\.?)?`,
  'gu',
);

/**
 * Ham numara metni → kanonik esas / karar (034 §8.2 tablosu; KK-034-9). Ayırıcı yalnız `/` üretilir
 * (`2024 / 1234`, `2024-1234` düzeltilir); `E.`, `K.`, `Esas No:`, `B. No:` etiketleri soyulur; sıra
 * numarasının baştaki sıfırları atılır. İki haneli yıl (`99/123`) dönüştürülmez: `esas_year_2digit`
 * uyarısı, numara `null` (künye hash'i üretilmez). Etiketsiz tek numara `role` alanına yazılır.
 * Kanonik biçimi tek işlev `canonicalizeCaseNo` üretir (K5; ikinci kopya yok).
 */
export function parseCaseNoText(raw: string, role: 'esas' | 'karar' = 'esas'): ParsedCaseNoText {
  const out: ParsedCaseNoText = { esas: null, karar: null, basvuru: false, warnings: [] };
  const norm = tr_normalize(raw);
  let matched = false;
  for (const m of norm.matchAll(LABELLED)) {
    matched = true;
    const pre = m[1]?.replace(/\s+/g, ' ') ?? null;
    const suf = m[5] ?? null;
    const label = pre ?? suf;
    const isBasvuru = pre !== null && (pre.startsWith('b') || pre.startsWith('başvuru'));
    const kind: 'esas' | 'karar' = label === null ? role : label.startsWith('k') ? 'karar' : 'esas';
    if (isBasvuru) out.basvuru = true;
    const yearText = m[2] ?? '';
    if (yearText.length !== 4 || !/^(19|20)\d{2}$/.test(yearText)) {
      if (yearText.length === 2 && !out.warnings.includes('esas_year_2digit')) {
        out.warnings.push('esas_year_2digit');
      }
      continue;
    }
    const canon = canonicalizeCaseNo(
      Number(yearText),
      Number(m[4]),
      m[3] === undefined ? null : Number(m[3]),
      raw.trim(),
    );
    if (out[kind] === null) out[kind] = canon;
  }
  if (!matched) out.warnings.push('unparsed');
  return out;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function daysInMonth(y: number, m: number): number {
  return (
    [
      31,
      y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ][m - 1] ?? 0
  );
}

/** Gün/ay/yıl → ISO; takvim dışı `null` (2 haneli yıl kabul edilmez). */
export function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2099 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** 081 KK-081-2: "2025-03-12" → "12.03.2025"; Intl/toLocale kullanılmaz; geçersiz ISO hata. */
export function formatDateTr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m?.[1] || !m[2] || !m[3] || isoDate(Number(m[1]), Number(m[2]), Number(m[3])) === null) {
    throw new Error(`Geçersiz ISO tarih: ${iso}`);
  }
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export const TR_MONTHS = [
  'ocak',
  'şubat',
  'mart',
  'nisan',
  'mayıs',
  'haziran',
  'temmuz',
  'ağustos',
  'eylül',
  'ekim',
  'kasım',
  'aralık',
] as const;

/** "12.03.2025" (GG.AA.YYYY; tek haneli gün/ay kabul) → ISO; takvim dışı `null` (081 §3.2). */
export function parseDateTr(text: string): string | null {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(text);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
}

/** 034 §3.2 karar tarihi aralığı alt sınırı. */
export const DECISION_DATE_MIN = '1920-01-01';

/** ISO günü bir gün ileri alır (takvim hesabı; saat dilimi yok). */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  if (d < daysInMonth(y, m)) return `${y}-${pad(m)}-${pad(d + 1)}`;
  if (m < 12) return `${y}-${pad(m + 1)}-01`;
  return `${y + 1}-01-01`;
}

/**
 * Karar tarihi makul mü (034 §3.2, §4.4 `invalid_date`): geçerli ISO takvim günü ve
 * [1920-01-01, bugün + 1 gün] aralığında. `today` çağırandan gelir (Europe/Istanbul günü; saflık).
 */
export function isPlausibleDecisionDate(iso: string, today: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m?.[1] || !m[2] || !m[3]) return false;
  if (isoDate(Number(m[1]), Number(m[2]), Number(m[3])) === null) return false;
  return iso >= DECISION_DATE_MIN && iso <= nextDay(today);
}
