// `GET /api/v1/admin/chat-reports` (053-ekranlar/11 "Sohbetler ve raporlar"): içeriksiz, toplulaştırılmış
// sohbet kullanım raporu. İndirme (CSV) ucu YOKTUR; veri dışarı aktarılmaz. Yanıt `no-store`.
import { ChatReportsQuery, ChatReportsResponse } from '@eda/contracts/api/admin-chat-reports';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import { queryOf, send } from '../../routes/helpers.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { ChatReportsService } from '../chat-reports-service.ts';
import { ADMIN_READ } from './me.ts';

const MAX_RANGE_DAYS = 92;
const dayMs = 86_400_000;

function rangeOf(q: { from: string; to: string }): void {
  const a = Date.parse(`${q.from}T00:00:00Z`);
  const b = Date.parse(`${q.to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b || (b - a) / dayMs > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
  }
}

export function mountAdminChatReports(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: ChatReportsService,
): void {
  const meta: RouteMeta = { ...ADMIN_READ, permission: 'platform:usage_read' };
  const path = '/api/v1/admin/chat-reports';
  registry.add('get', path, meta);
  app.get(path, async (c) => {
    const u = c.get('user') as { id: string } | undefined;
    if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
    const q = queryOf(c, ChatReportsQuery);
    rangeOf(q);
    return send(c, ChatReportsResponse, await svc.report(u.id, q.from, q.to));
  });
}
