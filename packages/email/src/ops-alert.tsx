// İç işletim uyarısı: kaynak kanaryası durum değişimi (021 §7.3). Alıcı kullanıcı değil, destek adresidir
// (`supportAddress(APP_DOMAIN)`); bu yüzden e-posta kataloğu/teslimat tablosu yerine worker doğrudan
// taşımayla gönderir. İçerik yoktur: yalnız kaynak adı ve durum (sorgu, yanıt, hata metni YOK).
// Kullanıcıya görünen kaynak adlarında iç kod anahtarı geçmez; karar kaynağının görünen adı "UYAP"tır.
import type { SourceCanaryProbe } from '@eda/contracts/enums';
import { render } from '@react-email/render';
import { SUBJECT_MAX_LENGTH } from './catalog.ts';
import type { EmailContent } from './content.ts';
import { EmailLayout } from './layout.tsx';
import { renderText } from './text.ts';

export { supportAddress } from './brand.ts';

export const SOURCE_CANARY_ALERT_VERSION = '2026-10-17.1';

/** Kaynak yoklamalarının görünen adları (yönetim paneli kartıyla aynı adlar). */
export const SOURCE_CANARY_PROBE_LABELS: Readonly<Record<SourceCanaryProbe, string>> = {
  uyap_search: 'UYAP karar araması',
  anayasa_search: 'Anayasa Mahkemesi karar araması',
  uyusmazlik_search: 'Uyuşmazlık Mahkemesi karar araması',
  mevzuat_search: 'Mevzuat araması',
  mevzuat_article: 'Mevzuat madde getirme',
};

export type SourceCanaryAlertKind = 'degraded' | 'recovered';

export interface SourceCanaryAlertInput {
  readonly kind: SourceCanaryAlertKind;
  /** Bu uyarıya konu olan (durumu değişen) yoklamalar. */
  readonly changed: readonly SourceCanaryProbe[];
  /** Tüm yoklamaların güncel durumu (`true` = bozuk). */
  readonly failing: Readonly<Record<SourceCanaryProbe, boolean>>;
  /** Bozulma eşiği (`sources.canaryFailThreshold`). */
  readonly threshold: number;
}

const FOOTER =
  'Bu ileti E.D.A. Hukuk günlük kaynak kontrolünün otomatik işletim uyarısıdır; kullanıcı içeriği taşımaz. Durum değişmedikçe yeni ileti gönderilmez.';

function content(input: SourceCanaryAlertInput): EmailContent {
  const names = input.changed.map((p) => SOURCE_CANARY_PROBE_LABELS[p]);
  const all = (Object.keys(SOURCE_CANARY_PROBE_LABELS) as SourceCanaryProbe[]).map(
    (p) => [SOURCE_CANARY_PROBE_LABELS[p], input.failing[p] ? 'Bozuk' : 'Çalışıyor'] as const,
  );
  return {
    class: 'service',
    heading: input.kind === 'degraded' ? 'Resmî kaynakta bozulma' : 'Resmî kaynak düzeldi',
    greetingName: null,
    blocks: [
      {
        kind: 'paragraph',
        text:
          input.kind === 'degraded'
            ? `Günlük kaynak kontrolünde şu yoklamalar art arda ${input.threshold} kez başarısız oldu: ${names.join(', ')}.`
            : `Günlük kaynak kontrolünde şu yoklamalar yeniden başarılı: ${names.join(', ')}.`,
      },
      { kind: 'keyValue', items: all },
      {
        kind: 'paragraph',
        text: 'Ayrıntı yönetim panelinde Sistem > Kaynak durumu kartındadır. Canlı arama düşerse yerel arşiv ve resmî portal bağlantıları devrede kalır.',
      },
    ],
    footer: FOOTER,
  };
}

export function sourceCanaryAlertSubject(input: SourceCanaryAlertInput): string {
  const first = input.changed[0];
  const name = first === undefined ? '' : SOURCE_CANARY_PROBE_LABELS[first];
  const more = input.changed.length > 1 ? ` (+${input.changed.length - 1})` : '';
  return input.kind === 'degraded'
    ? `Kaynak bozulması: ${name}${more}`
    : `Kaynak düzeldi: ${name}${more}`;
}

export interface RenderedOpsAlert {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export async function renderSourceCanaryAlert(
  input: SourceCanaryAlertInput,
  companyName: string | null,
): Promise<RenderedOpsAlert> {
  if (input.changed.length === 0) throw new Error('uyarı için değişen yoklama yok');
  const subject = sourceCanaryAlertSubject(input);
  if (subject.length > SUBJECT_MAX_LENGTH) throw new Error('konu satırı sınırı aşıyor');
  const c = content(input);
  const rendered = await render(
    <EmailLayout content={c} subject={subject} companyName={companyName} />,
  );
  return {
    subject,
    html: rendered.replace(/^<!DOCTYPE[^>]*>/i, '<!DOCTYPE html>'),
    text: renderText(c, companyName),
  };
}
