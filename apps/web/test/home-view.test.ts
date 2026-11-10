// @tk TK-33
// 053-12 tanıtım ana sayfası ("Ürün Sahnesi"): sunucuda çizilen işaretleme sözleşmeleri. Sayfa CSP
// nonce'lu çalışır: satır içi `style=""`, `<script>` ve olay işleyici öznitelikleri yoktur (Y-125
// pazarlama dili, "Bedesten" yok, uydurma künye yok, düğme metinleri birebir).
import { createTranslator } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { buildEngineText } from '../src/features/marketing/home/engine-text.ts';
import { appHost, HomeView } from '../src/features/marketing/home/home-view.tsx';
import { makeTx } from '../src/features/marketing/home/text.ts';
import type { Translator } from '../src/features/marketing/translator.ts';

const t = createTranslator({
  locale: 'tr',
  messages,
  namespace: 'marketing',
}) as unknown as Translator;
const APP = 'https://app.eda.localhost:8443';

const html = renderToStaticMarkup(
  createElement(HomeView, {
    t,
    appUrl: APP,
    fontClass: 'font-test',
    footer: createElement('footer', { id: 'alt-bilgi' }, 'alt bilgi'),
  }),
);
const text = html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

describe('Ana sayfa işaretlemesi: CSP uyumu', () => {
  it('satır içi style özniteliği, <script> ve olay işleyicisi yok', () => {
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    // Kural taraması (check-rules) test dosyasındaki sözcüğü de yakaladığı için ad parçalanarak verilir.
    expect(html).not.toMatch(new RegExp(['dangerously', 'SetInnerHTML'].join('')));
  });

  it('dış varlık yok: CDN, uzak yazı tipi, uzak görsel', () => {
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)|jsdelivr|unpkg|cdn\./i);
    expect(html).not.toMatch(/<img/i);
    // Yalnız SVG ad alanı (xmlns) ve uygulama alanı bağlantıları geçer.
    const urls = [...html.matchAll(/https?:\/\/[^"'\s<]+/g)].map((m) => m[0]);
    expect(
      urls.filter((u) => !u.startsWith('http://www.w3.org/2000/svg') && !u.startsWith(APP)),
    ).toEqual([]);
  });
});

describe('Ana sayfa: içerik ve erişilebilirlik', () => {
  it('tek h1 var ve vurgulu sözcük <em> ile çizilir', () => {
    const h1s = [...html.matchAll(/<h1[^>]*class="mk-hero-title"[^>]*>(.*?)<\/h1>/g)];
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.[1]).toContain('<em>doğrulanan</em>');
    // Maket içindeki başlıklar yardımcı teknolojiden gizli bölgededir.
    const device = html.slice(html.indexOf('class="device"'), html.indexOf('mk-replay'));
    expect(device).toContain('aria-hidden="true"');
  });

  it('bölüm kimlikleri ve gezinme bağlantıları eşleşir', () => {
    for (const id of ['urun', 'kunye-kilidi', 'kaynaklar', 'guvenlik', 'sss', 'icerik']) {
      expect(html).toContain(`id="${id}"`);
      if (id !== 'icerik') expect(html).toContain(`href="#${id}"`);
    }
    expect(html).toContain('href="#icerik"');
  });

  it('düğmeler birebir: "Giriş yapın" ve "Kayıt olun", uygulama alanına mutlak bağlantı', () => {
    expect(text).toContain('Giriş yapın');
    expect(text).toContain('Kayıt olun');
    const signIn = [...html.matchAll(/href="([^"]*\/giris)"/g)].map((m) => m[1]);
    const signUp = [...html.matchAll(/href="([^"]*\/kayit)"/g)].map((m) => m[1]);
    expect(signIn.length).toBeGreaterThanOrEqual(3);
    expect(signUp.length).toBeGreaterThanOrEqual(2);
    for (const href of [...signIn, ...signUp]) expect(href?.startsWith(`${APP}/`)).toBe(true);
  });

  it('pilot ifadesi yok; "Bedesten" yok; katalog anahtarı sızmaz', () => {
    expect(text).not.toMatch(/pilot/i);
    expect(text).not.toMatch(/bedesten/i);
    expect(html).not.toMatch(/marketing\.|undefined|\[object/);
    expect(text).toContain('UYAP');
  });

  it('uydurma künye yok: karar numaraları •••• ile gizli', () => {
    expect(text).not.toMatch(/[EK]\. \d{4}\/\d+/);
    expect(text).not.toMatch(/\bT\. \d{2}\.\d{2}\.\d{4}/);
    expect(text).toContain('2023/••••');
  });

  it('maket yardımcı teknolojilere kapalı, etiketi role="img" ile verilir', () => {
    expect(html).toMatch(/role="img"[^>]*aria-label="E\.D\.A\. Hukuk arayüzünün canlandırılmış/);
    expect(html).toContain('class="device" data-scene="0" aria-hidden="true"');
  });

  it('maket ve sayfa simgeleri @eda/ui Icon (Lucide) ile çizilir: ham <symbol>/<use> yok', () => {
    expect(html).not.toMatch(/<symbol|<use /);
    expect((html.match(/lucide/g) ?? []).length).toBeGreaterThan(40);
  });

  it('alt bilgi dışarıdan verilir (mevcut MarketingFooter korunur)', () => {
    expect(html).toContain('id="alt-bilgi"');
    expect(html).toContain('id="mk-root"');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('font-test');
  });

  it('SSS yerel <details> ile (betik gerektirmez)', () => {
    expect((html.match(/<details/g) ?? []).length).toBe(6);
  });
});

describe('Ana sayfa metinleri', () => {
  it('maket tarayıcı çubuğu APP_URL ana makinesini gösterir; tanımsızsa katalog örneği', () => {
    expect(appHost(APP, 'x')).toBe('app.eda.localhost:8443');
    expect(appHost('', 'örnek')).toBe('örnek');
    expect(html).toContain('app.eda.localhost:8443');
  });

  it('sahne motoru metinleri katalogdan tam gelir', () => {
    const e = buildEngineText(makeTx(t));
    expect(e.question).toContain('ispat yüküne');
    expect(e.pipe.rows).toHaveLength(5);
    expect(e.pipe.meta).toHaveLength(6);
    expect(Object.keys(e.chips).sort()).toEqual(['K1', 'K4']);
    const chipRefs = JSON.stringify(e.answer).match(/"chip":"(K\d)"/g) ?? [];
    expect(chipRefs).toHaveLength(2);
    expect(e.studio.words).toContain('{count}');
    expect(e.cal.sumDaySel).toBe('16 Ekim Cuma');
  });
});
