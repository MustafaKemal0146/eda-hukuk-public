import { AnnouncementsView } from '../../../features/announcements/announcements-view.tsx';
import { getAdminMe } from '../../../lib/session.ts';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const me = await getAdminMe();
  // Yazma düğmeleri yalnız `super_admin` içindir; `support` salt okur görür (api yine reddeder).
  return <AnnouncementsView canWrite={me?.platformRole === 'super_admin'} />;
}
