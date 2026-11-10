import { AiConfigView } from '../../../features/ai/ai-config-view.tsx';
import { getAdminMe } from '../../../lib/session.ts';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const me = await getAdminMe();
  // Anahtar yönetimi yalnız süper yöneticiye açıktır (api ayrıca doğrular); destek salt okur görür.
  return <AiConfigView canWrite={me?.platformRole === 'super_admin'} />;
}
