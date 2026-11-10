import base from '@eda/config/vitest/node';
import { defineConfig, mergeConfig } from 'vitest/config';

// Next tsconfig'i `jsx: preserve` kullanır; bileşen testleri (renderToStaticMarkup) için dönüştürücü
// otomatik JSX çalışma zamanına ayarlanır.
export default mergeConfig(base, defineConfig({ oxc: { jsx: { runtime: 'automatic' } } }));
