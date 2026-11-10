// Env tek okuma noktası (noProcessEnv istisnası). Yalnız sunucu tarafında okunur.
const EDA_ENVS = [
  'development',
  'test',
  'staging',
  'beta-synthetic',
  'production',
  'onprem',
] as const;
export type EdaEnv = (typeof EDA_ENVS)[number];

export function readEdaEnv(): EdaEnv {
  const raw = process.env.EDA_ENV ?? 'production';
  return (EDA_ENVS as readonly string[]).includes(raw) ? (raw as EdaEnv) : 'production';
}

/**
 * Uygulama alanının kök adresi (`APP_URL`, örn. `https://app.eda.localhost:8443`). Tanıtım sayfası
 * ayrı alan adında sunulduğu için uygulama bağlantıları mutlak olmalıdır. Sondaki eğik çizgi atılır.
 * Tanımsızsa boş döner; çağıran göreli yola düşer.
 */
export function readAppUrl(): string {
  return (process.env.APP_URL ?? '').replace(/\/+$/, '');
}

/** Sunucu tarafı api adresi (compose iç ağı); yoksa boş. */
export function readApiInternalUrl(): string {
  return process.env.API_INTERNAL_URL ?? '';
}
