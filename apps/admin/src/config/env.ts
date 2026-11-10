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

/** Sunucu tarafı api adresi (compose iç ağı, `api-admin:8010`); yoksa boş. */
export function readApiInternalUrl(): string {
  return process.env.API_INTERNAL_URL ?? '';
}
