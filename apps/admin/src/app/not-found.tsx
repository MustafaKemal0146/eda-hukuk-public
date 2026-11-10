// Bulunamadı sayfası: Next'in yerleşik 404 sayfası satır içi stil taşır ve nonce'lu CSP'ye (061 §2.3)
// takılır; bu sayfa yalnız sınıf tabanlı stil kullanır.
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-title text-fg">{t('title')}</h1>
      <p className="text-body-sm text-fg-muted">{t('message')}</p>
      <a
        href="/"
        className="text-body-sm font-medium text-primary underline focus-visible:focus-ring"
      >
        {t('home')}
      </a>
    </main>
  );
}
