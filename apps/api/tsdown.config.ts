import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { main: 'src/main.ts', cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  fixedExtension: false,
  noExternal: [/^@eda\//],
});
