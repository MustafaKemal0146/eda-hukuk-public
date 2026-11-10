// `lawyer_application_received` (045 §7.3; service): başvuru alındı, inceleme hedefi.
import type { TemplateParams } from '../catalog.ts';
import type { EmailContent, RenderContext } from '../content.ts';
import { NO_ACTION } from '../content.ts';

export function content(
  p: TemplateParams<'lawyer_application_received'>,
  ctx: RenderContext,
): EmailContent {
  return {
    class: 'service',
    heading: 'Meslek başvurunuz alındı',
    greetingName: ctx.recipientName,
    blocks: [
      { kind: 'paragraph', text: 'Meslek bilgileriniz incelemeye alındı.' },
      {
        kind: 'paragraph',
        text: `İnceleme hedefi ${p.slaBusinessHours} iş saatidir; en geç 1 iş günü içinde sonuçlanır. Sonuç e-posta ve uygulama içi bildirimle iletilir.`,
      },
      {
        kind: 'paragraph',
        text: 'İnceleme sürerken Karar Arşivi, Mevzuat, süre hesaplayıcı ve Künye Kontrolü kullanılabilir.',
      },
      { kind: 'paragraph', text: NO_ACTION },
    ],
  };
}
