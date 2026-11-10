// Akışlı çok parçalı gövde ayrıştırma (033 §6.1-§6.2). `c.req.parseBody()`/`formData()` YASAKTIR
// (gövdeyi belleğe alır). Alan sırası bağlayıcı: metin alanları ÖNCE, `file` parçası EN SON; dosya
// parçasından sonra gelen alan ve ikinci dosya reddedilir. Dosya parçası işleyici çalışırken
// akışla tüketilir (geri basınç busboy ayrıştırıcısını durdurur).
import type { Readable } from 'node:stream';
import { AppError } from '@eda/contracts/errors';
import busboy from 'busboy';

export interface MultipartLimits {
  /** Metin alanı sayısı üst sınırı. */
  readonly maxFields: number;
  /** Tek metin alanı bayt üst sınırı. */
  readonly maxFieldBytes: number;
}

export interface IncomingFile {
  readonly stream: Readable;
  /** İstemcinin bildirdiği ad (UTF-8 çözülmüş, normalize EDİLMEMİŞ). */
  readonly filename: string;
  /** Dosya parçasından ÖNCE gelen metin alanları. */
  readonly fields: Readonly<Record<string, string>>;
}

const malformed = (): AppError<'VALIDATION_MALFORMED_BODY'> =>
  new AppError('VALIDATION_MALFORMED_BODY');

const fieldError = (path: string, issue: 'required' | 'not_allowed' | 'too_long') =>
  new AppError('VALIDATION_FAILED', { fields: [{ path, issue }] });

export async function receiveSingleFile<T>(args: {
  readonly body: Readable;
  readonly contentType: string;
  readonly limits: MultipartLimits;
  readonly onFile: (file: IncomingFile) => Promise<T>;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!/^multipart\/form-data\s*;/i.test(args.contentType)) {
      reject(new AppError('VALIDATION_UNSUPPORTED_MEDIA_TYPE'));
      return;
    }
    let bb: ReturnType<typeof busboy>;
    try {
      bb = busboy({
        headers: { 'content-type': args.contentType },
        defParamCharset: 'utf8',
        preservePath: false,
        limits: {
          files: 1,
          fields: args.limits.maxFields,
          fieldSize: args.limits.maxFieldBytes,
          fieldNameSize: 64,
          parts: args.limits.maxFields + 2,
          headerPairs: 16,
          // Gövde sınırı sayaç tarafında (413) uygulanır; busboy sessizce kesmesin.
          fileSize: Number.MAX_SAFE_INTEGER,
        },
      });
    } catch {
      reject(malformed());
      return;
    }

    const fields: Record<string, string> = {};
    let filePromise: Promise<T> | null = null;
    let fileStream: Readable | null = null;
    let settled = false;

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      fileStream?.destroy(error instanceof Error ? error : undefined);
      args.body.unpipe(bb);
      args.body.destroy();
      reject(error);
    };

    bb.on('field', (name, value, info) => {
      if (filePromise !== null) return fail(fieldError(`body.${name}`, 'not_allowed'));
      if (info.valueTruncated || info.nameTruncated)
        return fail(fieldError(`body.${name}`, 'too_long'));
      fields[name] = value;
    });

    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || filePromise !== null) {
        stream.resume();
        return fail(fieldError(`body.${name}`, 'not_allowed'));
      }
      fileStream = stream;
      stream.on('error', () => undefined);
      filePromise = args.onFile({ stream, filename: info.filename, fields: { ...fields } });
      // İşleyici hata verirse hemen reddet (gövdenin kalanı okunmadan).
      filePromise.catch((error: unknown) => fail(error));
    });

    for (const limit of ['partsLimit', 'filesLimit', 'fieldsLimit'] as const) {
      bb.on(limit, () => fail(fieldError('body', 'too_long')));
    }
    // Gövde yarıda kesildi veya biçim bozuk.
    bb.on('error', () => fail(malformed()));
    bb.on('close', () => {
      if (settled) return;
      if (filePromise === null) return fail(fieldError('body.file', 'required'));
      filePromise.then(
        (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        },
        (error: unknown) => fail(error),
      );
    });

    args.body.on('error', () => fail(malformed()));
    args.body.pipe(bb);
  });
}
