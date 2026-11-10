// `organization` eklentisi (yalnız `appAuth`; 042 §2.3, §4, §7; P04b). Kullanıcı büro yaratamaz ve
// silemez; rol Better Auth dinamik erişim denetimine BAĞLANMAZ (`members.role` tek değerli etiket;
// izin kararı `can()`). Açık uçlar yalnız `set-active`, `get-invitation`, `accept-invitation`,
// `reject-invitation`'dır (yol izin listesi). Davet ve üye yönetimi `/api/v1/org/*` servislerindedir;
// eklentinin davet e-postası geri çağrısı aynı `emailEnqueue` yoluna bağlıdır (belirteç yalnız
// mühürlü sır; log/denetim/metrik yok). `membershipLimit` koltuk ön denetimidir; asıl denetim
// `members_seat_limit` tetikleyicisidir (EDA01).

import type { InvitableRole } from '@eda/contracts/api/org';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { organization } from 'better-auth/plugins/organization';
import type { AuthEmails } from '../app-auth.ts';
import type { createOrganizationHooks } from '../hooks/organization.ts';

export interface OrganizationPluginDeps {
  readonly hooks: ReturnType<typeof createOrganizationHooks>;
  readonly emails: AuthEmails;
  /** Kabul ön denetimi: kapasite (dolu ise 409 `SEAT_LIMIT_REACHED` fırlatır). */
  readonly membershipLimit: (userId: string, orgId: string) => Promise<number>;
}

export function organizationPlugin(deps: OrganizationPluginDeps) {
  return organization({
    allowUserToCreateOrganization: false,
    disableOrganizationDeletion: true,
    creatorRole: 'owner',
    invitationExpiresIn: CONFIG_DEFAULTS['auth.inviteTtlHours'] * 3600,
    cancelPendingInvitationsOnReInvite: true,
    requireEmailVerificationOnInvitation: true,
    membershipLimit: (user, org) => deps.membershipLimit(user.id, org.id),
    schema: {
      organization: {
        additionalFields: {
          kind: { type: 'string', required: false, input: false },
          partnerCode: { type: 'string', required: false, input: false },
          suspendedAt: { type: 'date', required: false, input: false },
          closedAt: { type: 'date', required: false, input: false },
        },
      },
      member: {
        additionalFields: {
          status: { type: 'string', required: false, input: false, defaultValue: 'active' },
        },
      },
    },
    sendInvitationEmail: async (data) => {
      await deps.emails.invitation(
        data.inviter.user.id,
        data.id,
        data.role as InvitableRole,
        new Date(data.invitation.expiresAt),
      );
    },
    organizationHooks: deps.hooks,
  });
}
