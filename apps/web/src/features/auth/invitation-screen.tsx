'use client';
// `/davet/[token]` (053-01 §8; 042 §4.2): oturum yoksa genel kart (büro adı/rol gösterilmez); oturum
// varsa davet bilgisi, meslek gerektiren rolde meslek beyanı ve kabul sırası:
// (1) meslek başvurusu (davet kimliğiyle) (2) acceptInvitation (3) setActive (4) yönlendirme.
import { AlertDialog, Button, NoticeBanner, Skeleton } from '@eda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  AuthApiError,
  acceptInvitation,
  getInvitation,
  getMe,
  type MeSummary,
  rejectInvitation,
  setActiveOrganization,
} from '../../lib/auth-api.ts';
import { AuthErrorNotice } from './auth-notice.tsx';
import { ProfessionForm } from './profession-form.tsx';

const PROFESSION_ROLES = new Set(['lawyer', 'senior_lawyer', 'trainee', 'admin']);
const ROLE_KEYS = ['owner', 'admin', 'senior_lawyer', 'lawyer', 'trainee', 'assistant'] as const;
type RoleKey = (typeof ROLE_KEYS)[number];

type Invitation = { id: string; role: string; orgId: string; orgName: string; inviter: string };
type State =
  | { kind: 'loading' }
  | { kind: 'anon' }
  | { kind: 'ready'; me: MeSummary; invitation: Invitation }
  | { kind: 'error'; error: AuthApiError }
  | { kind: 'rejected' };

function parseInvitation(raw: Record<string, unknown>, id: string): Invitation {
  return {
    id,
    role: String(raw.role ?? ''),
    orgId: String(raw.organizationId ?? ''),
    orgName: String(raw.organizationName ?? ''),
    inviter: String(raw.inviterEmail ?? ''),
  };
}

export function InvitationScreen({ token }: { token: string }) {
  const t = useTranslations('auth.invite');
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [needsProfession, setNeedsProfession] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let me: MeSummary;
      try {
        me = await getMe();
      } catch (e) {
        if (!cancelled) {
          setState(
            e instanceof AuthApiError && (e.status === 401 || e.status === 403)
              ? { kind: 'anon' }
              : {
                  kind: 'error',
                  error:
                    e instanceof AuthApiError
                      ? e
                      : new AuthApiError({ status: 0, code: 'CLIENT_NETWORK', message: '' }),
                },
          );
        }
        return;
      }
      try {
        const raw = await getInvitation(token);
        if (!cancelled) {
          setState({ kind: 'ready', me, invitation: parseInvitation(raw, token) });
        }
      } catch (e) {
        if (!cancelled) {
          setState({
            kind: 'error',
            error:
              e instanceof AuthApiError
                ? e
                : new AuthApiError({ status: 0, code: 'CLIENT_NETWORK', message: '' }),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept(invitation: Invitation) {
    setBusy(true);
    try {
      await acceptInvitation(invitation.id);
      if (invitation.orgId !== '') await setActiveOrganization(invitation.orgId);
      const me = await getMe();
      router.replace(
        me.mfaRequired && me.mfaLevel === 'none'
          ? '/iki-adimli?mod=kurulum&sonraki=/sohbet'
          : '/sohbet',
      );
      router.refresh();
    } catch (e) {
      setState({
        kind: 'error',
        error:
          e instanceof AuthApiError
            ? e
            : new AuthApiError({ status: 0, code: 'CLIENT_NETWORK', message: '' }),
      });
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'loading') {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (state.kind === 'anon') {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-heading-lg text-fg">{t('title')}</h1>
        <p className="text-body-sm text-fg-muted">{t('notice')}</p>
        <div className="flex flex-col gap-3">
          <Button render={<Link href={`/giris?sonraki=/davet/${token}`} />}>
            {t('haveAccount')}
          </Button>
          <Button variant="outline" render={<Link href={`/kayit?davet=${token}`} />}>
            {t('createAccount')}
          </Button>
        </div>
      </div>
    );
  }
  if (state.kind === 'error') return <AuthErrorNotice error={state.error} />;
  if (state.kind === 'rejected') {
    return (
      <NoticeBanner tone="info" role="status">
        {t('rejected')}
      </NoticeBanner>
    );
  }

  const { invitation, me } = state;
  const roleKey = (ROLE_KEYS as readonly string[]).includes(invitation.role)
    ? (invitation.role as RoleKey)
    : null;
  const requiresProfession =
    PROFESSION_ROLES.has(invitation.role) && me.verificationStatus !== 'verified';
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-heading-lg text-fg">{t('title')}</h1>
      <dl className="flex flex-col gap-2 text-body-sm">
        <div className="flex gap-3">
          <dt className="w-28 shrink-0 text-fg-muted">{t('firm')}</dt>
          <dd className="text-fg">{invitation.orgName}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-28 shrink-0 text-fg-muted">{t('role')}</dt>
          <dd className="text-fg">{roleKey ? t(`roles.${roleKey}`) : invitation.role}</dd>
        </div>
        {invitation.inviter !== '' && (
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-fg-muted">{t('invitedBy')}</dt>
            <dd className="text-fg">{invitation.inviter}</dd>
          </div>
        )}
      </dl>
      {requiresProfession && needsProfession ? (
        <ProfessionForm
          invitationId={invitation.id}
          withReferral={false}
          submitLabel={t('accept')}
          onDone={() => void accept(invitation)}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {requiresProfession && (
            <p className="text-body-sm text-fg-muted">{t('professionNotice')}</p>
          )}
          <Button
            type="button"
            loading={busy}
            loadingLabel={t('accepting')}
            onClick={() =>
              requiresProfession ? setNeedsProfession(true) : void accept(invitation)
            }
          >
            {t('accept')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirmReject(true)}>
            {t('reject')}
          </Button>
        </div>
      )}
      <AlertDialog
        open={confirmReject}
        onOpenChange={setConfirmReject}
        title={t('rejectTitle')}
        destructiveLabel={t('rejectConfirm')}
        cancelLabel={t('rejectCancel')}
        tone="danger"
        onConfirm={() => {
          // Reddedilemeyen davet kullanıcıya yeni bir sonuç göstermez.
          void rejectInvitation(invitation.id).catch(() => undefined);
          setConfirmReject(false);
          setState({ kind: 'rejected' });
        }}
      />
    </div>
  );
}
