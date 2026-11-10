// Ayarlar > Yapay zekâ API anahtarı modeli (#54 BYOK): API durumundan görünüm kararlarını türetir.
// Ağ erişimi ve React YOK: testler saf işlevleri çağırır. Anahtarın kendisi hiçbir yanıtta dönmez;
// ekranda yalnız son 4 karakter görünür.

import type { AiKeysStatusDtoValue } from '@eda/contracts/api/ai-keys';
import { AI_API_KEY_PATTERN, type AiKeySource } from '@eda/contracts/api/ai-keys';

export type AiKeysState = AiKeysStatusDtoValue;
export type AiKeysLoadState = 'loading' | 'ready' | 'error';
export type { AiKeySource };

/** Kayıt hatasının ekranda gösterilecek türü. */
export type AiKeySaveProblem =
  | 'rejected' // sağlayıcı anahtarı kabul etmedi
  | 'format' // yerel ön denetim: biçim
  | 'forbidden' // büro anahtarı için yetki yok
  | 'step_up' // yeniden doğrulama gerekli
  | 'unavailable' // sağlayıcıya ulaşılamadı
  | 'failed';

/** Yerel ön denetim (sunucu kuralı esastır): boşlukları atar, Anthropic anahtar biçimini arar. */
export function keyFormatIssue(raw: string): 'empty' | 'format' | null {
  const v = raw.trim();
  if (v === '') return 'empty';
  return AI_API_KEY_PATTERN.test(v) ? null : 'format';
}

/** Yeniden doğrulama gerektiren yanıt kodları (042 §6). */
export const STEP_UP_REQUIRED_CODES: readonly string[] = [
  'AUTH_STEP_UP_REQUIRED',
  'AUTH_MFA_REQUIRED',
];

/** Kayıt isteği hatasını ekran türüne çevirir. */
export function saveProblemOf(
  status: number,
  code: string,
  reason: string | null,
): AiKeySaveProblem {
  // Yeniden doğrulama (403 de olabilir) yetki hatasından ÖNCE ayrılır.
  if (STEP_UP_REQUIRED_CODES.includes(code)) return 'step_up';
  if (status === 422 && reason === 'api_key_rejected') return 'rejected';
  if (status === 422) return 'format';
  if (code === 'ORG_ROLE_INSUFFICIENT' || status === 403) return 'forbidden';
  if (status === 503) return 'unavailable';
  return 'failed';
}

/** "Bürodan çek" düğmesi: büro anahtarı tanımlıysa kaynak olarak seçilebilir. */
export function canUseOrgSource(s: AiKeysState): boolean {
  return s.org.configured;
}

/** Kaynak seçimi için görünen uyarı: seçili kaynakta anahtar yoksa hangi kaynak eksik. */
export function missingSource(s: AiKeysState): AiKeySource | null {
  if (s.usable) return null;
  return s.source;
}

/** Son 4 karakteri maskeli gösterir (`••••1234`); tanımsızsa `null`. */
export function maskedLast4(last4: string | null): string | null {
  return last4 === null ? null : `••••${last4}`;
}

/** Bir sonraki tur platformun ortak anahtarıyla mı çalışacak. */
export function usesPlatformKey(s: AiKeysState): boolean {
  return s.effectiveSource === 'platform';
}
