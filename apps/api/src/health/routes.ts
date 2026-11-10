// /health ve /ready (040 §11). Zarf kullanmazlar; /ready yalnız uygulama yüzeyindedir.
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { ReadyBody } from './ready.ts';

export function mountHealth(app: Hono<SurfaceEnv>): void {
  app.get('/health', (c) => c.json({ status: 'ok' }));
}

export function mountReady(
  app: Hono<SurfaceEnv>,
  ready: () => Promise<{ status: 200 | 503; body: ReadyBody }>,
): void {
  app.get('/ready', async (c) => {
    const r = await ready();
    return c.json(r.body, r.status);
  });
}
