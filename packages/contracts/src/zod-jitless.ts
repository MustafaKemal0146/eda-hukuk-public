// Tarayıcıda Zod'un JIT derleyicisini kapatır. Zod 4, ilk nesne ayrıştırmasında `Function("")` ile
// `eval` iznini yoklar; nonce'lu CSP (`unsafe-eval` yok, 061 §2.3) bu yoklamayı ihlal olarak raporlar.
// `jitless` ayrıştırma sonucunu değiştirmez, yalnız derlenmiş hızlı yolu atlar.
import { z } from 'zod';

export function disableZodJit(): void {
  z.config({ jitless: true });
}
