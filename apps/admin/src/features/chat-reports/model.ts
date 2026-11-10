// Sohbet raporu görünüm modeli: saf fonksiyonlar (arayüzsüz, test edilebilir). Yalnız sayı üzerinde çalışır.
import type {
  ChatReportDailyDtoValue,
  ChatReportsResponseValue,
} from '@eda/contracts/api/admin-chat-reports';

export const CHAT_REPORT_RANGES = [7, 30, 90] as const;
export type ChatReportRange = (typeof CHAT_REPORT_RANGES)[number];

/** Sunucu üst sınırı (92 gün) ile aynı; istemci de aşmaz. */
export const CHAT_REPORT_MAX_DAYS = 92;

export type DailyMetric =
  | 'conversations'
  | 'messages'
  | 'turns'
  | 'turnErrors'
  | 'activeOrgs'
  | 'feedbackUp'
  | 'feedbackDown';

export const DAILY_METRICS: readonly DailyMetric[] = [
  'conversations',
  'messages',
  'turns',
  'turnErrors',
  'activeOrgs',
  'feedbackUp',
  'feedbackDown',
];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function rangeQuery(days: number, today: Date = new Date()): string {
  const span = Math.min(Math.max(days, 1), CHAT_REPORT_MAX_DAYS);
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (span - 1));
  return `from=${isoDay(from)}&to=${isoDay(today)}`;
}

export function sumDaily(daily: readonly ChatReportDailyDtoValue[], key: DailyMetric): number {
  return daily.reduce((n, d) => n + d[key], 0);
}

/** Tur ağırlıklı ortalama tur süresi (saniye); veri yoksa null. */
export function weightedAvgTurnSeconds(daily: readonly ChatReportDailyDtoValue[]): number | null {
  let total = 0;
  let weight = 0;
  for (const d of daily) {
    if (d.avgTurnSeconds === null) continue;
    total += d.avgTurnSeconds * d.turns;
    weight += d.turns;
  }
  return weight === 0 ? null : total / weight;
}

/** Oran (0..1); payda 0 ise null. */
export function share(part: number, whole: number): number | null {
  return whole <= 0 ? null : part / whole;
}

export function toolErrorTotals(tools: ChatReportsResponseValue['tools']): {
  calls: number;
  errors: number;
} {
  return tools.reduce((a, t) => ({ calls: a.calls + t.calls, errors: a.errors + t.errors }), {
    calls: 0,
    errors: 0,
  });
}
