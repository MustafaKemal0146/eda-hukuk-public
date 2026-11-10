'use client';
// Kenar çubuğu hesap bloğu: oturum varsa ad/e-posta ve menü (Ayarlar, Çıkış yap); yoksa giriş bağlantısı.
// Oturum durumu `GET /api/v1/me` ile okunur (yetki kararını api verir).
import { Avatar, Icon } from '@eda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { type Account, getAccount, signOut } from '../../lib/auth-api.ts';

function initialsOf(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1
      ? `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`
      : (parts[0]?.slice(0, 2) ?? email.slice(0, 2));
  return letters.toLocaleUpperCase('tr-TR');
}

export function AccountBlock({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'anon' | Account>('loading');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getAccount().then((a) => {
      if (!cancelled) setState(a ?? 'anon');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    try {
      await signOut();
    } finally {
      router.replace('/giris?neden=cikis-yapildi');
      router.refresh();
    }
  }

  if (state === 'loading' || state === 'anon') {
    return (
      <Link
        href="/giris"
        className="mt-1 flex items-center gap-2.5 rounded-md p-1.5 transition-colors duration-fast hover:bg-primary-soft focus-visible:focus-ring-inset"
      >
        <Avatar initials="?" label={t('topbar.signIn')} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-medium text-fg">
            {t('topbar.signIn')}
          </span>
          <span className="block truncate text-caption text-fg-subtle">
            {t('topbar.signInHint')}
          </span>
        </span>
        <Icon icon="control.chevron-right" size="sm" className="text-fg-subtle" />
      </Link>
    );
  }
  return (
    <div className="mt-1 flex flex-col gap-px">
      {open && (
        <div className="flex flex-col rounded-md border border-border bg-surface-raised p-1 shadow-1">
          <Link
            href="/ayarlar"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="rounded-sm px-2 py-1.5 text-body-sm text-fg hover:bg-primary-soft focus-visible:focus-ring-inset"
          >
            {t('nav.settings')}
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-sm px-2 py-1.5 text-left text-body-sm text-fg hover:bg-primary-soft focus-visible:focus-ring-inset"
          >
            {t('topbar.signOut')}
          </button>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('topbar.account')}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-md p-1.5 text-left transition-colors duration-fast hover:bg-primary-soft focus-visible:focus-ring-inset"
      >
        <Avatar initials={initialsOf(state.name, state.email)} label={state.name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-medium text-fg">{state.name}</span>
          <span className="block truncate text-caption text-fg-subtle">{state.email}</span>
        </span>
        <Icon icon="control.chevron-up" size="sm" className="text-fg-subtle" />
      </button>
    </div>
  );
}
