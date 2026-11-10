// @tk TK-33
import { describe, expect, it } from 'vitest';
import { isKitchenSinkEnabled } from '../src/features/shell/kitchen-sink/enabled.ts';

describe('KK-P05-24 (KK-013-10 birim yarısı): vitrin yalnız development ortamında açılır', () => {
  it('development -> açık', () => {
    expect(isKitchenSinkEnabled('development')).toBe(true);
  });

  it('diğer tüm ortamlar -> kapalı', () => {
    for (const env of ['test', 'staging', 'beta-synthetic', 'production', 'onprem'] as const) {
      expect(isKitchenSinkEnabled(env), env).toBe(false);
    }
  });
});
