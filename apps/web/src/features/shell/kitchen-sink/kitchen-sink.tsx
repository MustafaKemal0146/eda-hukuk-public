// /_kitchen-sink vitrini: @eda/ui/showcase (tarayıcı testleriyle aynı küme) + uygulamaya özgü
// bileşenler. Kurum Paneli API anahtarı rehberi (#57) burada görünür; #54 onu kendi sayfasına bağlar.
import { PageContainer } from '@eda/ui';
import { ComponentShowcase } from '@eda/ui/showcase';
import { ApiKeyGuide } from '../../settings/api-key-guide.tsx';

export function KitchenSink() {
  return (
    <>
      <ComponentShowcase />
      <PageContainer width="content">
        <ApiKeyGuide />
      </PageContainer>
    </>
  );
}
