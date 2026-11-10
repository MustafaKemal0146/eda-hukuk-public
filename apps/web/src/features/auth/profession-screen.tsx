'use client';
import { NoticeBanner } from '@eda/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProfessionForm } from './profession-form.tsx';

/** `/kayit?adim=meslek` (oturum zorunlu; sayfa sunucuda yönlendirir). Başarıda `/sohbet`. */
export function ProfessionScreen() {
  const t = useTranslations('auth.profession');
  const router = useRouter();
  const [referralUnknown, setReferralUnknown] = useState(false);
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-heading-lg text-fg">{t('title')}</h1>
        <p className="mt-2 text-body-sm text-fg-muted">{t('subtitle')}</p>
      </div>
      {referralUnknown && (
        <NoticeBanner tone="warning" role="status">
          {t('referralUnknown')}
        </NoticeBanner>
      )}
      <ProfessionForm
        onDone={({ partnerCodeAccepted }) => {
          if (partnerCodeAccepted === false) setReferralUnknown(true);
          router.replace('/sohbet');
          router.refresh();
        }}
      />
    </div>
  );
}
