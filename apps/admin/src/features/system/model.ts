// Sistem ekranı saf modeli: durum -> ton/simge eşlemesi, bayt biçimi, kuyruk toplamı. Arayüz bağımsızdır.
import type { AdminSystemDtoValue, SystemServiceKey } from '@eda/contracts/api/admin-system';

export type ServiceState = AdminSystemDtoValue['services'][number]['state'];

export const STATE_TONE = {
  ok: 'success',
  degraded: 'warning',
  fail: 'danger',
} as const satisfies Record<ServiceState, 'success' | 'warning' | 'danger'>;

/** Renk tek başına anlam taşımaz: her duruma ayrı simge. */
export const STATE_ICON = {
  ok: 'status.verified',
  degraded: 'notice.warning',
  fail: 'notice.error',
} as const satisfies Record<ServiceState, string>;

/** Hepsi ok: ok; sert bağımlılık düştüyse fail; aksi degraded. */
export function overallState(services: readonly { state: ServiceState }[]): ServiceState {
  if (services.some((s) => s.state === 'fail')) return 'fail';
  if (services.some((s) => s.state === 'degraded')) return 'degraded';
  return 'ok';
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** İkili katlar (1024); en çok bir ondalık. */
export function formatBytes(bytes: number): { value: number; unit: (typeof UNITS)[number] } {
  let v = Math.max(0, bytes);
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  return { value: Math.round(v * 10) / 10, unit: UNITS[i] ?? 'B' };
}

export function queueTotals(items: AdminSystemDtoValue['queues']['items']) {
  return items.reduce(
    (a, q) => ({
      waiting: a.waiting + q.waiting,
      active: a.active + q.active,
      failed: a.failed + q.failed,
      delayed: a.delayed + q.delayed,
    }),
    { waiting: 0, active: 0, failed: 0, delayed: 0 },
  );
}

export const SERVICE_ORDER: readonly SystemServiceKey[] = [
  'postgres',
  'valkey',
  'valkeyCache',
  'objstore',
  'embedQuery',
  'yargiMcp',
];

export type BackupDto = AdminSystemDtoValue['backup'];
export type BackupOverall = NonNullable<BackupDto['overall']>;

/** Yedek genel kararı -> ton/simge (renk tek başına anlam taşımaz). */
export const BACKUP_TONE = {
  ok: 'success',
  degraded: 'warning',
  error: 'danger',
} as const satisfies Record<BackupOverall, 'success' | 'warning' | 'danger'>;

export const BACKUP_ICON = {
  ok: 'status.verified',
  degraded: 'notice.warning',
  error: 'notice.error',
} as const satisfies Record<BackupOverall, string>;

/** WAL arşiv gecikmesi dakika olarak (yukarı yuvarlanmaz); kayıtta yoksa `null`. */
export const walLagMinutes = (b: BackupDto): number | null =>
  b.walLagSeconds === null ? null : Math.floor(b.walLagSeconds / 60);

export type SourceCanaryDto = AdminSystemDtoValue['sourceCanary'];
export type SourceProbeDto = SourceCanaryDto['items'][number];
export type ProbeState = SourceProbeDto['state'];

/** Kaynak yoklaması rozeti: yeşil (son kontrol başarılı) / kırmızı (başarısız) / nötr (kontrol yok). */
export const PROBE_TONE = {
  ok: 'success',
  failing: 'danger',
  unknown: 'neutral',
} as const satisfies Record<ProbeState, 'success' | 'danger' | 'neutral'>;

export const PROBE_ICON = {
  ok: 'status.verified',
  failing: 'notice.error',
  unknown: 'notice.info',
} as const satisfies Record<ProbeState, string>;

/** Başarı oranı yüzde (tam sayı, aşağı yuvarlanır: 0,999 oranı 99 olur); pencere boşsa `null`. */
export const successPercent = (p: SourceProbeDto): number | null =>
  p.successRate === null ? null : Math.floor(p.successRate * 100);
