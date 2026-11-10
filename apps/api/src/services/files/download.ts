// İndirme (033 §8, §10): tek kullanımlık belirteç üretimi ve akışla çözerek içerik verme.
// Sıra bağlayıcıdır (033 §10.2): RLS satırı -> karantina/tarama kapısı -> belirteç (`GETDEL`) ->
// custody `download` olayı (BAYT AKMADAN ÖNCE, fail-closed: yazılamazsa 503, bayt yok) -> dosya anahtarı
// -> `GetObject` (Range için `cipherRangeFor`) -> segment doğrulanmadan bayt yayılmaz. İlk segment yanıt
// başlıkları gönderilmeden önce doğrulanır (bozuksa temiz bir hata yanıtı döner); akış ortasında AEAD
// hatası bağlantıyı keser (kısmi yanıt başarılı sayılmaz) ve `files.status_reason` DEĞİŞTİRİLMEZ.
// Tam okumada akarken hesaplanan SHA-256 DB'deki özetle karşılaştırılır; uyuşmazlık alarm (olay
// müdahale) üretir, evrak silinmez.
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  DOWNLOAD_NAME_MAX,
  type DownloadTokenResponseValue,
  type FileDownloadVariant,
} from '@eda/contracts/api/files';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { parseCustodyMetadata } from '@eda/contracts/custody';
import { AppError } from '@eda/contracts/errors';
import { can } from '@eda/contracts/permissions';
import {
  CryptoError,
  cipherRangeFor,
  decryptIterable,
  deriveVariantKey,
  HEADER_BYTES,
  layoutOf,
  unwrapFileKey,
  wipe,
} from '@eda/crypto';
import type { TenantTx } from '@eda/db';
import { ObjectStoreError } from '@eda/db/s3';
import * as repo from '../../repositories/files/files.ts';
import { contentDisposition } from './names.ts';
import { parseRange } from './range.ts';
import { type FileActor, type FilesDeps, objectKeyOf } from './shared.ts';
import { newDownloadToken, sameRecord, tokenHash } from './tokens.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANT_SUFFIX: Readonly<Record<FileDownloadVariant, string>> = {
  orig: '',
  searchable: '.searchable',
  clean: '.clean',
};

export interface ContentRequest {
  readonly fileId: string;
  readonly variant: FileDownloadVariant;
  readonly dt?: string | undefined;
  /** Ham `Range` başlığı. */
  readonly range?: string | undefined;
  readonly ipTrunc: string | null;
}

export type ContentResult =
  | {
      readonly kind: 'ok';
      readonly status: 200 | 206;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: AsyncIterable<Buffer>;
    }
  | { readonly kind: 'unsatisfiable'; readonly size: number };

const storageDown = () =>
  new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE', {
    reason: 'storage',
    meta: { retryAfterSec: 5 },
  });
const timeoutDown = () =>
  new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE', {
    reason: 'timeout',
    meta: { retryAfterSec: 5 },
  });
const invalidToken = () => new AppError('AUTH_FORBIDDEN', { reason: 'download_token_invalid' });

/** İlk parçayı okur (hata varsa yanıt başlamadan fırlar), kalanını aynen akıtır. */
async function primed(src: AsyncGenerator<Buffer>): Promise<AsyncGenerator<Buffer>> {
  const first = await src.next();
  return (async function* () {
    if (first.done === true) return;
    yield first.value;
    yield* src;
  })();
}

/** Çözülmüş akıştan `[skip, skip+length)` aralığını verir. */
async function* slice(
  src: AsyncIterable<Buffer>,
  skip: number,
  length: number,
): AsyncGenerator<Buffer> {
  let toSkip = skip;
  let left = length;
  for await (const chunk of src) {
    if (left <= 0) break;
    let part = chunk;
    if (toSkip > 0) {
      if (toSkip >= part.length) {
        toSkip -= part.length;
        continue;
      }
      part = part.subarray(toSkip);
      toSkip = 0;
    }
    if (part.length > left) part = part.subarray(0, left);
    left -= part.length;
    yield part;
  }
}

async function collect(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
  return Buffer.concat(parts);
}

export function createFileDownloads(deps: FilesDeps) {
  const ttlSec = CONFIG_DEFAULTS['files.downloadTokenTtlSec'];
  const tenant = <T>(a: FileActor, fn: (tx: TenantTx) => Promise<T>) =>
    deps.db.withTenant({ orgId: a.orgId, userId: a.userId }, fn);
  const guard = (a: FileActor) => {
    if (!can({ surface: 'app', memberRole: a.memberRole }, 'file:read').allow) {
      throw new AppError('ORG_ROLE_INSUFFICIENT');
    }
  };

  /** Karantina ve tarama kapısı, varyant varlığı (033 §10.2 madde 2). */
  function assertReadable(row: repo.FileKeyed | repo.FileRow, variant: FileDownloadVariant): void {
    if (row.status === 'quarantined') throw new AppError('FILE_QUARANTINED');
    if (row.scannedAt === null) throw new AppError('FILE_NOT_READY');
    if (variant === 'searchable' && !row.hasSearchable) throw new AppError('FILE_NOT_FOUND');
    if (variant === 'clean' && !row.hasClean) throw new AppError('FILE_NOT_FOUND');
  }

  return {
    /** `POST /files/{id}/download-token`: niyeti POST ile (Origin denetimli) doğrulayan belirteç. */
    async issueDownloadToken(
      a: FileActor,
      fileId: string,
      variant: FileDownloadVariant,
    ): Promise<DownloadTokenResponseValue> {
      guard(a);
      if (!UUID_RE.test(fileId) || a.sessionId === undefined) throw new AppError('FILE_NOT_FOUND');
      if (deps.tokens === undefined) throw timeoutDown();
      const sessionId = a.sessionId;
      await tenant(a, async (tx) => {
        const row = await repo.getFile(tx, a.orgId, fileId);
        if (row === null) throw new AppError('FILE_NOT_FOUND');
        assertReadable(row, variant);
      });
      const token = newDownloadToken();
      try {
        await deps.tokens.put(
          tokenHash(token),
          {
            userId: a.userId,
            orgId: a.orgId,
            targetType: 'file',
            targetId: fileId,
            variant,
            sessionId,
          },
          ttlSec,
        );
      } catch {
        throw timeoutDown();
      }
      const suffix = variant === 'orig' ? '' : `&variant=${variant}`;
      return { url: `/api/v1/files/${fileId}/content?dt=${token}${suffix}`, expiresInSec: ttlSec };
    },

    /** `GET /files/{id}/content`: custody önce, sonra akışla çözülmüş içerik. */
    async openContent(a: FileActor, req: ContentRequest): Promise<ContentResult> {
      guard(a);
      if (!UUID_RE.test(req.fileId)) throw new AppError('FILE_NOT_FOUND');
      const row = await tenant(a, async (tx) => {
        const r = await repo.getFileKeyed(tx, a.orgId, req.fileId);
        if (r === null) throw new AppError('FILE_NOT_FOUND');
        assertReadable(r, req.variant);
        return r;
      });

      // Belirteç (varsa): atomik tek kullanım; oturum çerezi zaten ara katmanda doğrulandı.
      if (req.dt !== undefined) {
        if (deps.tokens === undefined || a.sessionId === undefined) throw invalidToken();
        let record: Awaited<ReturnType<NonNullable<FilesDeps['tokens']>['take']>>;
        try {
          record = await deps.tokens.take(tokenHash(req.dt));
        } catch {
          throw timeoutDown();
        }
        const expected = {
          userId: a.userId,
          orgId: a.orgId,
          targetType: 'file',
          targetId: req.fileId,
          variant: req.variant,
          sessionId: a.sessionId,
        } as const;
        if (record === null || !sameRecord(record, expected)) throw invalidToken();
      }

      const key = `${objectKeyOf(a.orgId, row.caseId, row.id)}${VARIANT_SUFFIX[req.variant]}`;
      let objectLength: number;
      try {
        const head = await deps.store.head(key);
        if (head === null) {
          deps.onIntegrityFailure?.({ fileId: row.id, kind: 'object_missing' });
          throw new AppError('INTERNAL_ERROR');
        }
        objectLength = head.size;
      } catch (err) {
        if (err instanceof ObjectStoreError) throw storageDown();
        throw err;
      }
      let plainSize: number;
      try {
        plainSize = layoutOf(objectLength).plainBytes;
      } catch {
        deps.onIntegrityFailure?.({ fileId: row.id, kind: 'length' });
        throw new AppError('INTERNAL_ERROR');
      }
      if (req.variant === 'orig' && plainSize !== row.sizeBytes) {
        deps.onIntegrityFailure?.({ fileId: row.id, kind: 'length' });
        throw new AppError('INTERNAL_ERROR');
      }

      const spec = parseRange(req.range, plainSize);
      if (spec.kind === 'unsatisfiable') return { kind: 'unsatisfiable', size: plainSize };
      const rangeText = spec.kind === 'range' ? `bytes=${spec.start}-${spec.end}` : null;

      // Custody `download`: bayt akmadan ÖNCE ve aynı işlemde dosya anahtarı (fail-closed, D4).
      const keyCtx = { orgId: a.orgId, fileId: row.id, keyVersion: row.keyVersion };
      let variantKey: Buffer;
      try {
        variantKey = await tenant(a, async (tx) => {
          const dek = await deps.keyring.dekByVersion(tx, a.orgId, row.wrapDekVersion);
          let fileKey: Buffer | undefined;
          try {
            fileKey = unwrapFileKey(dek.dek, keyCtx, row.wrappedFileKey);
            const derived = deriveVariantKey(fileKey, req.variant);
            await repo.insertCustody(tx, a.orgId, {
              fileId: row.id,
              caseId: row.caseId,
              event: 'download',
              actorId: a.userId,
              sha256: null,
              ipTrunc: req.ipTrunc,
              metadata: parseCustodyMetadata('download', {
                variant: req.variant,
                range: rangeText,
                via_token: req.dt !== undefined,
              }),
            });
            return derived;
          } finally {
            wipe(dek.dek, fileKey);
          }
        });
      } catch (err) {
        if (err instanceof AppError) throw err;
        if (err instanceof CryptoError) {
          deps.onIntegrityFailure?.({ fileId: row.id, kind: 'aead' });
          throw new AppError('INTERNAL_ERROR');
        }
        // Delil zinciri yazılamıyorsa içerik verilmez.
        throw timeoutDown();
      }

      const full = spec.kind === 'none';
      const start = spec.kind === 'range' ? spec.start : 0;
      const end = spec.kind === 'range' ? spec.end : plainSize - 1;
      const length = end - start + 1;

      const plain = (async function* (): AsyncGenerator<Buffer> {
        try {
          if (full) {
            const hash = req.variant === 'orig' ? createHash('sha256') : null;
            const body = await deps.store.get(key);
            for await (const seg of decryptIterable(body, keyCtx, variantKey, { objectLength })) {
              hash?.update(seg);
              yield seg;
            }
            if (hash !== null && !hash.digest().equals(row.sha256)) {
              deps.onIntegrityFailure?.({ fileId: row.id, kind: 'sha256' });
            }
            return;
          }
          const r = cipherRangeFor(objectLength, start, end);
          const header = await collect(
            await deps.store.get(key, { start: 0, end: HEADER_BYTES - 1 }),
          );
          const body = await deps.store.get(key, { start: r.cipherStart, end: r.cipherEnd });
          yield* slice(
            decryptIterable(body, keyCtx, variantKey, {
              objectLength,
              firstSegment: r.firstSegment,
              lastSegment: r.lastSegment,
              header,
            }),
            r.skipInFirst,
            r.plainLength,
          );
        } finally {
          wipe(variantKey);
        }
      })();

      let body: AsyncGenerator<Buffer>;
      try {
        body = await primed(plain);
      } catch (err) {
        if (err instanceof ObjectStoreError) throw storageDown();
        if (err instanceof CryptoError) {
          deps.onIntegrityFailure?.({ fileId: row.id, kind: 'aead' });
          throw new AppError('INTERNAL_ERROR');
        }
        throw err;
      }
      // Akış ortası AEAD hatası: kaynak akış hata verir, HTTP katmanı bağlantıyı keser.
      const guarded = (async function* (): AsyncGenerator<Buffer> {
        try {
          yield* body;
        } catch (err) {
          if (err instanceof CryptoError)
            deps.onIntegrityFailure?.({ fileId: row.id, kind: 'aead' });
          throw err;
        }
      })();

      const mime = req.variant === 'searchable' ? 'application/pdf' : row.mimeType;
      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Content-Disposition': contentDisposition(row.originalName.slice(0, DOWNLOAD_NAME_MAX * 4)),
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(length),
        Vary: 'Cookie',
      };
      if (!full) headers['Content-Range'] = `bytes ${start}-${end}/${plainSize}`;
      return { kind: 'ok', status: full ? 200 : 206, headers, body: guarded };
    },
  };
}

export type FileDownloads = ReturnType<typeof createFileDownloads>;
