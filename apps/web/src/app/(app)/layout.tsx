// (app) kabuğu. Oturum kapısı: proxy yalnız çerezin varlığına bakar; burada çerez api'ye iletilir ve
// oturum gerçekten doğrulanır. Geçersiz, süresi dolmuş veya sahte çerez de girişe yönlendirilir.
// Yönlendirme kolaylıktır; veriyi koruyan katman api'dir (oturumsuz uçlar 401/403 verir).
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '../../features/shell/app-shell.tsx';
import { loginHref, PATH_HEADER } from '../../lib/login-redirect.ts';
import { hasSession } from '../../lib/server-session.ts';

// Oturum isteğe bağlıdır; sayfa asla önbelleğe alınıp başkasına sunulmaz.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!(await hasSession())) {
    redirect(loginHref((await headers()).get(PATH_HEADER)));
  }
  return <AppShell>{children}</AppShell>;
}
