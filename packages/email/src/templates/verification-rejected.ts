// `verification_rejected` (045 §7.3; service; bağlantısız): neden sabit metin tablosundan gelir
// (serbest metin yok; 045 §4.1). Metinler hukuk onayı bekler.
import type { TemplateParams } from '../catalog.ts';
import type { EmailContent, RenderContext } from '../content.ts';

export const REJECTION_REASON_TEXTS: Readonly<
  Record<TemplateParams<'verification_rejected'>['reasonCode'], string>
> = {
  not_found_in_registry: 'Bildirdiğiniz sicil numarası baro kayıtlarında bulunamadı.',
  identity_mismatch: 'Hesap bilgileriniz baro kayıtlarındaki bilgilerle eşleşmedi.',
  incomplete_information: 'Başvuru bilgileri eksik veya okunamadı.',
  duplicate_registry: 'Bildirdiğiniz sicil numarası başka bir hesapla ilişkili.',
  not_eligible: 'Başvurunuz hizmetin meslek şartını karşılamıyor.',
  other: 'Başvurunuz bu aşamada onaylanamadı.',
};

export function content(
  p: TemplateParams<'verification_rejected'>,
  ctx: RenderContext,
): EmailContent {
  return {
    class: 'service',
    heading: 'Meslek başvurunuz hakkında',
    greetingName: ctx.recipientName,
    blocks: [
      { kind: 'paragraph', text: 'Meslek başvurunuz incelendi ve bu aşamada onaylanamadı.' },
      { kind: 'keyValue', items: [['Neden', REJECTION_REASON_TEXTS[p.reasonCode]]] },
      {
        kind: 'paragraph',
        text: `Bilgilerinizi düzelterek ${p.reapplyCooldownHours} saat sonra uygulamadan yeniden başvurabilirsiniz. Sorularınız için bu iletiyi yanıtlayabilirsiniz.`,
      },
    ],
  };
}
