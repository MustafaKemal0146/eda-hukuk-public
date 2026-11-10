// `backup_codes_changed` (045 §7.3; security; 042 §5.2): yedek kod kullanıldı veya yenilendi.
// `factor_changed`'ten ayrı şablon (045 §7.3: o yalnız ekleme/kaldırma); yalnız e-posta kanalı.
import type { TemplateParams } from '../catalog.ts';
import { type EmailContent, NO_LINK_NOTICE, type RenderContext } from '../content.ts';
import { formatDateTime } from '../format.ts';

export function content(
  p: TemplateParams<'backup_codes_changed'>,
  ctx: RenderContext,
): EmailContent {
  const what =
    p.action === 'used'
      ? 'Yedek kodunuz kullanıldı; bu kod artık yeniden kullanılamaz.'
      : 'Yedek kodlarınız yenilendi; önceki yedek kodlar geçersiz oldu.';
  return {
    class: 'security',
    heading: 'Hesap güvenliği: yedek kod değişikliği',
    greetingName: ctx.recipientName,
    blocks: [
      { kind: 'paragraph', text: what },
      { kind: 'keyValue', items: [['Zaman', formatDateTime(p.changedAt)]] },
      { kind: 'paragraph', text: 'Bu işlemi siz yaptıysanız işlem gerekmez.' },
      {
        kind: 'notice',
        text: 'Bu işlemi siz yapmadıysanız parolanızı değiştirin ve büro sahibinize bildirin.',
      },
      { kind: 'paragraph', text: NO_LINK_NOTICE },
    ],
  };
}
