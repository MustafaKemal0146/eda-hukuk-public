// @tk TK-28
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEdaEnv } from '../src/config/env.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('KK-P00-11: admin EDA_ENV okuyucusu', () => {
  it('bilinmeyen değerde en kısıtlayıcı ortama (production) düşer', () => {
    vi.stubEnv('EDA_ENV', 'bilinmeyen');
    expect(readEdaEnv()).toBe('production');
  });

  it('geçerli değeri olduğu gibi döndürür', () => {
    vi.stubEnv('EDA_ENV', 'development');
    expect(readEdaEnv()).toBe('development');
  });
});
