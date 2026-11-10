// `factor_changed` (045 §7.3; security; P04b kullanır): ikinci adım doğrulama / passkey değişikliği.
import type { TemplateParams } from '../catalog.ts';
import { type EmailContent, NO_LINK_NOTICE, type RenderContext } from '../content.ts';
import { formatDateTime } from '../format.ts';

export function content(p: TemplateParams<'factor_changed'>, ctx: RenderContext): EmailContent {
  const what =
    p.factor === 'totp'
      ? `İkinci adım doğrulama ${p.action === 'added' ? 'etkinleştirildi' : 'kaldırıldı'}.`
      : `Hesabınıza bir passkey ${p.action === 'added' ? 'eklendi' : 'kaldırıldı'}.`;
  return {
    class: 'security',
    heading: 'Hesap güvenliği değişikliği',
    greetingName: ctx.recipientName,
    blocks: [
      { kind: 'paragraph', text: what },
      { kind: 'keyValue', items: [['Zaman', formatDateTime(p.changedAt)]] },
      { kind: 'paragraph', text: 'Bu değişikliği siz yaptıysanız işlem gerekmez.' },
      {
        kind: 'notice',
        text: 'Bu değişikliği siz yapmadıysanız parolanızı değiştirin ve büro sahibinize hemen bildirin.',
      },
      { kind: 'paragraph', text: NO_LINK_NOTICE },
    ],
  };
}
