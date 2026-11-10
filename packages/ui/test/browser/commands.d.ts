// Özel tarayıcı komutlarının tipleri (vitest.browser.config.ts).
import 'vitest/browser';

declare module 'vitest/browser' {
  interface BrowserCommands {
    emulateMedia: (options: {
      colorScheme?: 'light' | 'dark' | null;
      reducedMotion?: 'reduce' | 'no-preference' | null;
      forcedColors?: 'active' | 'none' | null;
    }) => Promise<void>;
  }
}
