// @tk TK-33
// KK-P05-12 (KK-051-12, KK-055-9) dokunmatik yarısı: pointer: coarse altında etkileşimli hedefler
// >= 44 x 44 px (etiketli denetimde etiket hedeftir; satır içi bağlantı muaf).
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { ComponentShowcase } from '../../src/showcase/showcase.tsx';

describe('KK-P05-12 (KK-051-12): kaba işaretçide hedef >= 44 x 44 px', () => {
  it('vitrin', async () => {
    await page.viewport(1280, 800);
    expect(matchMedia('(pointer: coarse)').matches).toBe(true);
    const screen = await render(<ComponentShowcase />);
    const targets = [
      ...screen.container.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="switch"], [role="checkbox"], [role="radio"]',
      ),
    ].filter(
      (el) =>
        el.getClientRects().length > 0 &&
        !el.closest('.sr-only, [aria-hidden="true"]') &&
        el.tabIndex !== -1 &&
        getComputedStyle(el).display !== 'inline',
    );
    expect(targets.length).toBeGreaterThan(40);
    const small: string[] = [];
    for (const el of targets) {
      const target = el.closest('label') ?? el;
      const r = target.getBoundingClientRect();
      if (Math.round(r.height) < 44 || Math.round(r.width) < 44) {
        small.push(`${Math.round(r.width)}x${Math.round(r.height)} ${el.outerHTML.slice(0, 90)}`);
      }
    }
    expect(small.join('\n')).toBe('');
  });
});
