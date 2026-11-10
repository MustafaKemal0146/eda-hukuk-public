// next-intl çevirmeninin bu modülün kullandığı dar yüzü. Sunucu (`getTranslations`) ve test
// (`createTranslator`) aynı biçimi verir; sayfa bileşenleri bu yüzden senkron ve test edilebilir.
export type Translator = {
  (key: string, values?: Record<string, string | number>): string;
  raw: (key: string) => unknown;
};
