// `authorize` (040 §5.10; 042 §8.5): `can()` kararını 403'e çevirir. `self` yalnız oturum ister;
// `public` atlanır. Büro izni aktif büro rolü gerektirir; rol yetmezse `ORG_ROLE_INSUFFICIENT`,
// koşul yetmezse ilgili kod + `reason`. Kaynak düzeyi erişim RLS'dedir (erişilemeyen kaynak 404).
import { AppError } from '@eda/contracts/errors';
import { can, isPermission } from '@eda/contracts/permissions';
import type { MiddlewareHandler } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';

export function authorize(): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    const meta = c.get('routeMeta');
    if (meta === undefined || meta.permission === 'public' || meta.permission === 'self') {
      return next();
    }
    const permission = meta.permission;
    if (!isPermission(permission)) throw new AppError('AUTH_FORBIDDEN');
    const t = c.get('tenant');
    if (t === null || t === undefined) throw new AppError('AUTH_FORBIDDEN');
    const d = can(
      {
        surface: 'app',
        memberRole: t.memberRole,
        ...(t.settings === undefined ? {} : { settings: t.settings }),
      },
      permission,
    );
    if (!d.allow) {
      if (d.code === 'ORG_ROLE_INSUFFICIENT') throw new AppError('ORG_ROLE_INSUFFICIENT');
      if (d.code === 'AI_POLICY_ROLE_DISABLED') throw new AppError('AI_POLICY_ROLE_DISABLED');
      throw new AppError(
        'AUTH_FORBIDDEN',
        d.reason === undefined ? {} : { reason: d.reason as never },
      );
    }
    await next();
  };
}
