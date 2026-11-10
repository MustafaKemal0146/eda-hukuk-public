// Şablon örnek parametreleri (sentetik; "Örnek veri"). Belirteç ve kimlikler sabit test değerleridir.
import type { CatalogCode } from '../src/catalog.ts';
import type { RenderContext } from '../src/content.ts';

export const APP_URL = 'https://app.ornek.test';
export const TOKEN = 'ornek-belirtec-0123456789abcdef';
export const INVITATION_ID = '0198d2a4-0000-4000-8000-000000000001';

export const SAMPLE_PARAMS: { readonly [C in CatalogCode]: unknown } = {
  verify_email: { expiresInMin: 60 },
  password_reset: { expiresInMin: 60 },
  invitation: { role: 'lawyer', expiresInHours: 72 },
  password_changed: { changedAt: '2026-10-11T07:30:00Z' },
  factor_changed: { factor: 'totp', action: 'added', changedAt: '2026-10-11T07:30:00Z' },
  backup_codes_changed: { action: 'used', changedAt: '2026-10-11T07:30:00Z' },
  lawyer_application_received: { slaBusinessHours: 4 },
  verification_approved: { trialDays: 7, trialCredits: 30 },
  verification_rejected: { reasonCode: 'identity_mismatch', reapplyCooldownHours: 24 },
  registration_attempt: { attemptAt: '2026-10-11T07:30:00Z' },
};

export function sampleContext(code: CatalogCode): RenderContext {
  return {
    appUrl: APP_URL,
    recipientName: 'Örnek Kullanıcı',
    secrets: { token: code === 'invitation' ? INVITATION_ID : TOKEN },
    companyName: null,
  };
}
