// drizzle-kit yalnız migrasyon DOSYASI üretir (032 §3); uygulayan tek bileşen src/migrate çalıştırıcısıdır.
// `push` ve `migrate` alt komutları hiçbir betikte kullanılmaz (Y-99). Roller initdb'dedir (031 §2.2).
// `casing` seçeneği bilinçli olarak yok: kolon adları şemada açık yazılır (030 §1.9).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['auth', 'app', 'corpus'],
  entities: { roles: false },
  strict: true,
  verbose: true,
  breakpoints: true,
});
