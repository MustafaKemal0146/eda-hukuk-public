// Tanıtım ana sayfası görünümü ("Ürün Sahnesi", koyu tema): gezinme, sahne, bölümler ve alt bilgi.
// Sayfa her zaman koyudur (`data-theme="dark"` uygulama belirteçlerini bu alanda koyu değerlere çeker).
// Metinler yalnız `marketing` kataloğundan; bağlantılar `APP_URL` (uygulama alt alanı) ile mutlak.
import type { ReactNode } from 'react';
import type { Translator } from '../translator.ts';
import { buildEngineText } from './engine-text.ts';
import { HomeEffects } from './home-effects.tsx';
import { Sections } from './sections.tsx';
import { Stage } from './stage.tsx';
import { makeTx } from './text.ts';

export const HOME_ROOT_ID = 'mk-root';

/** Maket tarayıcı çubuğundaki alan adı: `APP_URL` ana makinesi; tanımsızsa katalogdaki örnek ad. */
export function appHost(appUrl: string, fallback: string): string {
  try {
    return new URL(appUrl).host || fallback;
  } catch {
    return fallback;
  }
}

export function HomeView({
  t,
  appUrl,
  fontClass,
  footer,
}: {
  t: Translator;
  appUrl: string;
  fontClass: string;
  footer: ReactNode;
}) {
  const tx = makeTx(t);
  const host = appHost(appUrl, tx.s('mock.chrome.host'));
  const links = [
    ['#urun', 'nav.links.product'],
    ['#kunye-kilidi', 'nav.links.kunye'],
    ['#kaynaklar', 'nav.links.sources'],
    ['#guvenlik', 'nav.links.security'],
    ['#sss', 'nav.links.faq'],
  ] as const;
  return (
    <div id={HOME_ROOT_ID} className={`mk ${fontClass}`} data-theme="dark">
      <a className="mk-skip" href="#icerik">
        {tx.s('nav.skip')}
      </a>
      <header className="mk-nav" id="ust">
        <div className="mk-nav-in">
          <a className="mk-wordmark" href="#ust" aria-label={tx.s('nav.homeLabel')}>
            <span className="mk-wm-mark" aria-hidden="true" />
            <span className="mk-wm-a">{tx.s('nav.brandA')}</span>
            <span className="mk-wm-b">{tx.s('nav.brandB')}</span>
          </a>
          <nav className="mk-nav-links" aria-label={tx.s('nav.label')}>
            {links.map(([href, key]) => (
              <a key={href} href={href}>
                {tx.s(key)}
              </a>
            ))}
          </nav>
          <div className="mk-nav-cta">
            <a className="mk-link-quiet" href={`${appUrl}/giris`}>
              {tx.s('nav.signIn')}
            </a>
            <a className="mk-btn mk-btn-gold mk-btn-sm mk-magnetic" href={`${appUrl}/giris`}>
              <span>{tx.s('nav.open')}</span>
            </a>
          </div>
        </div>
      </header>
      <main id="icerik">
        <Stage tx={tx} appUrl={appUrl} host={host} />
        <Sections tx={tx} appUrl={appUrl} />
      </main>
      <div className="mk-foot">{footer}</div>
      <HomeEffects rootId={HOME_ROOT_ID} text={buildEngineText(tx)} />
    </div>
  );
}
