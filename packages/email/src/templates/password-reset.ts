// `password_reset` (045 §7.3; action): tek kullanımlık sıfırlama bağlantısı.
import type { TemplateParams } from '../catalog.ts';
import type { EmailContent, RenderContext } from '../content.ts';
import { secret } from '../content.ts';
import { createLinks } from '../links.ts';

export function content(p: TemplateParams<'password_reset'>, ctx: RenderContext): EmailContent {
  const href = createLinks(ctx.appUrl).resetPassword(secret(ctx, 'token'));
  return {
    class: 'action',
    heading: 'Parola sıfırlama talebiniz',
    greetingName: ctx.recipientName,
    blocks: [
      { kind: 'paragraph', text: 'Hesabınız için parola sıfırlama talebi aldık.' },
      { kind: 'button', label: 'Yeni parola belirle', href },
      {
        kind: 'paragraph',
        text: `Bağlantı ${p.expiresInMin} dakika geçerlidir ve yalnız bir kez kullanılabilir. Parola sıfırlandığında açık oturumlarınız kapanır.`,
      },
      { kind: 'paragraph', text: 'Talebi siz yapmadıysanız işlem gerekmez; parolanız değişmez.' },
    ],
  };
}
