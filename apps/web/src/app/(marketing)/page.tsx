// Tanıtım sayfası (053-12): yalnız kök alan adında sunulur; uygulama alanında proxy /sohbet'e yönlendirir.
// Ana fikir Künye Kilidi'dir: model yalnız etiket yazar, künye kayıttan gelir, resmî kaynakta doğrulanır.
// Tasarım: sahibin onayladığı "Ürün Sahnesi" (2026-10-17). Sayfa sunucu bileşenidir; hareket
// `features/marketing/home/home-effects.tsx` istemci sınırının arkasındadır.
// Örnek görünümler gerçek künye taşımaz: künye numaraları •••• ile gizlidir (uydurma künye yok).
import { getTranslations } from 'next-intl/server';
import '../../tokens/marketing.css';
import '../../features/marketing/home/home.css';
import '../../features/marketing/home/mockup.css';
import { readAppUrl } from '../../config/env.ts';
import { HomeView } from '../../features/marketing/home/home-view.tsx';
import { MarketingFooter } from '../../features/marketing/marketing-chrome.tsx';
import type { Translator } from '../../features/marketing/translator.ts';
import { marketingFontVariables } from './fonts.ts';

// `APP_URL` çalışma zamanında okunur (imaj ortamdan bağımsız); sayfa derleme anında dondurulmaz.
export const dynamic = 'force-dynamic';

export default async function MarketingHome() {
  const t = (await getTranslations('marketing')) as unknown as Translator;
  // Tanıtım sayfası kök alanda, uygulama `app.` alt alanında: bağlantılar mutlak olmalıdır.
  const appUrl = readAppUrl();
  return (
    <HomeView
      t={t}
      appUrl={appUrl}
      fontClass={marketingFontVariables}
      footer={<MarketingFooter />}
    />
  );
}
