// `verification_approved` (045 §7.3; service; Y bağlantı `/sohbet`): deneme bilgisi `trial.*`'tan
//.
import type { TemplateParams } from '../catalog.ts';
import type { EmailContent, RenderContext } from '../content.ts';
import { createLinks } from '../links.ts';

export function content(
  p: TemplateParams<'verification_approved'>,
  ctx: RenderContext,
): EmailContent {
  return {
    class: 'service',
    heading: 'Meslek başvurunuz onaylandı',
    greetingName: ctx.recipientName,
    blocks: [
      {
        kind: 'paragraph',
        text: 'Meslek doğrulamanız tamamlandı. Sohbet, dosyalar ve belgeler hesabınızda açıldı.',
      },
      {
        kind: 'keyValue',
        items: [
          ['Deneme süresi', `${p.trialDays} gün`],
          ['Deneme kredisi', `${p.trialCredits} kredi`],
        ],
      },
      { kind: 'paragraph', text: 'Deneme süresi bu onayla başladı; kart bilgisi istenmez.' },
      {
        kind: 'link',
        label: 'E.D.A. Hukuk çalışma alanını aç',
        href: createLinks(ctx.appUrl).chat(),
      },
    ],
  };
}
