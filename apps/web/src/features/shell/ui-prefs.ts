// Arayüz tercihleri (051 §14): `__Host-eda.ui` çerezi `t=<tema>&d=<yoğunluk>`; içeriksiz işlevsel tercih.
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];
export type UiPrefs = { theme: Theme; density: Density };

export const UI_COOKIE = '__Host-eda.ui';
const MAX_AGE_SEC = 365 * 24 * 60 * 60;

export function parseUiPrefs(raw: string | undefined): UiPrefs {
  const params = new URLSearchParams(raw ?? '');
  const t = params.get('t');
  const d = params.get('d');
  return {
    theme: (THEMES as readonly string[]).includes(t ?? '') ? (t as Theme) : 'system',
    density: (DENSITIES as readonly string[]).includes(d ?? '') ? (d as Density) : 'comfortable',
  };
}

export function serializeUiPrefs(prefs: UiPrefs): string {
  return new URLSearchParams({ t: prefs.theme, d: prefs.density }).toString();
}

/** Tercih değiştiğinde yayılan olay adı; birden çok denetim (tema menüsü, ayarlar, palet) aynı
 * durumu paylaşır. Durumun tek kaynağı kök özniteliğidir; bu olay yalnız aboneleri uyarır. */
const CHANGE_EVENT = 'eda:ui-prefs';

/** Yalnız tarayıcıda: kök özniteliği ve çerezi aynı anda günceller (satır içi betik yok). */
export function applyUiPrefs(prefs: UiPrefs): void {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme;
  root.dataset.density = prefs.density;
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API her tarayıcıda yok; çerez yalnız arayüz tercihi taşır.
  document.cookie = `${UI_COOKIE}=${encodeURIComponent(serializeUiPrefs(prefs))}; Path=/; Max-Age=${MAX_AGE_SEC}; SameSite=Lax; Secure`;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** `applyUiPrefs` ile değişen tercihleri dinler; dönen işlev aboneliği kaldırır. */
export function subscribeUiPrefs(listener: (prefs: UiPrefs) => void): () => void {
  const handler = (): void => listener(readUiPrefs());
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function readUiPrefs(): UiPrefs {
  const root = document.documentElement;
  return parseUiPrefs(`t=${root.dataset.theme ?? ''}&d=${root.dataset.density ?? ''}`);
}
