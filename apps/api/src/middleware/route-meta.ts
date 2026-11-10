// Zincir 9–14'ün okuduğu rota meta verisi (040 §5.1 kuralı): istek yöntemi + yolu kayıt defterinde
// aranır ve `c.var.routeMeta`'ya konur. Kayıtsız yol 404'e düşer; geliştirme dilimi rotaları
// meta verisiz bırakılır, böylece kimlik zinciri onları atlar.
import type { MiddlewareHandler } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';

export function routeMeta(registry: RouteRegistry): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    const r = registry.find(c.req.method, c.req.path);
    const active = r !== undefined && !r.devSlice;
    c.set('routeMeta', active ? r.meta : undefined);
    c.set('routeKey', active ? `${r.method} ${r.path}` : undefined);
    await next();
  };
}
