// #57: Kurum Paneli Claude API anahtarı rehberi. Bileşen metinleri ve bağlantı kuralları `tr.json`
// kataloğuyla birebir doğrulanır; API çağrısı ve anahtar saklama bu bileşenin dışındadır (#54).
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { ApiKeyGuide } from '../src/features/settings/api-key-guide.tsx';

const GUIDE = messages.orgSettings.apiKeyGuide;

/** React metni HTML'e kaçışlayarak yazar; karşılaştırma için aynı kaçışlama uygulanır. */
const escaped = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

const html = renderToStaticMarkup(
  createElement(NextIntlClientProvider, {
    locale: 'tr',
    messages,
    timeZone: 'Europe/Istanbul',
    children: createElement(ApiKeyGuide),
  }),
);

describe('#57: kurum paneli API anahtarı rehberi', () => {
  it('açılır bölüm başlığı ve altı adım sırayla çizilir', () => {
    expect(html).toContain(escaped(GUIDE.title));
    const titles = [
      GUIDE.steps.account.title,
      GUIDE.steps.billing.title,
      GUIDE.steps.limit.title,
      GUIDE.steps.create.title,
      GUIDE.steps.copy.title,
      GUIDE.steps.save.title,
    ];
    let cursor = -1;
    for (const title of titles) {
      const at = html.indexOf(escaped(title), cursor + 1);
      expect(at, title).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(html).toMatch(/<ol[^>]*>/);
    expect((html.match(/<li/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });

  it('adım başlık ve gövdeleri katalogdaki metinlerle birebir', () => {
    const steps = Object.values(GUIDE.steps);
    expect(steps).toHaveLength(6);
    for (const step of steps) {
      expect(html).toContain(escaped(step.title));
      expect(html).toContain(escaped(step.body));
    }
    expect(html).toContain(escaped(GUIDE.intro));
  });

  it('uyarı kutusu dört metni taşır; metinlerde "kredi" sözcüğü geçmez', () => {
    const items = Object.values(GUIDE.warning.items);
    expect(items).toHaveLength(4);
    for (const item of items) expect(html).toContain(escaped(item));
    expect(html).toContain(escaped(GUIDE.warning.title));
    expect(html.toLowerCase()).not.toContain('kredi');
  });

  it('tek dış bağlantı Anthropic Console; yeni sekme ve güvenli rel taşır', () => {
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '');
    expect(hrefs).toEqual(['https://console.anthropic.com']);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(escaped(GUIDE.consoleLink));
    // Ağsız (https olmayan) ya da ikinci bir alan adına giden bağlantı yok.
    expect(hrefs.filter((h) => !h.startsWith('https://'))).toEqual([]);
  });
});
