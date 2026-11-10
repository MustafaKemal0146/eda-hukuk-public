'use client';
// Ayarlar görünümü (P23 ilk dilim; 053-08): profil, güvenlik, görünüm, yapay zekâ ve büro
// sekmeleri. Veri çekmez; yalnız çizim ve form içi durumlar buradadır (`settings-home.tsx` kabı
// yükler). Tüm metinler `tr.json` `settings.*` anahtarlarından gelir; kod içinde metin yoktur.
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageContainer,
  PageHeader,
  PasswordInput,
  SegmentedControl,
  Select,
  Skeleton,
} from '@eda/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { AuthApiError } from '../../lib/auth-api.ts';
import type { Density, Theme } from '../shell/ui-prefs.ts';
import { AiKeysPanel, type AiKeysPanelProps } from './ai-keys-panel.tsx';
import { NotificationsPanel, type NotificationsPanelProps } from './notifications-panel.tsx';
import { SessionsPanel } from './sessions-panel.tsx';
import {
  hasAccount,
  initialsOf,
  orgKindKey,
  PASSWORD_MIN_LENGTH,
  type PasswordIssue,
  passwordIssue,
  roleKey,
  SETTINGS_GROUPS,
  type SettingsModel,
  type SettingsTab,
  STEP_UP_CODES,
  stepUpHref,
  verificationKey,
} from './settings-model.ts';

export type SettingsLoadState = 'loading' | 'ready' | 'error';

export interface SettingsViewProps {
  readonly state: SettingsLoadState;
  /** Sekme durumu dışarıdan verilmezse `profile` açılır (test ve derin bağlantı için). */
  readonly initialTab?: SettingsTab;
  /** Bölüm değişince çağrılır (adres çubuğu eşitlemesi; `settings-home.tsx`). */
  readonly onTabChange?: (tab: SettingsTab) => void;
  readonly model: SettingsModel | null;
  readonly requestId: string | null;
  readonly onRetry: () => void;
  readonly theme: Theme;
  readonly density: Density;
  readonly onTheme: (theme: Theme) => void;
  readonly onDensity: (density: Density) => void;
  readonly mode: 'fast' | 'deep';
  readonly onMode: (mode: 'fast' | 'deep') => void;
  readonly masking: boolean;
  readonly onMasking: (masking: boolean) => void;
  readonly onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Bildirim matrisi durumu ve olayları; e-posta doğrulaması ile rol `model`'den türetilir. */
  readonly notifications: Omit<NotificationsPanelProps, 'emailVerified' | 'role'>;
  /** API anahtarı durumu ve olayları (#54 BYOK). */
  readonly apiKeys: AiKeysPanelProps;
}

const VERIFICATION_TONE = {
  'profile.verification.verified': 'success',
  'profile.verification.pending_verification': 'warning',
  'profile.verification.rejected': 'danger',
  'profile.verification.suspended': 'danger',
} as const;

const LINK_CLASS =
  'text-body-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:focus-ring';

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-baslik`}
      className="rounded-lg border border-border bg-surface shadow-1"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 id={`${id}-baslik`} className="text-title text-fg">
          {title}
        </h2>
        <p className="mt-0.5 text-body-sm text-fg-muted">{description}</p>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:gap-8">
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-fg">{label}</p>
        {hint && <p className="mt-0.5 text-caption text-fg-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function YesNo({ on, labels }: { on: boolean; labels: { on: string; off: string } }) {
  return (
    <Badge tone={on ? 'success' : 'neutral'} icon={on ? 'status.verified' : 'notice.info'}>
      {on ? labels.on : labels.off}
    </Badge>
  );
}

function PasswordForm({
  onChangePassword,
}: {
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const t = useTranslations('settings.security');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<PasswordIssue | null>(null);
  const [failed, setFailed] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const [saved, setSaved] = useState(false);
  const labels = { show: t('showPassword'), hide: t('hidePassword') };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailed(false);
    setStepUp(false);
    setSaved(false);
    const problem = passwordIssue(next, confirmation);
    setIssue(problem);
    if (problem !== null) return;
    setBusy(true);
    try {
      await onChangePassword(current, next);
      setSaved(true);
      setCurrent('');
      setNext('');
      setConfirmation('');
    } catch (error) {
      if (error instanceof AuthApiError && STEP_UP_CODES.includes(error.code)) setStepUp(true);
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {failed && (
        <Alert tone="danger" live>
          {t('failed')}
        </Alert>
      )}
      {stepUp && (
        <Alert
          tone="warning"
          title={t('stepUpTitle')}
          live
          actions={
            <Link href={stepUpHref('/ayarlar')} className={LINK_CLASS}>
              {t('stepUpAction')}
            </Link>
          }
        >
          {t('stepUpBody')}
        </Alert>
      )}
      {saved && (
        <Alert tone="success" live>
          {t('saved')}
        </Alert>
      )}
      <Field label={t('current')}>
        <PasswordInput
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          labels={labels}
        />
      </Field>
      <Field
        label={t('new')}
        description={t('passwordBody', { min: PASSWORD_MIN_LENGTH })}
        {...(issue === 'too_short' ? { error: t('tooShort', { min: PASSWORD_MIN_LENGTH }) } : {})}
      >
        <PasswordInput
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          labels={labels}
        />
      </Field>
      <Field label={t('confirm')} {...(issue === 'mismatch' ? { error: t('mismatch') } : {})}>
        <PasswordInput
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          autoComplete="new-password"
          labels={labels}
        />
      </Field>
      <div>
        <Button
          type="submit"
          loading={busy}
          loadingLabel={t('saving')}
          disabled={current === '' || next === '' || confirmation === ''}
        >
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}

function ProfilePanel({ model }: { model: SettingsModel }) {
  const t = useTranslations('settings');
  const key = verificationKey(model.verificationStatus);
  return (
    <>
      <Section id="hesap" title={t('profile.title')} description={t('profile.body')}>
        <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
          <Field label={t('profile.name')}>
            <Input value={model.name} disabled readOnly autoComplete="name" />
          </Field>
          <Field
            label={t('profile.email')}
            {...(model.emailVerified ? {} : { description: t('profile.unverifiedEmail') })}
          >
            <Input type="email" value={model.email} disabled readOnly autoComplete="email" />
          </Field>
          {key !== null && (
            <div className="flex items-center gap-2">
              <span className="text-body-sm text-fg-muted">{t('profile.professionTitle')}</span>
              <Badge tone={VERIFICATION_TONE[key]} icon="status.verified">
                {t(key)}
              </Badge>
            </div>
          )}
        </div>
      </Section>
      <Section id="meslek" title={t('profile.professionTitle')} description={t('profile.readOnly')}>
        {model.profession === null ? (
          <p className="px-5 py-4 text-body-sm text-fg-muted">{t('profile.professionNone')}</p>
        ) : (
          <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
            <Field label={t('profile.baroName')}>
              <Input value={model.profession.baro} disabled readOnly />
            </Field>
            <Field label={t('profile.sicilNo')}>
              <Input value={model.profession.sicilNo ?? ''} disabled readOnly />
            </Field>
            {model.profession.traineeRegistryNo !== null && (
              <Field label={t('profile.traineeRegistryNo')}>
                <Input value={model.profession.traineeRegistryNo} disabled readOnly />
              </Field>
            )}
          </div>
        )}
      </Section>
    </>
  );
}

function SecurityPanel({
  model,
  onChangePassword,
}: {
  model: SettingsModel;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const t = useTranslations('settings.security');
  const onOff = { on: t('on'), off: t('off') };
  const fresh = model.stepUpValidUntil !== null;
  return (
    <>
      <Section
        id="parola"
        title={t('passwordTitle')}
        description={t('passwordBody', { min: PASSWORD_MIN_LENGTH })}
      >
        <div className="px-5 py-5">
          <PasswordForm onChangePassword={onChangePassword} />
        </div>
      </Section>
      <Section id="iki-adim" title={t('title')} description={t('body')}>
        <Row label={t('totp')} hint={t('totpHint')}>
          <div className="flex items-center gap-3">
            <YesNo on={model.twoFactorEnabled} labels={onOff} />
            {!model.twoFactorEnabled && (
              <Link
                href={`/iki-adimli?mod=kurulum&sonraki=${encodeURIComponent('/ayarlar?bolum=guvenlik')}`}
                className={LINK_CLASS}
              >
                {t('totpSetup')}
              </Link>
            )}
          </div>
        </Row>
        <Row label={t('passkey')}>
          <YesNo on={model.hasPasskey} labels={onOff} />
        </Row>
        <Row label={t('stepUpState')}>
          <Badge tone={fresh ? 'success' : 'neutral'}>
            {fresh ? t('stepUpValid') : t('stepUpExpired')}
          </Badge>
        </Row>
        <div className="px-5 py-4">
          <p className="text-body-sm font-medium text-fg">{t('backupTitle')}</p>
          <p className="mt-0.5 text-caption text-fg-muted">{t('backupBody')}</p>
          <div className="mt-2">
            <Link href={stepUpHref('/ayarlar')} className={LINK_CLASS}>
              {t('manage')}
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}

function AppearancePanel({
  theme,
  density,
  onTheme,
  onDensity,
}: {
  theme: Theme;
  density: Density;
  onTheme: (theme: Theme) => void;
  onDensity: (density: Density) => void;
}) {
  const t = useTranslations('settings.appearance');
  const tt = useTranslations('theme');
  return (
    <Section id="gorunum" title={t('title')} description={t('body')}>
      <Row label={t('theme')}>
        <SegmentedControl
          label={t('theme')}
          value={theme}
          onValueChange={(value) => onTheme(value as Theme)}
          options={[
            { value: 'light', label: tt('light'), icon: 'theme.light' },
            { value: 'dark', label: tt('dark'), icon: 'theme.dark' },
            { value: 'system', label: tt('system'), icon: 'theme.system' },
          ]}
        />
      </Row>
      <Row label={t('density')} hint={t('densityHint')}>
        <SegmentedControl
          label={t('density')}
          value={density}
          onValueChange={(value) => onDensity(value as Density)}
          options={[
            { value: 'comfortable', label: t('comfortable') },
            { value: 'compact', label: t('compact') },
          ]}
        />
      </Row>
    </Section>
  );
}

function AiPanel({
  mode,
  onMode,
}: {
  mode: 'fast' | 'deep';
  onMode: (mode: 'fast' | 'deep') => void;
}) {
  const t = useTranslations('settings.ai');
  const tc = useTranslations('chat');
  return (
    <Section id="yapay-zeka" title={t('title')} description={t('body')}>
      <Row label={t('defaultMode')} hint={t('defaultModeHint')}>
        <SegmentedControl
          label={t('defaultMode')}
          value={mode}
          onValueChange={(value) => onMode(value as 'fast' | 'deep')}
          options={[
            { value: 'fast', label: tc('modeFast') },
            { value: 'deep', label: tc('modeDeep') },
          ]}
        />
      </Row>
      <Row label={t('masking')} hint={t('maskingHint')}>
        <Badge tone="success" icon="status.secure">
          {t('maskingAlways')}
        </Badge>
      </Row>
    </Section>
  );
}

function OrgPanel({ model }: { model: SettingsModel }) {
  // Çözümleyici kökten: anahtar yardımcıları `org.*` önekiyle döner.
  const t = useTranslations('settings');
  if (model.org === null) {
    return (
      <Section id="buro" title={t('org.title')} description={t('org.body')}>
        <p className="px-5 py-4 text-body-sm text-fg-muted">{t('org.none')}</p>
      </Section>
    );
  }
  const kindKey = orgKindKey(model.org.kind);
  const role = roleKey(model.org.role);
  return (
    <Section id="buro" title={t('org.title')} description={t('org.readOnly')}>
      <Row label={t('org.name')}>
        <p className="text-body-sm text-fg">{model.org.name}</p>
      </Row>
      <Row label={t('org.kind')}>
        <p className="text-body-sm text-fg">{kindKey === null ? model.org.kind : t(kindKey)}</p>
      </Row>
      <Row label={t('org.role')}>
        <p className="text-body-sm text-fg">{role === null ? model.org.role : t(role)}</p>
      </Row>
    </Section>
  );
}

export function SettingsView(props: SettingsViewProps) {
  const t = useTranslations('settings');
  const tl = useTranslations('legal');
  const [tab, setTab] = useState<SettingsTab>(props.initialTab ?? 'profile');
  const model = props.model;

  if (props.state === 'loading') {
    return (
      <PageContainer>
        <PageHeader title={t('title')} description={t('intro')} />
        <p role="status" className="text-body-sm text-fg-muted">
          {t('loading')}
        </p>
        <div aria-busy="true" className="mt-4 flex flex-col gap-6">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (props.state === 'error' || model === null) {
    return (
      <PageContainer>
        <PageHeader title={t('title')} description={t('intro')} />
        <ErrorState
          title={t('error.title')}
          message={t('error.body')}
          onRetry={props.onRetry}
          {...(props.requestId === null ? {} : { requestId: props.requestId })}
          labels={{
            retry: t('error.retry'),
            retrying: t('error.retrying'),
            supportCode: t('error.supportCode'),
            copy: t('error.copy'),
            copied: t('error.copied'),
          }}
        />
      </PageContainer>
    );
  }

  if (!hasAccount(model)) {
    return (
      <PageContainer>
        <PageHeader title={t('title')} description={t('intro')} />
        <EmptyState
          icon="control.locked"
          title={t('signedOut.title')}
          description={t('signedOut.body')}
          actions={
            <Link href="/giris" className={LINK_CLASS}>
              {t('signedOut.action')}
            </Link>
          }
        />
      </PageContainer>
    );
  }

  const select = (next: SettingsTab) => {
    setTab(next);
    props.onTabChange?.(next);
  };
  const role = model.org === null ? null : roleKey(model.org.role);
  const vkey = verificationKey(model.verificationStatus);

  const panel = (() => {
    switch (tab) {
      case 'profile':
        return <ProfilePanel model={model} />;
      case 'security':
        return <SecurityPanel model={model} onChangePassword={props.onChangePassword} />;
      case 'sessions':
        return <SessionsPanel />;
      case 'appearance':
        return (
          <AppearancePanel
            theme={props.theme}
            density={props.density}
            onTheme={props.onTheme}
            onDensity={props.onDensity}
          />
        );
      case 'ai':
        return (
          <>
            <AiPanel mode={props.mode} onMode={props.onMode} />
            <AiKeysPanel {...props.apiKeys} />
          </>
        );
      case 'notifications':
        return (
          <NotificationsPanel
            {...props.notifications}
            emailVerified={model.emailVerified}
            role={model.org?.role ?? null}
          />
        );
      case 'org':
        return <OrgPanel model={model} />;
    }
  })();

  return (
    <PageContainer>
      <PageHeader title={t('title')} description={t('intro')} />
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-1">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft font-display text-title font-semibold text-fg"
        >
          {initialsOf(model.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-fg">{model.name}</p>
          <p className="truncate text-body-sm text-fg-muted">{model.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vkey !== null && (
            <Badge tone={VERIFICATION_TONE[vkey]} icon="status.verified">
              {t(vkey)}
            </Badge>
          )}
          {model.org !== null && (
            <Badge tone="neutral">
              {model.org.name}
              {role !== null ? ` · ${t(role)}` : ''}
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="lg:hidden">
          <Select
            aria-label={t('tabsLabel')}
            value={tab}
            onChange={(e) => select(e.target.value as SettingsTab)}
            options={SETTINGS_GROUPS.flatMap((g) =>
              g.tabs.map((k) => ({
                value: k,
                label: `${t(`groups.${g.key}`)} · ${t(`tabs.${k}`)}`,
              })),
            )}
          />
        </div>
        <nav
          aria-label={t('tabsLabel')}
          className="sticky top-4 hidden w-56 shrink-0 flex-col gap-5 lg:flex"
        >
          {SETTINGS_GROUPS.map((g) => (
            <div key={g.key} className="flex flex-col gap-0.5">
              <p className="px-3 pb-1 text-caption font-medium text-fg-subtle">
                {t(`groups.${g.key}`)}
              </p>
              {g.tabs.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-current={tab === k ? 'page' : undefined}
                  onClick={() => select(k)}
                  className={`rounded-md px-3 py-1.5 text-left text-body-sm transition-colors duration-fast focus-visible:focus-ring ${
                    tab === k
                      ? 'bg-primary-soft font-medium text-fg'
                      : 'text-fg-muted hover:bg-surface-sunken hover:text-fg'
                  }`}
                >
                  {t(`tabs.${k}`)}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {panel}
          <p className="text-caption text-fg-subtle">{tl('mandatory.y87')}</p>
        </div>
      </div>
    </PageContainer>
  );
}
