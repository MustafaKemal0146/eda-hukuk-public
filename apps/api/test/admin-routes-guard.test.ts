// @tk TK-04
// Yönetim yüzeyi açılış denetimi (D-7, fail-closed): kayıt defterine eklenmemiş, geliştirme dilimi
// veya `platform:*`/`self` dışı izinli rota uygulamayı BAŞLATMAZ.
import { describe, expect, it } from 'vitest';
import type { RouteMeta } from '../src/routing/define-route.ts';
import { assertAdminRoutesGuarded, RouteRegistry } from '../src/routing/route-registry.ts';

const meta = (over: Partial<RouteMeta> = {}): RouteMeta =>
  ({
    permission: 'platform:usage_read',
    stepUp: false,
    clientData: false,
    idempotency: 'none',
    mfa: 'exempt',
    ...over,
  }) as unknown as RouteMeta;

describe('D-7: yönetim rotası açılış denetimi', () => {
  it('kayıtsız /api/v1 rotası açılış hatasıdır; kayıtlı ve platform:* izinli rota geçer', () => {
    const r = new RouteRegistry();
    r.add('get', '/api/v1/admin/usage', meta());
    expect(() =>
      assertAdminRoutesGuarded([{ method: 'GET', path: '/api/v1/admin/usage' }], r),
    ).not.toThrow();
    expect(() =>
      assertAdminRoutesGuarded([{ method: 'GET', path: '/api/v1/admin/gizli' }], r),
    ).toThrow(/kayıt defterinde yok/);
    // Parametreli yol şablonu eşleşir; auth ve sağlık yolları denetim dışıdır.
    r.add('get', '/api/v1/admin/users/{userId}', meta());
    expect(() =>
      assertAdminRoutesGuarded(
        [
          { method: 'GET', path: '/api/v1/admin/users/:userId' },
          { method: 'GET', path: '/health' },
          { method: 'ALL', path: '/api/auth/*' },
        ],
        r,
      ),
    ).not.toThrow();
  });

  it('geliştirme dilimi ve platform:* / self dışı izin reddedilir', () => {
    const r = new RouteRegistry();
    r.add('get', '/api/v1/admin/dilim', meta(), { devSlice: true });
    expect(() =>
      assertAdminRoutesGuarded([{ method: 'GET', path: '/api/v1/admin/dilim' }], r),
    ).toThrow(/geliştirme dilimi/);
    const r2 = new RouteRegistry();
    r2.add('get', '/api/v1/admin/me', meta({ permission: 'self' }));
    expect(() =>
      assertAdminRoutesGuarded([{ method: 'GET', path: '/api/v1/admin/me' }], r2),
    ).not.toThrow();
    const r3 = new RouteRegistry();
    r3.add('get', '/api/v1/admin/org', meta({ permission: 'org:member_read' }));
    expect(() =>
      assertAdminRoutesGuarded([{ method: 'GET', path: '/api/v1/admin/org' }], r3),
    ).toThrow(/platform/);
  });
});
