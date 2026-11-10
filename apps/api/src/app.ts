// Uygulama yüzeyi :8000 (040 §2, §5.1). Zincir: requestId → accessLog → availability → responseHeaders
// → bodyLimit → originCheck → (`/api/auth/*`: izin listesi + auth-ip + step-up + Better Auth) →
// (`/api/v1/*`: routeMeta → session → rateLimit(user) → verificationGate → tenant → mfaGate →
// authorize → stepUp → idempotency) → işleyici.
// /api/v1/admin/* bu yüzeyde KAYITSIZDIR (404). P04b: `mfaGate` (tenant ile authorize arası), `stepUp`
// ve `idempotency` (authorize sonrası) kuruludur (040 §5.1 adım 13, 15, 16). Geliştirme dilimi
// rotaları kimlik zincirinden muaftır.

import { AppError, fieldIssueOf } from '@eda/contracts/errors';
import { OpenAPIHono, type z } from '@hono/zod-openapi';
import type { AuditWriter } from './auth/audit.ts';
import { mountAuthHandler } from './auth/handler.ts';
import type { Identity } from './auth/index.ts';
import type { ChatPersistence } from './chat/persistence.ts';
import type { ChatDeps } from './chat/turn.ts';
import type { SurfaceDeps, SurfaceEnv } from './context/types.ts';
import { errorHandler, notFoundHandler } from './errors/error-handler.ts';
import type { ReadyBody } from './health/ready.ts';
import { mountHealth, mountReady } from './health/routes.ts';
import { accessLog } from './middleware/access-log.ts';
import { authorize } from './middleware/authorize.ts';
import { availability } from './middleware/availability.ts';
import { bodyLimit } from './middleware/body-limit.ts';
import { type IdempotencyStore, idempotency } from './middleware/idempotency.ts';
import { mfaGate } from './middleware/mfa-gate.ts';
import { originCheck } from './middleware/origin-check.ts';
import type { RateLimiter } from './middleware/rate-limit.ts';
import { requestId } from './middleware/request-id.ts';
import { responseHeaders } from './middleware/response-headers.ts';
import { routeMeta } from './middleware/route-meta.ts';
import { session } from './middleware/session.ts';
import { stepUp } from './middleware/step-up.ts';
import { type TenantDb, tenant } from './middleware/tenant.ts';
import { userRateLimit } from './middleware/user-rate-limit.ts';
import { verificationGate } from './middleware/verification-gate.ts';
import { mountAiKeys } from './routes/ai-keys.ts';
import { mountAnnouncements } from './routes/announcements.ts';
import { mountCalendar } from './routes/calendar.ts';
import { mountCases } from './routes/cases.ts';
import { mountConversations } from './routes/conversations.ts';
import { mountDecisions } from './routes/decisions.ts';
import { mountDocuments } from './routes/documents.ts';
import { mountFiles } from './routes/files.ts';
import { type KunyeCheckRouteDeps, mountKunyeChecks } from './routes/kunye-checks.ts';
import { mountLegislation } from './routes/legislation.ts';
import { type MeRouteDeps, mountMe } from './routes/me/index.ts';
import { mountSessions } from './routes/me/sessions.ts';
import { mountStepUp } from './routes/me/step-up.ts';
import { mountNotificationPreferences } from './routes/notification-preferences.ts';
import { mountNotifications } from './routes/notifications.ts';
import { mountOrg } from './routes/org/index.ts';
import { mountTemplates } from './routes/templates.ts';
import { RouteRegistry } from './routing/route-registry.ts';
import type { AiKeysService } from './services/ai-keys/ai-keys.ts';
import type { AnnouncementsService } from './services/announcements/active.ts';
import type { CalendarService } from './services/calendar/calendar.ts';
import type { CasesService } from './services/cases/cases.ts';
import type { ChatAttachments } from './services/chat/attachments.ts';
import type { DocumentsService } from './services/documents/documents.ts';
import type { FilesService } from './services/files/files.ts';
import type { NotificationInboxService } from './services/notifications/inbox.ts';
import type { NotificationPreferencesService } from './services/notifications/preferences.ts';
import type { OrgService } from './services/org/org.ts';
import type { ResearchDeps } from './services/research.ts';

export type AppSurfaceDeps = SurfaceDeps & {
  ready: () => Promise<{ status: 200 | 503; body: ReadyBody }>;
  /** Sohbet dikey dilimi: yalnız development/test'te verilir. */
  chat?: ChatDeps;
  /** Karar Arşivi ve Mevzuat: yalnız development/test'te verilir. */
  research?: ResearchDeps;
  /** Künye Kontrolü düz metin dilimi (P13.12 K6): yalnız development/test'te verilir. */
  kunyeChecks?: KunyeCheckRouteDeps;
  /** Kimlik zinciri ve hesap uçları (P04a). Yoksa yalnız sağlık ve geliştirme dilimi bağlanır. */
  identity?: IdentitySurfaceDeps;
};

export interface IdentitySurfaceDeps {
  readonly appUrl: string;
  readonly identity: Pick<
    Identity,
    | 'handle'
    | 'getSession'
    | 'revokeSession'
    | 'assertCanRemoveFactor'
    | 'stepUp'
    | 'listSessions'
    | 'revokeSessionById'
    | 'revokeOtherSessions'
  >;
  readonly rate: RateLimiter;
  /** Kimlik e-postası günlük tavanları (kayıt, yeniden doğrulama, parola sıfırlama istekleri). */
  readonly emailDailyCaps?: { readonly global: number; readonly perIp: number };
  readonly tenantDb: TenantDb;
  readonly idempotency: IdempotencyStore;
  readonly org: OrgService;
  readonly documents: DocumentsService;
  readonly calendar: CalendarService;
  readonly cases: CasesService;
  readonly files: FilesService;
  readonly notificationPreferences: NotificationPreferencesService;
  readonly notificationInbox: NotificationInboxService;
  /** Etkin duyurular (P27 duyuru modülü); verilmezse uç bağlanmaz. */
  readonly announcements?: AnnouncementsService;
  readonly aiKeys: AiKeysService;
  readonly chatPersistence?: ChatPersistence;
  /** Sohbet eki çözücüsü (P21 ilk dilimi); yalnız kimlik zinciriyle (RLS). */
  readonly chatAttachments?: ChatAttachments;
  readonly me: MeRouteDeps;
  /** Kimlik denetim yazıcısı (oturum iptali vb.). */
  readonly audit: AuditWriter;
}

/**
 * Fail-closed (040 ilke 4): Hono'ya bağlanan her `/api/v1/*` rotası kayıt defterinde olmalı; aksi
 * hâlde rota kimlik zincirini atlayabilirdi. Açılış hatası.
 */
export function assertRoutesRegistered(
  routes: readonly { method: string; path: string }[],
  registry: RouteRegistry,
): void {
  for (const r of routes) {
    if (!r.path.startsWith('/api/v1/') || r.path.endsWith('*') || r.method === 'ALL') continue;
    const template = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    if (!registry.list().some((x) => x.method === r.method && x.path === template)) {
      throw new Error(`rota kayıt defterinde yok: ${r.method} ${r.path}`);
    }
  }
}

export function createAppSurface(deps: AppSurfaceDeps): {
  app: OpenAPIHono<SurfaceEnv>;
  registry: RouteRegistry;
} {
  const app = new OpenAPIHono<SurfaceEnv>({
    defaultHook: (result: { success: boolean; target: string; error?: z.ZodError }) => {
      if (!result.success && result.error !== undefined) {
        throw new AppError('VALIDATION_FAILED', {
          fields: result.error.issues.map((issue) => ({
            path: [result.target, ...issue.path.map(String)].join('.'),
            issue: fieldIssueOf(issue),
          })),
        });
      }
    },
  });
  const registry = new RouteRegistry();

  app.use('*', requestId());
  app.use('*', accessLog(deps));
  app.use('/api/*', availability(deps));
  app.use('*', responseHeaders());
  app.use('/api/*', bodyLimit(deps));

  mountHealth(app);
  mountReady(app, deps.ready);
  const id = deps.identity;
  if (id !== undefined) {
    app.use('/api/*', originCheck(id.appUrl, deps.logger));
    mountAuthHandler(app, id.identity, id.rate, id.emailDailyCaps);
    app.use('/api/v1/*', routeMeta(registry));
    app.use('/api/v1/*', session(id.identity, deps.logger));
    app.use('/api/v1/*', userRateLimit(id.rate));
    app.use('/api/v1/*', verificationGate());
    app.use('/api/v1/*', tenant(id.tenantDb));
    app.use('/api/v1/*', mfaGate());
    app.use('/api/v1/*', authorize());
    app.use('/api/v1/*', stepUp());
    app.use('/api/v1/*', idempotency(id.idempotency));
    mountMe(app, registry, id.me);
    mountStepUp(app, registry, id.identity);
    mountSessions(app, registry, id.identity, id.audit);
    mountOrg(app, registry, id.org);
    mountDocuments(app, registry, id.documents);
    mountCalendar(app, registry, id.calendar);
    mountCases(app, registry, id.cases);
    mountFiles(app, registry, id.files);
    mountNotificationPreferences(app, registry, id.notificationPreferences);
    mountNotifications(app, registry, id.notificationInbox);
    if (id.announcements !== undefined) mountAnnouncements(app, registry, id.announcements);
    mountAiKeys(app, registry, id.aiKeys);
    mountTemplates(app, registry, id.documents);
  }
  if (deps.chat) mountConversations(app, registry, deps.chat);
  if (deps.research) {
    mountDecisions(app, registry, deps.research, id !== undefined);
    mountLegislation(app, registry, deps.research.legislation, id !== undefined);
  }
  if (deps.kunyeChecks) mountKunyeChecks(app, registry, deps.kunyeChecks, id !== undefined);

  assertRoutesRegistered(app.routes, registry);
  app.onError(errorHandler(deps));
  app.notFound(notFoundHandler());
  return { app, registry };
}
