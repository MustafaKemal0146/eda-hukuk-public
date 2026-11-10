// Araç sonucu sarmalayıcısı ve kaçış kuralı (021 §4.13; 002 §13.3). Aynı girdi her zaman aynı baytları üretir.
export type SourceTur = 'karar' | 'mevzuat' | 'evrak';

export function escapeSourceText(input: string): string {
  return (
    input
      .normalize('NFC')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: kaçış kuralı kontrol karakterlerini siler (021 §4.13 adım 2)
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\[(K\d+)\]/g, '［$1］')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '[görsel]')
  );
}

export function wrapSource(ref: string, tur: SourceTur, header: string, body: string): string {
  if (!/^K\d{1,4}$/.test(ref)) throw new Error('geçersiz kaynak etiketi');
  return `<kaynak_verisi id="${ref}" tur="${tur}" guvenilir="hayir">\n${escapeSourceText(header)}\n---\n${escapeSourceText(body)}\n</kaynak_verisi>`;
}

/** Token tahmini (020 §10.5): 3 karakter ≈ 1 token. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

/** Paragraf/cümle sınırında kısaltma (021 §4.12). */
export function truncateToTokens(text: string, maxTokens: number, tail: string): string {
  const maxChars = maxTokens * 3;
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const boundary = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '));
  return `${cut.slice(0, boundary > maxChars * 0.5 ? boundary + 1 : maxChars).trimEnd()}\n${tail}`;
}

/** Önizleme için kayda yazılan okunmuş metnin üst sınırı (SourceItem.excerpt ile aynı; #58). */
export const EXCERPT_MAX_CHARS = 12000;
