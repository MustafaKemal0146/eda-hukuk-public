// Yönetim girişi (passkey veya parola + TOTP; P27a).
import { Badge } from '@eda/ui';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '../../../features/auth/login-form.tsx';
import { parseLoginNotice, SESSION_ENDED_PARAM } from '../../../lib/session-guard.ts';

export default async function AdminLogin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations();
  // Sorgu değeri ham basılmaz: beyaz listeden bir ileti anahtarına çevrilir.
  const notice = parseLoginNotice((await searchParams)[SESSION_ENDED_PARAM]);
  return (
    <main id="icerik" className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2.5">
          <span className="font-display text-title font-semibold tracking-tight text-fg">
            {t('common.brand')}
          </span>
          <Badge tone="inverse">{t('common.admin')}</Badge>
        </div>
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-2">
          <div>
            <h1 className="font-display text-heading-lg text-fg">{t('login.title')}</h1>
            <p className="mt-1.5 text-body-sm text-fg-muted">{t('login.intro')}</p>
          </div>
          <LoginForm sessionEnded={notice === 'sessionEnded'} />
        </div>
      </div>
    </main>
  );
}
