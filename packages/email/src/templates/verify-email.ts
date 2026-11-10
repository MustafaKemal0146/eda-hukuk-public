// `verify_email` (045 §7.3; action): tek kullanımlık doğrulama bağlantısı.
import type { TemplateParams } from '../catalog.ts';
import type { EmailContent, RenderContext } from '../content.ts';
import { secret } from '../content.ts';
import { createLinks } from '../links.ts';

export function content(p: TemplateParams<'verify_email'>, ctx: RenderContext): EmailContent {
  const href = createLinks(ctx.appUrl).verifyEmail(secret(ctx, 'token'));
  return {
    class: 'action',
    heading: 'E-posta adresinizi doğrulayın',
    greetingName: ctx.recipientName,
    blocks: [
      {
        kind: 'paragraph',
        text: 'E.D.A. Hukuk hesabınızı etkinleştirmek için e-posta adresinizi doğrulayın.',
      },
      { kind: 'button', label: 'E-posta adresimi doğrula', href },
      {
        kind: 'paragraph',
        text: `Bağlantı ${p.expiresInMin} dakika geçerlidir ve yalnız bir kez kullanılabilir.`,
      },
      { kind: 'paragraph', text: 'Bu işlemi siz başlatmadıysanız bu iletiyi yok sayabilirsiniz.' },
    ],
  };
}
