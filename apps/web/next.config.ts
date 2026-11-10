import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  transpilePackages: [
    '@eda/contracts',
    '@eda/ui',
    '@eda/api-client',
    '@eda/editor',
    '@eda/kvkk',
    '@eda/legal',
  ],
  // Yalnız `next dev` (hot profil): Caddy arkasındaki alan adı ve yerel önizleme HMR'ye erişebilir.
  allowedDevOrigins: ['app.eda.localhost', '127.0.0.1'],
  cacheComponents: false,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withNextIntl(config);
