// Metin temizliği (054 §2.9, §5.4): her giriş yolunda (yapıştırma, içe aktarma, model çıktısı, op,
// `PUT draft` doğrulaması) uygulanır. Saf; DOM ve `node:*` kullanmaz.
import type { SectionRole } from '@eda/contracts/enums';

/** Sekme karakterinin metinde saklandığı roller (`"<ETİKET>\t: <değer>"`, 054 §5.4). */
export const TAB_ROLES = ['partiesGrid', 'subjectLine'] as const satisfies readonly SectionRole[];

// Silinen karakterler: C0 (\t ve \n hariç) ve C1 denetimleri, DEL, yumuşak tire, sıfır genişlikli
// karakterler, çift yönlü denetimler, BOM; ek olarak etiket karakterleri ve U+FFFC (084 D5).
// NBSP (U+00A0) korunur.
const FORBIDDEN_SOURCE =
  '[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200D\\u2060\\u202A-\\u202E\\u2066-\\u2069\\uFEFF\\uFFFC\\u{E0000}-\\u{E007F}]';
const FORBIDDEN_ALL = new RegExp(FORBIDDEN_SOURCE, 'gu');
const FORBIDDEN_ONE = new RegExp(FORBIDDEN_SOURCE, 'u');

export type SanitizeOptions = {
  /** Metnin bulunduğu section rolü; `\t` yalnız `TAB_ROLES`'ta korunur, diğerlerinde boşluk olur. */
  role?: SectionRole | null;
  /** Tek satırlık düğüm: `\n` boşluğa çevrilir (satır sonu için `hardBreak` kullanılır). */
  singleLine?: boolean;
};

export function isTabAllowed(role: SectionRole | null | undefined): boolean {
  return role !== null && role !== undefined && (TAB_ROLES as readonly string[]).includes(role);
}

/** Temizlenmesi gereken (gizli/denetim) karakter içeriyor mu (`text.forbidden_char`). */
export function hasForbiddenChars(text: string): boolean {
  return FORBIDDEN_ONE.test(text);
}

/** NFC + gizli/denetim karakter temizliği; idempotenttir. */
export function sanitizeText(text: string, opts: SanitizeOptions = {}): string {
  let out = text.normalize('NFC').replace(/\r\n?/g, '\n').replace(FORBIDDEN_ALL, '');
  if (!isTabAllowed(opts.role)) out = out.replace(/\t/g, ' ');
  if (opts.singleLine === true) out = out.replace(/\n/g, ' ');
  // Silinen karakter birleşik işaret dizisini açmış olabilir: ikinci NFC.
  return out.normalize('NFC');
}
