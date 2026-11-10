// @tk TK-33
// P05.15 ek sözleşmeler: A4 kâğıt ölçüleri ve yakınlaştırma (KK-P05-7), okuma ve kâğıt yazı ölçeği
// (KK-P05-11), azaltılmış harekette statik yükleme simgesi (KK-P05-6), künye durumlarının zorunlu
// renk kipinde simge ve sınır biçimiyle ayrışması (KK-P05-10), metin aralığı artışında taşma yok (KK-P05-16).
import { beforeEach, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { CITATION_VIEW_KEYS, CitationStatusBadge, Loader } from '../../src/index.ts';
import { ComponentShowcase } from '../../src/showcase/showcase.tsx';

const MM = 96 / 25.4;
const root = document.documentElement;

beforeEach(async () => {
  root.dataset.theme = 'light';
  await commands.emulateMedia({ colorScheme: 'light', reducedMotion: null, forcedColors: null });
  await page.viewport(1280, 800);
});

describe('KK-P05-7 (KK-051-7): A4 kâğıt', () => {
  it('kenar boşlukları üst/sağ/alt 20 mm, sol 25 mm; mürekkep iki temada aynı', async () => {
    const screen = await render(
      <div className="eda-paper" data-theme="light">
        <p>Metin</p>
      </div>,
    );
    const paper = screen.container.querySelector<HTMLElement>('.eda-paper');
    if (!paper) throw new Error('kâğıt yok');
    const s = getComputedStyle(paper);
    expect(Number.parseFloat(s.paddingTop)).toBeCloseTo(20 * MM, 0);
    expect(Number.parseFloat(s.paddingRight)).toBeCloseTo(20 * MM, 0);
    expect(Number.parseFloat(s.paddingBottom)).toBeCloseTo(20 * MM, 0);
    expect(Number.parseFloat(s.paddingLeft)).toBeCloseTo(25 * MM, 0);
    const ink = s.color;
    root.dataset.theme = 'dark';
    expect(getComputedStyle(paper).color).toBe(ink);
  });

  for (const zoom of [0.75, 0.9]) {
    it(`yakınlaştırma ${zoom}: genişlik 794 x ${zoom} ± 1 px`, async () => {
      const screen = await render(
        <div className="eda-paper" data-theme="light" style={{ ['--eda-zoom' as string]: zoom }}>
          <p>Metin</p>
        </div>,
      );
      const paper = screen.container.querySelector<HTMLElement>('.eda-paper');
      if (!paper) throw new Error('kâğıt yok');
      expect(Math.abs(paper.getBoundingClientRect().width - 794 * zoom)).toBeLessThanOrEqual(1);
    });
  }
});

describe('KK-P05-11 (KK-051-11): yazı ölçeği', () => {
  it('prose 16/26; kâğıt gövdesi 12 pt (16 px), dipnot 10 pt', async () => {
    const screen = await render(
      <div>
        <p className="text-prose">Okuma metni</p>
        <div className="eda-paper" data-theme="light">
          <p>Gövde</p>
          <small>Dipnot</small>
        </div>
      </div>,
    );
    const prose = getComputedStyle(screen.container.querySelector('.text-prose') as Element);
    expect(prose.fontSize).toBe('16px');
    expect(prose.lineHeight).toBe('26px');
    const body = getComputedStyle(screen.container.querySelector('.eda-paper p') as Element);
    expect(Number.parseFloat(body.fontSize)).toBeCloseTo(16, 1);
    const note = getComputedStyle(screen.container.querySelector('.eda-paper small') as Element);
    expect(Number.parseFloat(note.fontSize)).toBeCloseTo((10 * 96) / 72, 1);
  });
});

describe('KK-P05-6 (KK-051-6): Loader azaltılmış harekette statik simge', () => {
  it('dönen simge gizli, statik simge görünür ve animasyon yok', async () => {
    await commands.emulateMedia({ reducedMotion: 'reduce' });
    const screen = await render(<Loader label="Doğrulanıyor" />);
    const icons = [...screen.container.querySelectorAll('svg')];
    const visible = icons.filter((i) => getComputedStyle(i).display !== 'none');
    expect(visible).toHaveLength(1);
    expect(getComputedStyle(visible[0] as Element).animationName).toBe('none');
    await expect.element(screen.getByText('Doğrulanıyor')).toBeVisible();
  });
});

describe('KK-P05-10 (KK-051-10 rozet yarısı): künye durumları zorunlu renk kipinde ayrışır', () => {
  it('9 durum: simge + sınır biçimi çifti benzersiz; iki warning durumu düz/kesikli', async () => {
    await commands.emulateMedia({ forcedColors: 'active' });
    const labels = Object.fromEntries(CITATION_VIEW_KEYS.map((k) => [k, k])) as Record<
      (typeof CITATION_VIEW_KEYS)[number],
      string
    >;
    const screen = await render(
      <div>
        {CITATION_VIEW_KEYS.map((k) => (
          <CitationStatusBadge key={k} status={k} labels={labels} />
        ))}
      </div>,
    );
    const badges = [...screen.container.querySelectorAll<HTMLElement>('[data-status]')];
    expect(badges).toHaveLength(9);
    const signature = (el: HTMLElement): string => {
      const s = getComputedStyle(el);
      const icon = el.querySelector('svg')?.getAttribute('class') ?? '';
      return `${s.borderTopStyle}/${s.borderTopWidth}/${icon}`;
    };
    expect(new Set(badges.map(signature)).size).toBe(9);
    const style = (k: string): string =>
      getComputedStyle(badges.find((b) => b.dataset.status === k) as Element).borderTopStyle;
    expect(style('out_of_context')).toBe('solid');
    expect(style('source_unavailable')).toBe('dashed');
    for (const b of badges)
      expect(Number.parseFloat(getComputedStyle(b).borderTopWidth)).toBeGreaterThan(0);
  });
});

describe('KK-P05-16 (KK-051-16): metin aralığı artışı', () => {
  it('satır 1.5x, paragraf 2x, harf 0.12 em, sözcük 0.16 em: sayfa yatay taşmaz', async () => {
    const style = document.createElement('style');
    style.textContent =
      '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';
    document.head.append(style);
    try {
      await render(<ComponentShowcase />);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
    } finally {
      style.remove();
    }
  });
});
