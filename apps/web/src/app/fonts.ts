// Yazı tipi yükleme (051 §6.1, §16): Geist (arayüz), Source Serif 4 (ölçülü başlık), Geist Mono
// (künye, sayı), Liberation Serif (A4 belge). Dosyalar packages/ui/fonts/ altında self-host edilir
// (CDN yok, CSP `font-src 'self'`); paylaşılan pakette localFont() çağrılmaz (013 kural 13).
// next/font derleme anında çözümlenir: yollar düz dize olmalıdır (şablon dizesi kabul edilmez).
// latin ve latin-ext aynı yüzün iki kaynağıdır; Türkçe glifler latin-ext dosyasındadır.
import localFont from 'next/font/local';

const ui = localFont({
  src: [
    {
      path: '../../../../packages/ui/fonts/geist-var-latin-ext.woff2',
      weight: '100 900',
      style: 'normal',
    },
    {
      path: '../../../../packages/ui/fonts/geist-var-latin.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-ui',
  display: 'swap',
  preload: true,
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Noto Sans', 'sans-serif'],
});

const serif = localFont({
  src: [
    {
      path: '../../../../packages/ui/fonts/source-serif-4-var-latin-ext.woff2',
      weight: '200 900',
      style: 'normal',
    },
    {
      path: '../../../../packages/ui/fonts/source-serif-4-var-latin.woff2',
      weight: '200 900',
      style: 'normal',
    },
  ],
  variable: '--font-serif',
  display: 'swap',
  preload: true,
  adjustFontFallback: 'Times New Roman',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

const mono = localFont({
  src: [
    {
      path: '../../../../packages/ui/fonts/geist-mono-var-latin-ext.woff2',
      weight: '100 900',
      style: 'normal',
    },
    {
      path: '../../../../packages/ui/fonts/geist-mono-var-latin.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-mono-face',
  display: 'swap',
  preload: false,
  fallback: ['ui-monospace', 'Cascadia Mono', 'Menlo', 'Consolas', 'monospace'],
});

const paper = localFont({
  src: [
    {
      path: '../../../../packages/ui/fonts/liberation-serif-regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../../../packages/ui/fonts/liberation-serif-bold.woff2',
      weight: '700',
      style: 'normal',
    },
    {
      path: '../../../../packages/ui/fonts/liberation-serif-italic.woff2',
      weight: '400',
      style: 'italic',
    },
    {
      path: '../../../../packages/ui/fonts/liberation-serif-bolditalic.woff2',
      weight: '700',
      style: 'italic',
    },
  ],
  variable: '--font-liberation-serif',
  display: 'swap',
  preload: false,
  fallback: ['Times New Roman', 'Times', 'serif'],
});

/** Kök <html> öğesine eklenen dört CSS değişkeni sınıfı. */
export const fontVariables = [ui.variable, serif.variable, mono.variable, paper.variable].join(' ');
