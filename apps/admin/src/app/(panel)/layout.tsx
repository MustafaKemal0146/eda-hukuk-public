// Panel kabuğu: oturum sunucuda `GET /admin/me` ile doğrulanır; yoksa girişe yönlenir.
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminShell } from '../../features/shell/admin-shell.tsx';
import { getAdminMe } from '../../lib/session.ts';

export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const me = await getAdminMe();
  if (me === null) redirect('/giris');
  return <AdminShell me={me}>{children}</AdminShell>;
}
