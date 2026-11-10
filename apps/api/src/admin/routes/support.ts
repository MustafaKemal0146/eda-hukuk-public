// `/api/v1/admin/support*`: iş listesi ve destek talebi kuyruğu (okuma: support + super_admin);
// durum değişikliği yalnız super_admin + step-up + denetim. Konu/gövde hiçbir uçta dönmez.
import {
  AdminSupportOverviewDto,
  AdminTicketListResponse,
  ListTicketsQuery,
  SetTicketStatusInput,
  SetTicketStatusResult,
} from '@eda/contracts/api/admin-support';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import { jsonBody, queryOf, send } from '../../routes/helpers.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { SupportService } from '../support-service.ts';
import { STAFF_READ_META, SUPER_WRITE_META } from './staff-meta.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const actorOf = (c: { get: (k: 'user') => unknown }): string => {
  const u = c.get('user') as { id: string } | undefined;
  if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
  return u.id;
};

export function mountAdminSupport(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: SupportService,
): void {
  const base = '/api/v1/admin/support';

  registry.add('get', `${base}/overview`, STAFF_READ_META);
  app.get(`${base}/overview`, async (c) =>
    send(c, AdminSupportOverviewDto, await svc.overview(actorOf(c))),
  );

  registry.add('get', `${base}/tickets`, STAFF_READ_META);
  app.get(`${base}/tickets`, async (c) =>
    send(
      c,
      AdminTicketListResponse,
      await svc.listTickets(actorOf(c), queryOf(c, ListTicketsQuery)),
    ),
  );

  registry.add('post', `${base}/tickets/{ticketId}/status`, SUPER_WRITE_META);
  app.post(`${base}/tickets/:ticketId/status`, async (c) => {
    const ticketId = c.req.param('ticketId');
    if (!UUID_RE.test(ticketId)) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    const input = await jsonBody(c, SetTicketStatusInput);
    return send(
      c,
      SetTicketStatusResult,
      await svc.setTicketStatus(actorOf(c), ticketId, input.status),
    );
  });
}
