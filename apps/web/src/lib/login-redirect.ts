// Girişe yönlendirme adresi: dönüş yolu `safeNext` ile doğrulanır (açık yönlendirme yok); geçersiz
// veya eksik yol varsayılan `/sohbet`'e düşer.
import { safeNext } from './safe-next.ts';

/** Proxy'nin sunucu düzenine ilettiği istek yolu başlığı (dönüş adresi için). */
export const PATH_HEADER = 'x-eda-path';

export function loginHref(path: string | null | undefined): string {
  return `/giris?sonraki=${encodeURIComponent(safeNext(path))}`;
}
