// `invitation` (045 §7.3; action; P04b kullanır): büro daveti. Büro adı ve davet eden adı parametre
// değil, gönderim anında çözülen bağlamdır (params serbest metin taşımaz).
import type { TemplateParams } from '../catalog.ts';
import type { EmailContent, RenderContext } from '../content.ts';
import { ROLE_LABELS, secret } from '../content.ts';
import { createLinks } from '../links.ts';

export function content(p: TemplateParams<'invitation'>, ctx: RenderContext): EmailContent {
  const href = createLinks(ctx.appUrl).invitation(secret(ctx, 'token'));
  const inv = ctx.invitation;
  return {
    class: 'action',
    heading: 'Büro daveti',
    greetingName: null,
    blocks: [
      {
        kind: 'paragraph',
        text:
          inv === undefined
            ? 'Bir büro sizi E.D.A. Hukuk çalışma alanına davet etti.'
            : `${inv.inviterName}, sizi ${inv.orgName} bürosuna E.D.A. Hukuk çalışma alanında davet etti.`,
      },
      { kind: 'keyValue', items: [['Rol', ROLE_LABELS[p.role] ?? p.role]] },
      { kind: 'button', label: 'Daveti görüntüle', href },
      {
        kind: 'paragraph',
        text: `Davet ${p.expiresInHours} saat geçerlidir ve yalnız bir kez kullanılabilir. Parolanızı siz belirlersiniz.`,
      },
      { kind: 'paragraph', text: 'Bu daveti beklemiyorsanız bu iletiyi yok sayabilirsiniz.' },
    ],
  };
}
