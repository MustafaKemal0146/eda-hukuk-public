// `approve-user` (042 §3.4; 031 §8.2): meslek başvurusunu `eda_readonly_admin` havuzuyla onaylar.
// Aktör `--as` personel e-postası veya (verilmezse) tek `super_admin`; birden çok/hiç yoksa açıklayıcı
// hata. Karar, deneme aboneliği, `trial_grant`, bildirim, e-posta outbox kaydı ve platform denetim
// satırı `app.admin_decide_application` içinde tek işlemdedir; `email.send` işi commit sonrası eklenir
// (kaçarsa `email_outbox.sweep` yakalar). Çıktıda e-posta, parola veya belirteç YOK; kullanıcı
// kimliğinin son 8 hanesi ve yeni durum yazılır.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { AdminDb } from '@eda/db/admin';
import { parseTemplateParams, TEMPLATES } from '@eda/email/catalog';
import { normalizeEmail } from '@eda/legal/text';

export class ApproveUserError extends Error {
  override name = 'ApproveUserError';
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

export interface ApproveUserDeps {
  readonly db: AdminDb;
  readonly enqueueEmailSend: (deliveryId: string) => Promise<void>;
  readonly now?: () => Date;
}

export interface ApproveUserResult {
  readonly userIdSuffix: string;
  readonly status: 'verified';
}

function sqlState(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

export async function approveUser(
  deps: ApproveUserDeps,
  args: { readonly email: string; readonly as?: string | undefined },
): Promise<ApproveUserResult> {
  const now = deps.now ?? (() => new Date());
  const email = normalizeEmail(args.email);
  if (email === null)
    throw new ApproveUserError('geçersiz e-posta: yalnız ASCII adres kabul edilir', 2);
  const asEmail = args.as === undefined ? null : normalizeEmail(args.as);
  if (args.as !== undefined && asEmail === null) {
    throw new ApproveUserError('geçersiz --as e-postası', 2);
  }
  let actor: string;
  let target: { user_id: string; verification_status: string } | undefined;
  try {
    ({ actor, target } = await deps.db.withAdmin(async (tx) => {
      const a = await tx.query<{ id: string }>('SELECT app.admin_resolve_actor($1) AS id', [
        asEmail,
      ]);
      const id = a.rows[0]?.id;
      if (id === undefined) throw new ApproveUserError('aktör çözülemedi', 3);
      const f = await tx.query<{ user_id: string; verification_status: string }>(
        'SELECT user_id, verification_status FROM app.admin_find_application($1, $2)',
        [id, email],
      );
      return { actor: id, target: f.rows[0] };
    }));
  } catch (err) {
    if (err instanceof ApproveUserError) throw err;
    if (sqlState(err) === 'P0002') {
      throw new ApproveUserError(
        'süper yönetici bulunamadı veya belirsiz: --as <personel e-postası> verin; ilk süper yönetici dev ortamında P04b dev-sample, prod ortamında P27 create-staff ile açılır',
        3,
      );
    }
    throw err;
  }
  if (target === undefined) throw new ApproveUserError('bu e-postayla başvuru bulunamadı', 4);
  if (target.verification_status !== 'pending_verification') {
    throw new ApproveUserError(
      `başvuru karar beklemiyor (durum: ${target.verification_status})`,
      5,
    );
  }
  const meta = TEMPLATES.verification_approved;
  const params = parseTemplateParams('verification_approved', {
    trialDays: CONFIG_DEFAULTS['trial.days'],
    trialCredits: CONFIG_DEFAULTS['trial.credits'],
  });
  const expiresAt = new Date(
    now().getTime() + CONFIG_DEFAULTS['notifications.serviceEmailExpiryHours'] * 3_600_000,
  );
  let deliveryId: string | null;
  try {
    deliveryId = await deps.db.withAdminWrite(async (tx) => {
      const r = await tx.query<{ id: string | null }>(
        'SELECT app.admin_decide_application($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) AS id',
        [
          actor,
          target.user_id,
          'approved',
          null,
          CONFIG_DEFAULTS['trial.days'],
          CONFIG_DEFAULTS['trial.credits'],
          meta.version,
          JSON.stringify(params),
          expiresAt,
        ],
      );
      return r.rows[0]?.id ?? null;
    });
  } catch (err) {
    if (sqlState(err) === '55000') throw new ApproveUserError('başvuru karar beklemiyor', 5);
    if (sqlState(err) === 'P0002') {
      throw new ApproveUserError('kullanıcının bireysel bürosu veya meslek başvurusu yok', 4);
    }
    throw err;
  }
  if (deliveryId !== null) await deps.enqueueEmailSend(deliveryId);
  return { userIdSuffix: target.user_id.slice(-8), status: 'verified' };
}
