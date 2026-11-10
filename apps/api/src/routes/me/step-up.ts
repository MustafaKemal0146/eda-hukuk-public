// `POST /api/v1/me/step-up` (042 §6.1; KK-P04b-8): `self`, `mfa: exempt`, `allowVerification: any`,
// `tenant: optional`. Doğrulama oturum yaratmaz ve `mfa_level`'ı düşürmez; yalnız `step_up_at`
// yazılır. Deneme sınırı `step-up` kapsamı (`rateLimit.stepUpPerUserPerMin`; servis katmanı).
import { StepUpInput, StepUpResultDto } from '@eda/contracts/api/me';
import { AppError, fieldIssueOf } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { Identity } from '../../auth/index.ts';
import type { SurfaceEnv } from '../../context/types.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import { ME_META } from './index.ts';

export function mountStepUp(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  identity: Pick<Identity, 'stepUp' | 'getSession'>,
): void {
  registry.add('post', '/api/v1/me/step-up', { ...ME_META, body: 'json' });
  app.post('/api/v1/me/step-up', async (c) => {
    const s = c.get('session');
    if (s === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new AppError('VALIDATION_MALFORMED_BODY');
    }
    const parsed = StepUpInput.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', {
        fields: parsed.error.issues.slice(0, 20).map((i) => ({
          path: ['body', ...i.path.map(String)].join('.'),
          issue: fieldIssueOf(i),
        })),
      });
    }
    // Belirteç `c.var`'da tutulmaz; oturum çerezinden yeniden çözülür.
    const resolved = await identity.getSession(c.req.raw.headers);
    if (resolved === null || resolved.session.id !== s.id) {
      throw new AppError('AUTH_SESSION_EXPIRED');
    }
    const dto = await identity.stepUp({
      session: {
        id: s.id,
        token: resolved.session.token,
        userId: s.userId,
        activeOrganizationId: s.activeOrganizationId,
      },
      input: parsed.data,
      headers: c.req.raw.headers,
    });
    c.header('Cache-Control', 'no-store');
    return c.json(StepUpResultDto.parse(dto));
  });
}
