'use client';
// Kullanım ve limitler: iki sekme. "Kullanım" platform veya tek büro için token/maliyet/çağrı özetidir
// (kişi bazlı değil); "Limitler" platform varsayılanlarını gösterir ve büro bazlı geçersiz kılmayı yönetir.
import { PageContainer, PageHeader, TabPanel, Tabs } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { LimitsPanel } from './limits-panel.tsx';
import { UsagePanel } from './usage-panel.tsx';

type Tab = 'usage' | 'limits';

export function UsageView() {
  const t = useTranslations('usage');
  const [tab, setTab] = useState<Tab>('usage');
  const [limitOrg, setLimitOrg] = useState<string>('');

  return (
    <PageContainer>
      <PageHeader title={t('title')} description={t('intro')} />
      <Tabs
        value={tab}
        onValueChange={setTab}
        label={t('tabs')}
        items={[
          { value: 'usage', label: t('tab.usage') },
          { value: 'limits', label: t('tab.limits') },
        ]}
      >
        <TabPanel value="usage" className="flex flex-col gap-6 pt-4">
          <UsagePanel
            onManageLimit={(orgId) => {
              setLimitOrg(orgId);
              setTab('limits');
            }}
          />
        </TabPanel>
        <TabPanel value="limits" className="flex flex-col gap-6 pt-4">
          <LimitsPanel initialOrgId={limitOrg} />
        </TabPanel>
      </Tabs>
    </PageContainer>
  );
}
