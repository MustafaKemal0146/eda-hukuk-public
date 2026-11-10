// Uyarı metinleri (083 §6.4; sabit şablon, Hukuk onayı bekliyor). Kodlar 002 §11.11
// `DeadlineCalcDto.warnings[].code` kümesidir; çıktı sırası bu kümenin sırasıdır (determinizm).
import { DEADLINE_WARNING_CODES, type DeadlineWarningCode } from '@eda/contracts/enums';

const MESSAGES: Readonly<Record<Exclude<DeadlineWarningCode, 'holiday_data_missing'>, string>> = {
  half_day: "Hesaplamada yarım gün tatil (arife) bulunuyor; çalışma saati 13:00'te sona eriyor.",
  administrative_leave:
    "Hesap aralığında idari izin ilanı var. İdari izin günleri iş günü sayılır; adliye kapalı olabilir, UYAP'tan gönderin.",
  contested_extension:
    'Son gün tartışmalı bir güne denk geliyor. Güvenli olan erken tarihe göre işlem yapmak önerilir; hangi tarihe göre hareket edeceğinize siz karar verirsiniz.',
  saturday_shift:
    'Son gün Cumartesi gününe denk geldi; Cumartesi iş günü sayılmadı (varsayılan davranış, doğrulama bekliyor).',
  rule_unverified_preview: 'Bu kural henüz doğrulanmadı; yalnız yönetici önizlemesidir.',
};

export type DeadlineWarningOut = { code: DeadlineWarningCode; message: string };

/** Uyarı kümesini sabit sırayla mesajlarına çevirir. */
export function renderWarnings(
  codes: ReadonlySet<DeadlineWarningCode>,
  missingYears: readonly number[],
): DeadlineWarningOut[] {
  const out: DeadlineWarningOut[] = [];
  for (const code of DEADLINE_WARNING_CODES) {
    if (!codes.has(code)) continue;
    const message =
      code === 'holiday_data_missing'
        ? `Tatil verisi eksik olabilir; hesaplanan süreyi elle kontrol edin. Eksik yıllar: ${missingYears.join(', ')}.`
        : MESSAGES[code];
    out.push({ code, message });
  }
  return out;
}
