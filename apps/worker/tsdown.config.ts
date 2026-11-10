import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { main: 'src/main.ts', jobs: 'src/jobs.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  fixedExtension: false,
  noExternal: [/^@eda\//],
});
