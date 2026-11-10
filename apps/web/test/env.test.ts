// @tk TK-28
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEdaEnv } from '../src/config/env.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('KK-P00-11: web EDA_ENV okuyucusu', () => {
  it('bilinmeyen değerde en kısıtlayıcı ortama (production) düşer', () => {
    vi.stubEnv('EDA_ENV', 'bilinmeyen');
    expect(readEdaEnv()).toBe('production');
  });

  it('geçerli değeri olduğu gibi döndürür', () => {
    vi.stubEnv('EDA_ENV', 'development');
    expect(readEdaEnv()).toBe('development');
  });
});

describe('tanıtım sayfası: uygulama adresi', () => {
  it('APP_URL sondaki eğik çizgiler atılarak okunur', async () => {
    const { readAppUrl } = await import('../src/config/env.ts');
    vi.stubEnv('APP_URL', 'https://app.eda.localhost:8443/');
    expect(readAppUrl()).toBe('https://app.eda.localhost:8443');
    vi.stubEnv('APP_URL', 'https://app.eda.localhost:8443');
    expect(readAppUrl()).toBe('https://app.eda.localhost:8443');
  });

  it('APP_URL tanımsızsa boş döner (göreli yola düşer)', async () => {
    const { readAppUrl } = await import('../src/config/env.ts');
    vi.stubEnv('APP_URL', '');
    expect(readAppUrl()).toBe('');
  });
});
