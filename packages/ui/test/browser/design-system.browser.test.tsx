// @tk TK-33
// P05.15 tarayıcı testleri: gerçek Chromium'da tasarım sistemi sözleşmeleri (051 §10, §13, §14; 052 §1.4).
import { beforeEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { ComponentShowcase as Gallery } from '../../src/showcase/showcase.tsx';
import { seriousViolations } from './axe.ts';

const root = document.documentElement;
const THEMES = ['light', 'dark'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;

function interactive(scope: Element): HTMLElement[] {
  return [
    ...scope.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="switch"], [role="checkbox"], [role="radio"]',
    ),
  ].filter(
    (el) =>
      el.getClientRects().length > 0 &&
      !el.closest('.sr-only, [aria-hidden="true"]') &&
      el.tabIndex !== -1,
  );
}

function luminance(rgb: string): number {
  const [r = 0, g = 0, b = 0] = (rgb.match(/[\d.]+/g) ?? []).map(Number);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

beforeEach(async () => {
  root.dataset.theme = 'light';
  root.dataset.density = 'comfortable';
  await commands.emulateMedia({ colorScheme: 'light', reducedMotion: null, forcedColors: null });
  await page.viewport(1280, 800);
});

describe('KK-P05-5 (KK-051-5, KK-052-1): axe kritik/ciddi ihlal 0, iki tema x iki yoğunluk', () => {
  for (const theme of THEMES) {
    for (const density of DENSITIES) {
      it(`${theme} / ${density}`, async () => {
        root.dataset.theme = theme;
        root.dataset.density = density;
        const screen = await render(<Gallery />);
        expect(JSON.stringify(await seriousViolations(screen.container), null, 1)).toBe('[]');
      });
    }
  }
});

describe('KK-P05-6 (KK-051-6): azaltılmış hareket', () => {
  it('animasyon yok, geçiş <= 0.01 ms', async () => {
    await commands.emulateMedia({ reducedMotion: 'reduce' });
    const screen = await render(<Gallery />);
    for (const el of screen.container.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      expect(style.animationName, el.className.toString()).toBe('none');
      for (const d of style.transitionDuration.split(',')) {
        expect(Number.parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000)).toBeLessThanOrEqual(
          0.01,
        );
      }
    }
  });
});

describe('KK-P05-8 (KK-051-8): odak halkası >= 2 px ve komşu yüzeyle >= 3:1', () => {
  for (const theme of THEMES) {
    it(theme, async () => {
      root.dataset.theme = theme;
      const screen = await render(<Gallery />);
      const targets = new Set(interactive(screen.container));
      let visited = 0;
      // Klavye ile gez (Tab): :focus-visible yalnız klavye odağında uygulanır.
      for (let i = 0; i < 80; i += 1) {
        await userEvent.keyboard('{Tab}');
        const el = document.activeElement as HTMLElement | null;
        if (!el || !targets.has(el)) continue;
        visited += 1;
        // Halka rengi duration-fast (120 ms) ile geçer; geçiş bitince ölçülür.
        await new Promise((resolve) => setTimeout(resolve, 150));
        // Kart biçimli seçimde (RadioCard) halka kapsayan etikettedir (has-focus-visible).
        const own = getComputedStyle(el);
        const ringEl = own.outlineStyle === 'none' ? (el.closest('label') ?? el) : el;
        const style = getComputedStyle(ringEl);
        // Komşu yüzey: öğenin bulunduğu tema bölümünün zemini (vitrin iki tema bölümü içerir).
        const surface = getComputedStyle(
          el.closest('[data-theme]') ?? document.body,
        ).backgroundColor;
        const info = `${el.tagName} type=${el.getAttribute('type')} fv=${el.matches(':focus-visible')} ${el.closest('[data-theme]')?.getAttribute('data-theme')} ${el.parentElement?.outerHTML.slice(0, 160)}`;
        expect(style.outlineStyle, info).not.toBe('none');
        const ring = Number.parseFloat(style.outlineWidth);
        expect(ring, el.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(2);
        const where = `${el.outerHTML.slice(0, 80)} ${style.outlineStyle} ${style.outlineColor} ${surface}`;
        expect(contrast(style.outlineColor, surface), where).toBeGreaterThanOrEqual(3);
      }
      expect(visited).toBeGreaterThan(20);
    });
  }
});

describe('KK-P05-9 (KK-051-9 CSS yarısı): sistem teması', () => {
  it('data-theme=system + prefers-color-scheme: dark koyu tokenları uygular', async () => {
    root.dataset.theme = 'system';
    await commands.emulateMedia({ colorScheme: 'light' });
    const light = getComputedStyle(document.body).backgroundColor;
    await commands.emulateMedia({ colorScheme: 'dark' });
    const dark = getComputedStyle(document.body).backgroundColor;
    expect(luminance(light)).toBeGreaterThan(0.8);
    expect(luminance(dark)).toBeLessThan(0.02);
    expect(root.lang).toBe('tr');
  });
});

describe('KK-P05-11 (KK-051-11): ekran metni >= 12 px', () => {
  it('gövde 16/24, hiçbir metin 12 px altında değil', async () => {
    const screen = await render(<Gallery />);
    const body = getComputedStyle(document.body);
    expect(body.fontSize).toBe('16px');
    expect(body.lineHeight).toBe('24px');
    const walker = document.createTreeWalker(screen.container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || n.textContent?.trim() === '' || el.closest('.sr-only')) continue;
      expect(
        Number.parseFloat(getComputedStyle(el).fontSize),
        el.outerHTML.slice(0, 80),
      ).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('KK-P05-12 (KK-051-12): hedef boyutu', () => {
  it('ince işaretçide >= 24 x 24 px', async () => {
    const screen = await render(<Gallery />);
    for (const el of interactive(screen.container)) {
      // Etiketin içindeki denetimde tıklanabilir hedef etikettir (WCAG 2.5.8).
      const target = el.closest('label') ?? el;
      const r = target.getBoundingClientRect();
      const inline = getComputedStyle(el).display === 'inline';
      if (inline) continue;
      expect(Math.round(r.height), el.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(24);
      expect(Math.round(r.width), el.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(24);
    }
  });
});

describe('KK-P05-15 (KK-051-15): forced-colors', () => {
  it('düğme, çip ve rozet 1 px kenarlık taşır', async () => {
    await commands.emulateMedia({ forcedColors: 'active' });
    const screen = await render(<Gallery />);
    const nodes = screen.container.querySelectorAll<HTMLElement>(
      'button, [data-slot="chip"], [data-tone]',
    );
    expect(nodes.length).toBeGreaterThan(20);
    for (const el of nodes) {
      if (el.closest('.sr-only') || el.getClientRects().length === 0) continue;
      expect(
        Number.parseFloat(getComputedStyle(el).borderTopWidth),
        el.outerHTML.slice(0, 80),
      ).toBeGreaterThan(0);
    }
  });
});

describe('KK-P05-16 (KK-051-16): 320 CSS px yeniden akış', () => {
  it('yatay kaydırma yok', async () => {
    await page.viewport(320, 800);
    await render(<Gallery />);
    const wide = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => {
        if (el.getBoundingClientRect().right <= 321 || el.closest('[data-reflow-exempt]'))
          return false;
        // Kendi kaydırma kabı olan öğeler (tablo kabı) sayfayı taşırmaz.
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(p).overflowX)) return false;
        }
        return true;
      })
      .filter((el, _i, all) => !all.some((o) => o !== el && el.contains(o)))
      .map(
        (el) =>
          `${el.tagName}.${el.className.toString().slice(0, 60)}=${Math.round(el.getBoundingClientRect().right)}`,
      )
      .slice(0, 8);
    expect(document.documentElement.scrollWidth, wide.join(' | ')).toBeLessThanOrEqual(320);
  });
});

describe('KK-P05-7 (KK-051-7): A4 kâğıt', () => {
  it('.eda-paper 794 px ± 1 ve iki temada aynı zemin', async () => {
    const screen = await render(
      <div className="eda-paper" data-theme="light">
        <p>Metin</p>
      </div>,
    );
    const paper = screen.container.querySelector<HTMLElement>('.eda-paper');
    if (!paper) throw new Error('kâğıt yok');
    expect(Math.abs(paper.getBoundingClientRect().width - 794)).toBeLessThanOrEqual(1);
    const lightBg = getComputedStyle(paper).backgroundColor;
    root.dataset.theme = 'dark';
    expect(getComputedStyle(paper).backgroundColor).toBe(lightBg);
  });
});
