// Tasarım belirteçleri (P05; 051 §3-§4). Ham değerler tokens.css'tedir (tokens.source.json'dan
// üretilir); burada yalnız TypeScript'in bilmesi gereken sabit adlar bulunur.

/**
 * Grafik seri renkleri (051 §4.10): sabit slot sırası; dokuzuncu seri üretilmez. Durum renkleri
 * (success, warning, danger, info …) seri rengi olarak kullanılamaz: seri rengi yalnız bu tiptir.
 */
export const CHART_SERIES_TOKENS = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-7',
  'chart-8',
] as const;

export type ChartSeriesToken = (typeof CHART_SERIES_TOKENS)[number];

/** Her serinin her seriyle yan yana geldiği grafiklerde (dağılım, balon, harita) yalnız ilk üç slot. */
export const CHART_ALL_PAIRS_SLOT_COUNT = 3;

/**
 * `<meta name="theme-color">` değerleri (051 §14): `bg` tokenının açık ve koyu değeri. Uygulama
 * kök layout'u ham hex yazmaz, bu sabiti kullanır; tokens-canon testi kaynakla eşitliği denetler.
 */
export const THEME_COLOR_META = { light: '#F7F7F8', dark: '#0B0B0D' } as const;
