// `registration_attempt` (yeni; 042 §2.8, 053-ekranlar/01 §5.3; security; bağlantısız): mevcut
// e-postayla tekrar kayıt denemesinde var olan hesaba gider.
import type { TemplateParams } from '../catalog.ts';
import { type EmailContent, NO_LINK_NOTICE, type RenderContext } from '../content.ts';
import { formatDateTime } from '../format.ts';

export function content(
  p: TemplateParams<'registration_attempt'>,
  ctx: RenderContext,
): EmailContent {
  return {
    class: 'security',
    heading: 'Kayıt denemesi',
    greetingName: ctx.recipientName,
    blocks: [
      {
        kind: 'paragraph',
        text: 'E-posta adresinizle yeni bir E.D.A. Hukuk hesabı açılmak istendi. Bu adresle zaten bir hesabınız olduğu için yeni hesap açılmadı.',
      },
      { kind: 'keyValue', items: [['Zaman', formatDateTime(p.attemptAt)]] },
      {
        kind: 'paragraph',
        text: 'Bu denemeyi siz yaptıysanız işlem gerekmez; mevcut hesabınızla giriş yapabilir veya parolanızı sıfırlayabilirsiniz.',
      },
      {
        kind: 'notice',
        text: 'Bu denemeyi siz yapmadıysanız hesabınız etkilenmedi; parolanızı kimseyle paylaşmayın.',
      },
      { kind: 'paragraph', text: NO_LINK_NOTICE },
    ],
  };
}
