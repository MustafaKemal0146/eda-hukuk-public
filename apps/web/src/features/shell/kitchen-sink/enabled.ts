// Vitrin yalnız geliştirme ortamında açılır (P05.14, KK-013-10). Saf karar fonksiyonu; birim testli.
import type { EdaEnv } from '../../../config/env.ts';

export function isKitchenSinkEnabled(env: EdaEnv): boolean {
  return env === 'development';
}
