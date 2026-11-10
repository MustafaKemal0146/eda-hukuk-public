// Tarayıcı testleri (P05.15): gerçek Chromium (Playwright 1.64; ci imajı) üzerinde Vitest Browser Mode.
// `pnpm --filter @eda/ui test:e2e` yalnız test-runner/ci imajında koşar (tarayıcı ikilisi orada).
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';

type MediaOptions = {
  colorScheme?: 'light' | 'dark' | null;
  reducedMotion?: 'reduce' | 'no-preference' | null;
  forcedColors?: 'active' | 'none' | null;
};

/** Medya emülasyonu (051 §10.2, §13.3, §14): Playwright sayfasında emulateMedia. */
const emulateMedia: BrowserCommand<[MediaOptions]> = async (ctx, options) => {
  if (ctx.provider.name !== 'playwright') throw new Error('emulateMedia yalnız Playwright ile');
  await ctx.page.emulateMedia(options);
};

export default defineConfig({
  test: {
    include: ['test/browser/**/*.browser.test.tsx'],
    setupFiles: ['test/browser/setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { args: ['--font-render-hinting=none'] } }),
      instances: [
        {
          browser: 'chromium',
          exclude: ['**/node_modules/**', 'test/browser/**/*.touch.browser.test.tsx'],
        },
        {
          // Kaba işaretçi (pointer: coarse) emülasyonu: dokunmatik bağlam (KK-P05-12).
          browser: 'chromium',
          name: 'chromium-dokunmatik',
          include: ['test/browser/**/*.touch.browser.test.tsx'],
          provider: playwright({ contextOptions: { hasTouch: true, isMobile: true } }),
        },
      ],
      viewport: { width: 1280, height: 800 },
      commands: { emulateMedia },
    },
  },
});
