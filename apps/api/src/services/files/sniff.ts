// Tür doğrulaması (033 §6.3): karar İÇERİKTEN verilir; uzantı yalnız tutarlılık denetimidir ve istemci
// `Content-Type` başlığı hiç okunmaz. ZIP imzalı iki tür (docx, udf) akışta ayırt edilemez: uzantıya
// göre GEÇİCİ tür yazılır, kesin yapı doğrulaması `file.extract` içindedir (kapsam dışı: bu dilim).
// Hiç kabul edilmeyenler: zip, rar, 7z, docm, xlsm, md, çalıştırılabilir dosyalar (reason `unsupported`).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { AcceptedFileType } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';

/** İmza için ilk 4 KiB yeterlidir; txt denetimi için 8 KiB tamponlanır (033 §6.2-§6.3). */
export const SNIFF_BYTES = 8192;

/** Yanıt `Content-Type` değerleri sabit tablodandır, istemci verisinden değil (033 §10.3). */
export const MIME_BY_TYPE: Readonly<Record<AcceptedFileType, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  tiff: 'image/tiff',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  udf: 'application/octet-stream',
  txt: 'text/plain; charset=utf-8',
};

const EXTENSIONS: Readonly<Record<AcceptedFileType, readonly string[]>> = {
  pdf: ['pdf'],
  png: ['png'],
  jpeg: ['jpg', 'jpeg'],
  tiff: ['tif', 'tiff'],
  docx: ['docx'],
  udf: ['udf'],
  txt: ['txt'],
};

const TYPES = Object.keys(EXTENSIONS) as AcceptedFileType[];

function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/** Son noktadan sonrası, yalnız ASCII küçük harf; yoksa boş. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  const ext = name.slice(dot + 1);
  return /^[A-Za-z0-9]{1,8}$/.test(ext) ? asciiLower(ext) : '';
}

const startsWith = (b: Buffer, sig: readonly number[], offset = 0): boolean =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

type Signature = 'pdf' | 'png' | 'jpeg' | 'tiff' | 'zip' | 'bigtiff' | null;

function signatureOf(head: Buffer): Signature {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'tiff';
  }
  if (startsWith(head, [0x49, 0x49, 0x2b, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2b])) {
    return 'bigtiff';
  }
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  return null;
}

/** NUL ve `\t\n\r\f` dışı denetim karakteri yok; geçerli UTF-8 (BOM'lu/BOM'suz) veya BOM'lu UTF-16. */
function looksLikeText(head: Buffer): boolean {
  if (head.length === 0) return false;
  if (startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff])) return true;
  const body = startsWith(head, [0xef, 0xbb, 0xbf]) ? head.subarray(3) : head;
  let decoded: string;
  try {
    // Tampon sınırı bir çok baytlı karakteri bölebilir: stream=true eksik kuyruğu hata saymaz.
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(body, { stream: true });
  } catch {
    return false;
  }
  for (let i = 0; i < decoded.length; i += 1) {
    const c = decoded.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c) return false;
    if (c === 0x7f) return false;
  }
  return true;
}

export interface SniffResult {
  readonly fileType: AcceptedFileType;
  readonly mimeType: string;
}

const unsupported = (): AppError<'FILE_TYPE_NOT_ALLOWED'> =>
  new AppError('FILE_TYPE_NOT_ALLOWED', {
    reason: 'unsupported',
    meta: { allowedTypes: [...CONFIG_DEFAULTS['upload.allowedTypes']] },
  });
const mismatch = (): AppError<'FILE_TYPE_NOT_ALLOWED'> =>
  new AppError('FILE_TYPE_NOT_ALLOWED', {
    reason: 'type_mismatch',
    meta: { allowedTypes: [...CONFIG_DEFAULTS['upload.allowedTypes']] },
  });

function typeOfExtension(ext: string): AcceptedFileType | null {
  return TYPES.find((t) => EXTENSIONS[t].includes(ext)) ?? null;
}

/** `head`: dosyanın ilk baytları (en çok `SNIFF_BYTES`); `fileName`: normalize edilmiş ad. */
export function sniffFile(head: Buffer, fileName: string): SniffResult {
  const ext = extensionOf(fileName);
  const allowed = new Set<string>(CONFIG_DEFAULTS['upload.allowedTypes']);
  const done = (t: AcceptedFileType): SniffResult => {
    if (!allowed.has(t)) throw unsupported();
    return { fileType: t, mimeType: MIME_BY_TYPE[t] };
  };
  const sig = signatureOf(head);
  const extType = typeOfExtension(ext);

  if (sig === 'bigtiff') throw unsupported();
  if (sig === 'zip') {
    if (ext === 'docx') return done('docx');
    if (ext === 'udf') return done('udf');
    // Uzantısı kabul edilen başka bir türse içerik uyuşmuyor; zip/docm/xlsm/bilinmeyen = desteklenmez.
    throw extType !== null ? mismatch() : unsupported();
  }
  if (sig !== null) {
    if (extType === sig) return done(sig);
    throw extType !== null || ext === '' ? mismatch() : unsupported();
  }
  // İmzasız: yalnız txt kabul edilir.
  if (ext === 'txt') {
    if (looksLikeText(head)) return done('txt');
    throw mismatch();
  }
  throw extType !== null ? mismatch() : unsupported();
}
