// `password_changed` (045 §7.3; security): bağlantısız güvenlik bildirimi.
import type { TemplateParams } from '../catalog.ts';
import { type EmailContent, NO_LINK_NOTICE, type RenderContext } from '../content.ts';
import { formatDateTime } from '../format.ts';

export function content(p: TemplateParams<'password_changed'>, ctx: RenderContext): EmailContent {
  return {
    class: 'security',
    heading: 'Parolanız değiştirildi',
    greetingName: ctx.recipientName,
    blocks: [
      { kind: 'paragraph', text: 'Hesabınızın parolası değiştirildi.' },
      { kind: 'keyValue', items: [['Zaman', formatDateTime(p.changedAt)]] },
      { kind: 'paragraph', text: 'Bu değişikliği siz yaptıysanız işlem gerekmez.' },
      {
        kind: 'notice',
        text: 'Bu değişikliği siz yapmadıysanız büro sahibinize ve destek ekibine hemen bildirin.',
      },
      { kind: 'paragraph', text: NO_LINK_NOTICE },
    ],
  };
}
