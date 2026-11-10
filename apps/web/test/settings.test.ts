// @tk TK-33
// #28 (P23 ilk dilim): ayarlar ekranı sekmeleri, salt-okur kimlik/meslek/büro alanları, parola
// formu ve yükleme/hata/giriş-gerekli durumları. Model `/api/v1/me` gövdesinden türetilir; tüm
// metinler `tr.json`'dan gelir. Veriler sentetiktir.
import { MEMBER_ROLES, ORG_KINDS, VERIFICATION_STATUSES } from '@eda/contracts/enums';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import {
  hasAccount,
  orgKindKey,
  PASSWORD_MIN_LENGTH,
  passwordIssue,
  roleKey,
  SETTINGS_TABS,
  settingsModelOf,
  stepUpHref,
  verificationKey,
} from '../src/features/settings/settings-model.ts';
import { SettingsView, type SettingsViewProps } from '../src/features/settings/settings-view.tsx';

const ME: unknown = {
  user: {
    name: 'Örnek Avukat',
    email: 'ornek@ornek.test',
    emailVerified: true,
    verificationStatus: 'verified',
    twoFactorEnabled: true,
    hasPasskey: false,
  },
  session: { mfaLevel: 'totp', stepUpValidUntil: '2026-10-12T18:00:00+03:00' },
  profile: { baro: 'İstanbul', sicilNo: '12345', traineeRegistryNo: null },
  activeOrg: {
    name: 'Örnek Hukuk Bürosu',
    kind: 'firm',
    role: 'lawyer',
    mfa: { required: true, reason: 'mfa_required_org' },
  },
};

const noop = () => {};

const viewProps = (over: Partial<SettingsViewProps> = {}): SettingsViewProps => ({
  state: 'ready',
  model: settingsModelOf(ME),
  requestId: null,
  onRetry: noop,
  theme: 'system',
  density: 'comfortable',
  onTheme: noop,
  onDensity: noop,
  mode: 'fast',
  onMode: noop,
  masking: true,
  onMasking: noop,
  onChangePassword: async () => {},
  apiKeys: {
    state: 'ready',
    keys: null,
    requestId: null,
    busy: false,
    onRetry: noop,
    onSource: noop,
    onSaveOrg: async () => null,
    onRemoveOrg: noop,
    onSaveOwn: async () => null,
    onRemoveOwn: noop,
  },
  notifications: {
    state: 'ready',
    cells: [],
    savingKey: null,
    problem: null,
    requestId: null,
    onRetry: noop,
    onToggle: noop,
  },
  ...over,
});

const render = (over: Partial<SettingsViewProps> = {}): string =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'tr',
      messages,
      timeZone: 'Europe/Istanbul',
      children: createElement(SettingsView, viewProps(over)),
    }),
  );

describe('#28: ayarlar ekranı', () => {
  it('model `/api/v1/me` gövdesinden türetilir; eksik alanlar güvenli varsayılana düşer', () => {
    const m = settingsModelOf(ME);
    expect(m).toMatchObject({
      name: 'Örnek Avukat',
      email: 'ornek@ornek.test',
      emailVerified: true,
      verificationStatus: 'verified',
      twoFactorEnabled: true,
      hasPasskey: false,
      mfaRequired: true,
      stepUpValidUntil: '2026-10-12T18:00:00+03:00',
    });
    expect(m.profession).toEqual({ baro: 'İstanbul', sicilNo: '12345', traineeRegistryNo: null });
    expect(m.org).toEqual({ name: 'Örnek Hukuk Bürosu', kind: 'firm', role: 'lawyer' });

    const empty = settingsModelOf({});
    expect(hasAccount(empty)).toBe(false);
    expect(empty.profession).toBeNull();
    expect(empty.org).toBeNull();
    expect(empty.mfaRequired).toBe(false);
    expect(settingsModelOf(null).name).toBe('');
  });

  it('parola ön denetimi sınırdaki kısalığı ve uyuşmazlığı ayırır', () => {
    expect(passwordIssue('a'.repeat(PASSWORD_MIN_LENGTH - 1), 'x')).toBe('too_short');
    expect(passwordIssue('a'.repeat(PASSWORD_MIN_LENGTH), 'b')).toBe('mismatch');
    expect(
      passwordIssue('a'.repeat(PASSWORD_MIN_LENGTH), 'a'.repeat(PASSWORD_MIN_LENGTH)),
    ).toBeNull();
  });

  it('step-up yönlendirmesi dönüş yolunu taşır; bilinmeyen enum değeri anahtarsızdır', () => {
    expect(stepUpHref('/ayarlar')).toBe('/iki-adimli?sonraki=%2Fayarlar');
    for (const s of VERIFICATION_STATUSES) expect(verificationKey(s), s).not.toBeNull();
    expect(verificationKey('bilinmeyen')).toBeNull();
    for (const k of ORG_KINDS) expect(orgKindKey(k), k).not.toBeNull();
    for (const r of MEMBER_ROLES) expect(roleKey(r), r).not.toBeNull();
    expect(roleKey('partner_owner')).toBeNull();
  });

  it('sekme etiketleri ve salt-okur kimlik/meslek alanları metin kataloğundan çizilir', () => {
    const html = render();
    const s = messages.settings;
    for (const tab of SETTINGS_TABS) expect(html, tab).toContain(s.tabs[tab]);
    expect(html).toContain(s.profile.title);
    expect(html).toContain(s.profile.professionTitle);
    expect(html).toContain(s.profile.baroName);
    expect(html).toContain('Örnek Avukat');
    expect(html).toContain('ornek@ornek.test');
    expect(html).toContain('İstanbul');
    expect(html).toContain(s.profile.verification.verified);
    // Kimlik ve meslek alanları düzenlenemez (salt okunur).
    expect((html.match(/disabled/gi) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((html.match(/readonly/gi) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('güvenlik sekmesi parola formunu ve iki adımlı doğrulama durumunu gösterir', () => {
    const html = render({ initialTab: 'security' });
    const s = messages.settings.security;
    for (const label of [
      s.passwordTitle,
      s.current,
      s.new,
      s.confirm,
      s.submit,
      s.totp,
      s.passkey,
      s.stepUpState,
      s.backupTitle,
      s.backupBody,
    ]) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain('type="password"');
    expect(html).toContain(s.on);
    expect(html).toContain(s.stepUpValid);
  });

  it('görünüm ve büro sekmeleri cihaz tercihleri ile salt-okur büro künyesini çizer', () => {
    const appearance = render({ initialTab: 'appearance' });
    expect(appearance).toContain(messages.theme.light);
    expect(appearance).toContain(messages.theme.dark);
    expect(appearance).toContain(messages.settings.appearance.density);

    const org = render({ initialTab: 'org' });
    expect(org).toContain(messages.settings.org.readOnly);
    expect(org).toContain(messages.settings.org.roles.lawyer);
    expect(org).toContain(messages.settings.org.kinds.firm);
    expect(org).toContain('Örnek Hukuk Bürosu');

    const noOrg = render({ initialTab: 'org', model: settingsModelOf({ user: { name: 'A' } }) });
    expect(noOrg).toContain(messages.settings.org.none);
  });

  it('yükleme, hata ve giriş-gerekli durumları ayrı çizilir', () => {
    const loading = render({ state: 'loading' });
    expect(loading).toContain(messages.settings.loading);
    expect(loading).toContain('aria-busy="true"');

    const error = render({ state: 'error', requestId: '01990000-0000-7000-8000-0000000000ff' });
    expect(error).toContain(messages.settings.error.title);
    expect(error).toContain(messages.settings.error.retry);
    expect(error).toContain('01990000-0000-7000-8000-0000000000ff');

    const signedOut = render({ model: settingsModelOf({}) });
    expect(signedOut).toContain(messages.settings.signedOut.title);
    expect(signedOut).toContain('/giris');
  });

  it('tüm kurum rolü, türü ve doğrulama durumu için `tr` metni vardır', () => {
    const s = messages.settings;
    for (const role of MEMBER_ROLES) expect(s.org.roles[role], role).toBeTruthy();
    for (const kind of ORG_KINDS) expect(s.org.kinds[kind], kind).toBeTruthy();
    for (const status of VERIFICATION_STATUSES)
      expect(s.profile.verification[status], status).toBeTruthy();
    for (const tab of SETTINGS_TABS) expect(s.tabs[tab], tab).toBeTruthy();
  });
});
