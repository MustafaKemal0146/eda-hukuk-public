// Admin yüzeyi :8010 (040 §2, §5.2). `/health` her zaman; kimlik kurulduysa (`identity`) `/api/auth/*`
// (yalnız passkey yolları), oturum + `platformGate` + yetki + step-up zinciri ve `/api/v1/admin/*`
// uçları bağlanır. `/ready` ve `/metrics` bu yüzeyde YOKTUR; bakım modu bu yüzeyi ETKİLEMEZ.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AiConfigService } from './admin/ai-config-service.ts';
import type { AdminAiKeysService } from './admin/ai-keys-service.ts';
import type { AdminAnnouncementsService } from './admin/announcements-service.ts';
import type { AdminAuditService } from './admin/audit-service.ts';
import { createChatReportsService } from './admin/chat-reports-service.ts';
import { adminDbFromEnv } from './admin/db.ts';
import { adminAuthorize, adminSession } from './admin/gate.ts';
import { mountAdminAiConfig } from './admin/routes/ai-config.ts';
import { mountAdminAiKeys } from './admin/routes/ai-keys.ts';
import { mountAdminAnnouncements } from './admin/routes/announcements.ts';
import { mountAdminAudit } from './admin/routes/audit.ts';
import { mountAdminChatReports } from './admin/routes/chat-reports.ts';
import { mountAdminData } from './admin/routes/data.ts';
import { mountAdminMe } from './admin/routes/me.ts';
import { mountStaffModules, type StaffModules } from './admin/routes/staff-modules.ts';
import { mountAdminSystem } from './admin/routes/system.ts';
import { mountAdminUsage } from './admin/routes/usage.ts';
import { mountAdminUsers } from './admin/routes/users.ts';
import type { AdminService } from './admin/service.ts';
import type { SystemService } from './admin/system-service.ts';
import { type AdminUsageService, createAdminUsageService } from './admin/usage-service.ts';
import type { AdminUsersService } from './admin/users-service.ts';
import { ADMIN_LOGIN_PATHS, isAllowedAdminAuthRequest } from './auth/admin-auth.ts';
import type { AdminIdentity } from './auth/admin-identity.ts';
import { clientIp, ipBucket } from './auth/net.ts';
import type { SurfaceDeps, SurfaceEnv } from './context/types.ts';
import { errorHandler, notFoundHandler } from './errors/error-handler.ts';
import { mountHealth } from './health/routes.ts';
import { accessLog } from './middleware/access-log.ts';
import { availability } from './middleware/availability.ts';
import { bodyLimit } from './middleware/body-limit.ts';
import { originCheck } from './middleware/origin-check.ts';
import type { RateLimiter } from './middleware/rate-limit.ts';
import { requestId } from './middleware/request-id.ts';
import { responseHeaders } from './middleware/response-headers.ts';
import { routeMeta } from './middleware/route-meta.ts';
import { stepUp } from './middleware/step-up.ts';
import { userRateLimit } from './middleware/user-rate-limit.ts';
import { assertAdminRoutesGuarded, RouteRegistry } from './routing/route-registry.ts';

export interface AdminIdentityDeps {
  readonly identity: AdminIdentity;
  readonly adminUrl: string;
  readonly rate: RateLimiter;
  readonly environment: string;
  readonly maintenanceMode: () => boolean;
  readonly service: AdminService;
  /** Kullanıcılar ve kullanıcı limitleri modülü; verilmezse uçlar bağlanmaz. */
  readonly usersService?: AdminUsersService;
  /** Kullanım ve limit servisi; verilmezse `eda_readonly_admin` havuzundan kurulur. */
  readonly usageService?: AdminUsageService;
  /** Duyurular ve bildirim özeti (P27); verilmezse uçlar bağlanmaz. */
  readonly announcements?: AdminAnnouncementsService;
  /** Yapay zekâ ayarı ve istemler modülü (verilmezse bağlanmaz). */
  readonly aiConfig?: AiConfigService;
  /** Yapay zekâ anahtar ataması ve platform ortak anahtarı kartı; verilmezse bağlanmaz. */
  readonly aiKeys?: AdminAiKeysService;
  /** Sistem modülü (servis durumu, önbellek, kuyruk, veritabanı); verilmezse uç bağlanmaz. */
  readonly system?: SystemService;
  /** Şablonlar, Destek ve Veri seti modülleri; verilmezse uçlar bağlanmaz. */
  readonly staffModules?: StaffModules;
  /** Denetim modülü (günlük + hata özeti); verilmezse uçlar bağlanmaz. */
  readonly audit?: AdminAuditService;
}

export function createAdminSurface(
  deps: SurfaceDeps,
  id?: AdminIdentityDeps,
): OpenAPIHono<SurfaceEnv> {
  const app = new OpenAPIHono<SurfaceEnv>();
  const registry = new RouteRegistry();
  app.use('*', requestId());
  app.use('*', accessLog(deps));
  app.use('/api/*', availability({ ...deps, maintenanceMode: () => false }));
  app.use('*', responseHeaders());
  app.use('/api/*', bodyLimit(deps));
  mountHealth(app);
  if (id !== undefined) {
    app.use('/api/*', originCheck(id.adminUrl, deps.logger));
    app.all('/api/auth/*', async (c) => {
      if (!isAllowedAdminAuthRequest(c.req.method, c.req.path)) {
        throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
      }
      const sub = c.req.path.startsWith('/api/auth')
        ? c.req.path.slice('/api/auth'.length)
        : c.req.path;
      const bucket = ipBucket(clientIp(c.req.raw.headers));
      if (ADMIN_LOGIN_PATHS.has(sub)) {
        // Giriş girişimi uçları: internete açık yüzeyde uygulamadakinden sıkı, ayrı kova.
        await id.rate.enforce(
          'admin-auth-ip',
          bucket,
          CONFIG_DEFAULTS['rateLimit.adminAuthPerIpPerMin'],
          60_000,
        );
      } else if (sub !== '/get-session') {
        // Oturum okuma (`get-session`) giriş girişimi değildir; aynı NAT arkasındaki yöneticilerin
        // birbirini kısıtlamaması için sayılmaz.
        await id.rate.enforce(
          'auth-ip',
          bucket,
          CONFIG_DEFAULTS['rateLimit.authPerIpPerMin'],
          60_000,
        );
      }
      return id.identity.handle(c.req.raw);
    });
    app.use('/api/v1/*', routeMeta(registry));
    app.use('/api/v1/*', adminSession(id.identity, deps.logger));
    app.use('/api/v1/*', userRateLimit(id.rate));
    app.use('/api/v1/*', adminAuthorize());
    app.use('/api/v1/*', stepUp());
    mountAdminMe(app, registry, {
      environment: id.environment,
      maintenanceMode: id.maintenanceMode,
    });
    mountAdminData(app, registry, id.service);
    if (id.usersService !== undefined) mountAdminUsers(app, registry, id.usersService, id.rate);
    mountAdminUsage(
      app,
      registry,
      id.usageService ?? createAdminUsageService({ db: adminDbFromEnv() }),
    );
    if (id.announcements !== undefined) mountAdminAnnouncements(app, registry, id.announcements);
    if (id.aiConfig !== undefined) mountAdminAiConfig(app, registry, id.aiConfig);
    if (id.aiKeys !== undefined) mountAdminAiKeys(app, registry, id.aiKeys, id.rate);
    if (id.system !== undefined) mountAdminSystem(app, registry, id.system);
    if (id.staffModules !== undefined) mountStaffModules(app, registry, id.staffModules);
    if (id.audit !== undefined) mountAdminAudit(app, registry, id.audit);
    mountAdminChatReports(app, registry, createChatReportsService({ db: adminDbFromEnv() }));
  }
  // Fail-closed (D-7): kayıt defterine eklenmeden bağlanan yönetim rotası kimlik zincirini atlardı.
  assertAdminRoutesGuarded(app.routes, registry);
  app.onError(errorHandler(deps));
  app.notFound(notFoundHandler());
  return app;
}
