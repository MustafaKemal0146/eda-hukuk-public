// Tarayıcı kimliğinden (User-Agent) okunur cihaz etiketi: "Chrome · Windows". Saf işlev; tanınmayan
// dizgide genel etikete düşer. Yalnız gösterim içindir; güvenlik kararı vermez.

export type DeviceInfo = {
  browser: string | null;
  os: string | null;
  mobile: boolean;
};

const BROWSERS: readonly [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/YaBrowser\//, 'Yandex'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/Windows NT/, 'Windows'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

export function deviceOf(ua: string | null): DeviceInfo {
  if (ua === null || ua.trim() === '') return { browser: null, os: null, mobile: false };
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null;
  return { browser, os, mobile: /Mobile|iPhone|Android.*Mobile/.test(ua) };
}

export function deviceLabel(ua: string | null, unknown: string): string {
  const d = deviceOf(ua);
  const parts = [d.browser, d.os].filter((p): p is string => p !== null);
  return parts.length === 0 ? unknown : parts.join(' · ');
}
