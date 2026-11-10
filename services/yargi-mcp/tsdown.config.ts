import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  fixedExtension: false,
  noExternal: [/^@eda\//],
  // valkey-cache Lua scriptleri çalışma anında `dist/<ad>.lua` olarak okunur (resilience/valkey.ts).
  copy: [{ from: 'src/resilience/*.lua', to: 'dist' }],
});
