// Evrak adı (033 §2.1, §10.3): yükleme anında normalize edilir; ad yalnız `files.original_name`
// kolonundadır (nesne anahtarında, loglarda, metriklerde, hata mesajında YOK).
import { DOWNLOAD_NAME_MAX, FILE_NAME_MAX } from '@eda/contracts/api/files';

const FALLBACK_NAME = 'evrak';
// Denetim karakterleri (C0/C1), Unicode satır/paragraf ayırıcıları, çift yönlü biçim karakterleri ve
// sıfır genişlikli karakterler adı yanıltabilir veya başlıkları bölebilir; yol ayırıcıları atılır.
function isStripped(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff ||
    cp === 0x2f ||
    cp === 0x5c
  );
}

/** Unicode NFC, denetim karakterleri ve yol ayırıcıları atılır, kırpılır, en çok 200 karakter. */
export function normalizeFileName(raw: string): string {
  const cleaned = [...raw.normalize('NFC')]
    .filter((ch) => !isStripped(ch.codePointAt(0) ?? 0))
    .join('')
    .trim();
  // Noktayla başlayan/biten ya da yalnız noktalardan oluşan adlar gizli dosya/yol atlamasına benzer.
  const noDots = cleaned.replace(/^\.+/, '').trim();
  const chars = [...(noDots === '' ? FALLBACK_NAME : noDots)];
  return chars.slice(0, FILE_NAME_MAX).join('').trim() || FALLBACK_NAME;
}

const ASCII_MAP: Readonly<Record<string, string>> = {
  ç: 'c',
  Ç: 'C',
  ğ: 'g',
  Ğ: 'G',
  ı: 'i',
  İ: 'I',
  ö: 'o',
  Ö: 'O',
  ş: 's',
  Ş: 'S',
  ü: 'u',
  Ü: 'U',
};

/** ASCII yedek: Türkçe harfler dönüştürülür, kalan ASCII dışı ve tırnak/ayırıcılar `_` olur. */
export function asciiFallbackName(name: string): string {
  const mapped = [...name].map((ch) => ASCII_MAP[ch] ?? ch).join('');
  return mapped.replace(/[^A-Za-z0-9._ -]/g, '_');
}

function percentEncode(s: string): string {
  // RFC 5987 attr-char dışı her şey yüzde kodlanır (encodeURIComponent'in bıraktığı ' ( ) * dahil).
  return encodeURIComponent(s).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `Content-Disposition: attachment` değeri; ad ≤ 150 karakter (033 §10.3). */
export function contentDisposition(originalName: string): string {
  const name = [...normalizeFileName(originalName)].slice(0, DOWNLOAD_NAME_MAX).join('');
  return `attachment; filename="${asciiFallbackName(name)}"; filename*=UTF-8''${percentEncode(name)}`;
}
