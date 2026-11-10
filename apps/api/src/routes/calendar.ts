// `/api/v1/calendar/events*` uçları (041 §6.1; P22 KB). Rota katmanı yalnız ayrıştırma ve yanıt
// doğrulamasıdır; kural ve SQL servis/depo katmanındadır. Yanıtlar `Cache-Control: no-store`.
import {
  CalendarEventDto,
  EventInput,
  EventListResponse,
  EventPatchInput,
  ListEventsQuery,
} from '@eda/contracts/api/calendar';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';
import type { CalendarService } from '../services/calendar/calendar.ts';
import { jsonBody, queryOf, send, tenantActor } from './helpers.ts';

const READ: RouteMeta = {
  permission: 'calendar:read',
  tenant: 'required',
  allowVerification: 'verified',
  mfa: 'policy',
  clientData: false,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'api',
  body: 'none',
  timeout: 'default',
};
const WRITE: RouteMeta = { ...READ, permission: 'calendar:write', body: 'json' };

export function mountCalendar(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: CalendarService,
) {
  const base = '/api/v1/calendar/events';

  registry.add('get', base, READ);
  app.get(base, async (c) =>
    send(c, EventListResponse, await svc.list(tenantActor(c), queryOf(c, ListEventsQuery))),
  );

  registry.add('post', base, WRITE);
  app.post(base, async (c) => {
    const input = await jsonBody(c, EventInput);
    return send(c, CalendarEventDto, await svc.create(tenantActor(c), input), 201);
  });

  registry.add('patch', `${base}/{eventId}`, WRITE);
  app.patch(`${base}/:eventId`, async (c) => {
    const input = await jsonBody(c, EventPatchInput);
    return send(
      c,
      CalendarEventDto,
      await svc.patch(tenantActor(c), c.req.param('eventId'), input),
    );
  });

  registry.add('delete', `${base}/{eventId}`, { ...READ, permission: 'calendar:write' });
  app.delete(`${base}/:eventId`, async (c) => {
    await svc.remove(tenantActor(c), c.req.param('eventId'));
    c.header('Cache-Control', 'no-store');
    return c.body(null, 204);
  });
}
