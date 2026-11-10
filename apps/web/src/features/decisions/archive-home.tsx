'use client';
// Karar Arşivi başlangıç ekranı (053-04 §3): arama formu ve "Beta" bilgisi. Yerel korpus (P14) yokken
// sonuçlar yalnız kullanıcı istediğinde resmî kaynaktan gelir.
import { Badge, NoticeBanner, PageContainer, PageHeader } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { SearchForm } from './search-form.tsx';

export function ArchiveHome() {
  const t = useTranslations('archive');
  return (
    <PageContainer width="content">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {t('title')}
            <Badge tone="info" size="md">
              {t('betaBadge')}
            </Badge>
          </span>
        }
        description={t('intro')}
      >
        <SearchForm />
      </PageHeader>
      <NoticeBanner tone="info">{t('betaNote')}</NoticeBanner>
    </PageContainer>
  );
}
