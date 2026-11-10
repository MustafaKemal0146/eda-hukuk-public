import { defineConfig, type UserConfig } from 'tsdown';

// Yalnız src/bin/* -> dist/bin/* (013 §13, 032 §2). Migrasyon ve denetim SQL'leri imajda
// /app/migrations ve /app/audit altındadır; çalıştırıcı bunları paket kökünden okur
// (`new URL('../../', import.meta.url)`). Bu yüzden her giriş ayrı paketlenir: ortak parça
// (chunk) dist/ köküne düşerse göreli kök yolu kayar.
const base: UserConfig = {
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  fixedExtension: false,
  noExternal: [/^@eda\//],
  // @node-rs/argon2: yerel ikili (dev seed parola özeti; yalnız dev aşamasında yüklenir).
  external: ['pg', '@node-rs/argon2'],
};

export default defineConfig([
  { ...base, entry: { 'bin/migrate': 'src/bin/migrate.ts' } },
  { ...base, entry: { 'bin/seed': 'src/bin/seed.ts' }, clean: false },
]);
