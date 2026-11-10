// Tanıtım sayfası yazı tipleri (yalnız kök alan adındaki ana sayfa): Hanken Grotesk (gövde + görüntü)
// ve Instrument Serif italik (başlıklarda tek sözcüklük vurgu). Dosyalar apps/web/fonts/marketing/
// altında self-host edilir (CDN yok, CSP `font-src 'self'`; lisans: aynı dizindeki LICENSES.md).
// next/font/local tek çağrıda alt küme başına `unicode-range` veremez: `latin` ve `latin-ext` dosyaları
// ayrı çağrılarla, kendi kod aralığıyla bildirilir ve CSS yığınında yan yana kullanılır
// (`--mk-sans`, `--mk-serif`: src/tokens/marketing.css). Türkçe glifler (ğ ı İ ş) latin-ext dosyasından,
// temel harfler latin dosyasından gelir; tarayıcı glifi yığındaki ilk uygun aileden alır.
// `declarations` değerleri Turbopack'in statik çözümlemesi için düz dize olmalıdır (sabit kullanılamaz).
import localFont from 'next/font/local';

const sansLatinExt = localFont({
  src: '../../../fonts/marketing/hanken-grotesk-var-latin-ext.woff2',
  weight: '100 900',
  style: 'normal',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
  variable: '--font-mk-sans-ext',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

const sansLatin = localFont({
  src: '../../../fonts/marketing/hanken-grotesk-var-latin.woff2',
  weight: '100 900',
  style: 'normal',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
  variable: '--font-mk-sans-latin',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
});

const serifLatinExt = localFont({
  src: '../../../fonts/marketing/instrument-serif-italic-latin-ext.woff2',
  weight: '400',
  style: 'italic',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
  variable: '--font-mk-serif-ext',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

const serifLatin = localFont({
  src: '../../../fonts/marketing/instrument-serif-italic-latin.woff2',
  weight: '400',
  style: 'italic',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
  variable: '--font-mk-serif-latin',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
});

/** Tanıtım sayfası köküne eklenen sınıflar (dört alt küme birlikte yüklenir). */
export const marketingFontVariables = [
  sansLatinExt.variable,
  sansLatin.variable,
  serifLatinExt.variable,
  serifLatin.variable,
].join(' ');
