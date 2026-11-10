import { notFound } from 'next/navigation';
import { UserDetailView } from '../../../../features/users/user-detail-view.tsx';
import { getAdminMe } from '../../../../lib/session.ts';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!UUID_RE.test(userId)) notFound();
  const me = await getAdminMe();
  return (
    <UserDetailView
      userId={userId.toLocaleLowerCase('tr-TR')}
      viewerRole={me?.platformRole ?? 'support'}
    />
  );
}
