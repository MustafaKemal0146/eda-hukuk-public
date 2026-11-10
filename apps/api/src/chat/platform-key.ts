// Platform ortak anahtarı: `PLATFORM_AI_KEY_FALLBACK=true` iken büro/kullanıcı anahtarı olmayan
// kullanıcılar için ortak anahtar AÇIK ve LİMİTLİ kullanılır (kaynak `platform`). Varsayılan kapalıdır; env
// bayrağı SERT kapıdır ve yalnız development/test/beta-synthetic ortamlarında geçerlidir (env şeması
// ayrıca reddeder; burada ikinci kapı). Anahtar yönetimden girilir (DB, şifreli) ya da sunucunun
// `anthropic_api_key` sır dosyasından gelir; çözümleme `services/ai-keys/platform-settings.ts`'tedir.
// Anahtar değeri yalnız bellekte tutulur, loga yazılmaz.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiCatalog } from '@eda/ai';
import { AI_CATALOG_SEED } from '@eda/db/ai-catalog';
import type { ApiConfig } from '../config/load.ts';

const ALLOWED_ENVS: readonly string[] = ['development', 'test', 'beta-synthetic'];

/** Bayrak açık ve ortam izinli mi (anahtarın tanımlı olup olmadığına bakmaz). */
export function platformFallbackEnabled(config: ApiConfig): boolean {
  return config.env.PLATFORM_AI_KEY_FALLBACK === true && ALLOWED_ENVS.includes(config.env.EDA_ENV);
}

/** Sunucudaki Anthropic sır dosyası (geriye uyumluluk; DB anahtarı yoksa); yoksa `null`. Değer çağıranın sorumluluğundadır (loglanmaz). */
export function readPlatformAnthropicKey(config: ApiConfig): string | null {
  const catalog = AiCatalog.parse(AI_CATALOG_SEED);
  const ref = catalog.providers.find((p) => p.id === 'anthropic')?.secretRef;
  if (!ref) return null;
  try {
    const v = readFileSync(join(String(config.env.SECRETS_DIR ?? '/run/secrets'), ref), 'utf8');
    return v.trim() === '' ? null : v.trim();
  } catch {
    return null;
  }
}
