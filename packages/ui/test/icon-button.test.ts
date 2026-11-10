// @tk TK-33
// KK-P05-18 (KK-052-3): `IconButton` `label` prop'u TypeScript'te zorunludur (tip testi;
// `pnpm typecheck` bu dosyayı da derler) ve erişilebilir ad `aria-label` ile verilir, `title` ile
// değil. Combobox `filter` prop'u da zorunludur (varsayılan eşleştirici yok; P05.9).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Combobox } from '../src/components/combobox.tsx';
import { IconButton } from '../src/components/icon-button.tsx';

describe('KK-P05-18: IconButton label zorunlu', () => {
  it('label yoksa derleme hatası (ts-expect-error)', () => {
    // @ts-expect-error KK-P05-18: label zorunlu prop'tur
    const element = createElement(IconButton, { icon: 'action.close' });
    expect(element.props).not.toHaveProperty('label');
  });

  it('label erişilebilir ad olur; title kullanılmaz', () => {
    const markup = renderToStaticMarkup(
      createElement(IconButton, { icon: 'action.close', label: 'Örnek etiket' }),
    );
    expect(markup).toContain('aria-label="Örnek etiket"');
    expect(markup).not.toContain('title=');
    expect(markup).toContain('type="button"');
    // Simge süstür: ekran okuyucu yalnız düğme adını okur.
    expect(markup).toContain('aria-hidden="true"');
  });
});

describe('P05.9: Combobox filter zorunlu', () => {
  it('filter yoksa derleme hatası (ts-expect-error)', () => {
    const element = createElement(
      Combobox,
      // @ts-expect-error filter zorunlu prop'tur (varsayılan yok)
      {
        options: [],
        value: null,
        onValueChange: () => undefined,
        emptyLabel: 'Örnek boş',
        labels: { toggle: 'Örnek aç' },
      },
    );
    expect(element.props).not.toHaveProperty('filter');
  });
});
