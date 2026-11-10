// Evrak servisi (033 §6, §8, §11): akışlı yükleme, okuma, dava evrak listesi, iki aşamalı silme.
// Hono bilmez. Evrak adı ve içerik log, span, hata ve denetim metadata'sına YAZILMAZ (D6, D9).
//
// Yükleme sırası (033 §6.4): nesne ÖNCE, kayıt SONRA. Ağ çağrısı (S3) `withTenant` işlemi DIŞINDADIR
// (031 §4.3): kısa bir ön işlemde dava erişimi + etkin DEK okunur; akış bitince tek kısa işlemde
// `files` satırı + custody `upload` olayı yazılır ve `file.scan` COMMIT sonrası kuyruğa alınır.
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  type FileDeleteResponseValue,
  type FileDtoValue,
  type FileListResponseValue,
  FileUploadFields,
  type ListCaseFilesQueryValue,
} from '@eda/contracts/api/files';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { parseCustodyMetadata } from '@eda/contracts/custody';
import { AppError, fieldIssueOf } from '@eda/contracts/errors';
import { can } from '@eda/contracts/permissions';
import { deriveVariantKey, encryptIterable, generateFileKey, wipe, wrapFileKey } from '@eda/crypto';
import type { TenantTx } from '@eda/db';
import { ObjectStoreError } from '@eda/db/s3';
import { tr_fold } from '@eda/legal/text';
import * as repo from '../../repositories/files/files.ts';
import { createFileDownloads } from './download.ts';
import { fileDto } from './dto.ts';
import { receiveSingleFile } from './multipart.ts';
import { normalizeFileName } from './names.ts';
import {
  type FileActor,
  type FilesDeps,
  type FilesLimits,
  objectKeyOf,
  sealedLength,
} from './shared.ts';
import { createUploadSlots, type UploadSlots } from './slots.ts';
import { SNIFF_BYTES, sniffFile } from './sniff.ts';

export function defaultFilesLimits(): FilesLimits {
  return {
    maxBytes: CONFIG_DEFAULTS['upload.maxMb'] * 1024 * 1024,
    maxFilesPerCase: CONFIG_DEFAULTS['upload.maxFilesPerCase'],
    maxConcurrentPerUser: CONFIG_DEFAULTS['upload.maxConcurrentPerUser'],
    maxConcurrentApi: CONFIG_DEFAULTS['upload.maxConcurrentApi'],
    deleteGraceDays: CONFIG_DEFAULTS['files.deleteGraceDays'],
    inboxDays: CONFIG_DEFAULTS['retention.inboxDays'],
  };
}

export interface UploadRequest {
  readonly body: Readable;
  readonly contentType: string;
  readonly contentLength: number | null;
  /** Kısaltılmış istemci IP'si (custody `ip_trunc`). */
  readonly ipTrunc: string | null;
  readonly requestId?: string | undefined;
}

/** Çok parçalı zarf payı (033 §6.1 #5): dosya baytları + 1 MiB. */
const ENVELOPE_BYTES = 1024 * 1024;
const MAX_TEXT_FIELDS = 6;
const MAX_FIELD_BYTES = 256;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 25;
const DAY_MS = 86_400_000;

const fileNotFound = () => new AppError('FILE_NOT_FOUND');
const storageDown = () =>
  new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE', {
    reason: 'storage',
    meta: { retryAfterSec: 5 },
  });

function encodeCursor(r: { createdAt: Date; id: string }): string {
  return Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString('base64url');
}
function decodeCursor(c: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (!iso || !id || Number.isNaN(at.getTime()) || !UUID_RE.test(id)) {
    throw new AppError('VALIDATION_CURSOR_INVALID');
  }
  return { createdAt: at, id };
}

export function createFilesService(deps: FilesDeps) {
  const limits: FilesLimits = { ...defaultFilesLimits(), ...deps.limits };
  const now = deps.now ?? (() => new Date());
  const slots: UploadSlots = createUploadSlots({
    perUser: limits.maxConcurrentPerUser,
    api: limits.maxConcurrentApi,
  });
  const tenant = <T>(a: FileActor, fn: (tx: TenantTx) => Promise<T>) =>
    deps.db.withTenant({ orgId: a.orgId, userId: a.userId }, fn);
  const guard = (a: FileActor, perm: 'file:read' | 'file:upload') => {
    if (!can({ surface: 'app', memberRole: a.memberRole }, perm).allow) {
      throw new AppError('ORG_ROLE_INSUFFICIENT');
    }
  };
  const tooLarge = () => new AppError('FILE_TOO_LARGE', { meta: { maxBytes: limits.maxBytes } });

  /** Gövdeyi okur: sayaç, tür denetimi, SHA-256 (şifrelemeden ÖNCE) ve bir segment ileri bakış. */
  function plainSource(
    file: Readable,
    fileName: string,
    state: { total: number; sniffed: ReturnType<typeof sniffFile> | null; sha256: Buffer | null },
  ): AsyncGenerator<Buffer, void, undefined> {
    const hash = createHash('sha256');
    return (async function* () {
      const held: Buffer[] = [];
      let heldBytes = 0;
      for await (const raw of file) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
        state.total += chunk.length;
        if (state.total > limits.maxBytes) throw tooLarge();
        hash.update(chunk);
        if (state.sniffed === null) {
          held.push(chunk);
          heldBytes += chunk.length;
          if (heldBytes < SNIFF_BYTES) continue;
          state.sniffed = sniffFile(Buffer.concat(held), fileName);
          yield Buffer.concat(held);
          held.length = 0;
          continue;
        }
        yield chunk;
      }
      if (state.total === 0) {
        throw new AppError('VALIDATION_FAILED', { reason: 'empty_file' });
      }
      if (state.sniffed === null) {
        const head = Buffer.concat(held);
        state.sniffed = sniffFile(head, fileName);
        yield head;
      }
      state.sha256 = hash.digest();
    })();
  }

  async function ingest(
    a: FileActor,
    req: UploadRequest,
    incoming: { stream: Readable; filename: string; fields: Readonly<Record<string, string>> },
  ): Promise<FileDtoValue> {
    const parsed = FileUploadFields.safeParse(incoming.fields);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', {
        fields: parsed.error.issues.slice(0, 20).map((i) => ({
          path: ['body', ...i.path.map(String)].join('.'),
          issue: fieldIssueOf(i),
        })),
      });
    }
    const caseId = parsed.data.caseId ?? null;
    if (caseId !== null && parsed.data.origin !== undefined) {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ path: 'body.origin', issue: 'not_allowed' }],
      });
    }
    const origin = caseId !== null ? 'case_upload' : (parsed.data.origin ?? 'chat_attachment');
    const name = normalizeFileName(incoming.filename);
    const fileId = deps.uuid();
    const key = objectKeyOf(a.orgId, caseId, fileId);

    // 1) Kısa ön işlem: dava erişimi + sayı sınırı + etkin büro DEK'i (ağ çağrısı yok).
    const dek = await tenant(a, async (tx) => {
      if (caseId !== null) {
        const gate = await repo.getCaseGate(tx, a.orgId, caseId);
        if (gate === null || gate.status === 'archived') throw new AppError('CASE_NOT_FOUND');
        if ((await repo.countCaseFiles(tx, a.orgId, caseId)) >= limits.maxFilesPerCase) {
          throw new AppError('VALIDATION_FAILED', { reason: 'case_file_limit' });
        }
      }
      return deps.keyring.activeDek(tx, a.orgId);
    });

    const fileKey = generateFileKey();
    const variantKey = deriveVariantKey(fileKey, 'orig');
    const keyCtx = { orgId: a.orgId, fileId, keyVersion: dek.keyVersion };
    const wrapped = wrapFileKey(dek.dek, keyCtx, fileKey);
    const state: Parameters<typeof plainSource>[2] = { total: 0, sniffed: null, sha256: null };
    let stored = false;
    try {
      // 2) Akış: sayaç -> tür -> SHA-256 -> segmentli AEAD -> nesne deposu.
      const sealed = encryptIterable(plainSource(incoming.stream, name, state), keyCtx, variantKey);
      let put: { size: number };
      try {
        put = await deps.store.put(key, sealed);
      } catch (err) {
        if (err instanceof ObjectStoreError) throw storageDown();
        throw err;
      }
      stored = true;
      const sniffed = state.sniffed;
      const sha = state.sha256;
      if (sniffed === null || sha === null) throw new Error('yükleme tamamlanmadı');
      const expected = sealedLength(state.total);
      const head = await deps.store.head(key).catch((err: unknown) => {
        throw err instanceof ObjectStoreError ? storageDown() : err;
      });
      if (put.size !== expected || head === null || head.size !== expected) {
        throw new Error('nesne boyutu beklenenden farklı');
      }

      // 3) Tek kısa işlem: files satırı + custody upload (+ COMMIT sonrası iş kuyruğu).
      const created = now();
      const row = await tenant(a, async (tx) => {
        const inserted = await repo.insertFile(tx, a.orgId, {
          id: fileId,
          caseId,
          origin,
          originId: parsed.data.originId ?? null,
          uploadedBy: a.userId,
          originalName: name,
          nameFold: tr_fold(name),
          fileType: sniffed.fileType,
          mimeType: sniffed.mimeType,
          sizeBytes: state.total,
          sha256: sha,
          objectKey: key,
          keyVersion: dek.keyVersion,
          wrapDekVersion: dek.keyVersion,
          wrappedFileKey: wrapped,
          inboxExpiresAt:
            caseId === null ? new Date(created.getTime() + limits.inboxDays * DAY_MS) : null,
        });
        if (inserted === null) {
          const existing =
            caseId === null ? null : await repo.findDuplicateId(tx, a.orgId, caseId, sha);
          throw new AppError('FILE_DUPLICATE', {
            reason: 'same_hash_in_case',
            actions: ['view_existing_file'],
            ...(existing === null ? {} : { meta: { existingFileId: existing } }),
          });
        }
        await repo.insertCustody(tx, a.orgId, {
          fileId,
          caseId,
          event: 'upload',
          actorId: a.userId,
          sha256: sha,
          ipTrunc: req.ipTrunc,
          metadata: parseCustodyMetadata('upload', {
            size_bytes: state.total,
            file_type: sniffed.fileType,
            origin,
            case_id: caseId,
          }),
        });
        tx.afterCommit(() =>
          deps.jobs.addFileScan({
            orgId: a.orgId,
            fileId,
            userId: a.userId,
            batch: parsed.data.batch === true,
            epochSec: Math.floor(inserted.updatedAt.getTime() / 1000),
            requestId: req.requestId,
          }),
        );
        return inserted;
      });
      return fileDto(row, a.userId);
    } catch (err) {
      // Kayıt yazılamadı: nesne silinmeye çalışılır; silinemezse `orphans.sweep` toplar (033 §6.4).
      if (stored) await deps.store.delete(key).catch(() => undefined);
      throw err;
    } finally {
      wipe(fileKey, variantKey, dek.dek);
    }
  }

  return {
    ...createFileDownloads(deps),
    async upload(a: FileActor, req: UploadRequest): Promise<FileDtoValue> {
      guard(a, 'file:upload');
      if (deps.edaEnv === 'beta-synthetic') throw new AppError('FILE_UPLOAD_DISABLED');
      if (req.contentLength !== null && req.contentLength > limits.maxBytes + ENVELOPE_BYTES) {
        throw tooLarge();
      }
      const release = slots.acquire(a.userId);
      try {
        return await receiveSingleFile({
          body: req.body,
          contentType: req.contentType,
          limits: { maxFields: MAX_TEXT_FIELDS, maxFieldBytes: MAX_FIELD_BYTES },
          onFile: (file) => ingest(a, req, file),
        });
      } finally {
        release();
      }
    },

    async get(a: FileActor, id: string): Promise<FileDtoValue> {
      guard(a, 'file:read');
      if (!UUID_RE.test(id)) throw fileNotFound();
      return tenant(a, async (tx) => {
        const row = await repo.getFile(tx, a.orgId, id);
        if (row === null) throw fileNotFound();
        return fileDto(row, a.userId);
      });
    },

    async listForCase(
      a: FileActor,
      caseId: string,
      q: ListCaseFilesQueryValue,
    ): Promise<FileListResponseValue> {
      guard(a, 'file:read');
      if (!UUID_RE.test(caseId)) throw new AppError('CASE_NOT_FOUND');
      const limit = q.limit ?? PAGE;
      const before = q.cursor === undefined ? null : decodeCursor(q.cursor);
      return tenant(a, async (tx) => {
        if ((await repo.getCaseGate(tx, a.orgId, caseId)) === null) {
          throw new AppError('CASE_NOT_FOUND');
        }
        const rows = await repo.listCaseFiles(tx, a.orgId, caseId, {
          status: q.status ?? null,
          before,
          limit,
        });
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return {
          items: page.map((r) => fileDto(r, a.userId)),
          nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
        };
      });
    },

    /**
     * İki aşamalı silme (033 §11): önce `delete_requested_at` (evrak anında listeden çıkar), fiilî imha
     * grace sonrası `retention.purge`. Karantinadaki evrak grace'siz, DB önce silinir.
     */
    async remove(a: FileActor, id: string): Promise<FileDeleteResponseValue> {
      if (!UUID_RE.test(id)) throw fileNotFound();
      const at = now();
      const result = await tenant(a, async (tx) => {
        const row = await repo.getFile(tx, a.orgId, id);
        if (row === null) throw fileNotFound();
        // Yükleyen kendi evrakını her rolde silebilir; başkasınınkini yalnız `file:delete` (avukatlar+).
        const own = row.uploadedBy === a.userId;
        if (!own && !can({ surface: 'app', memberRole: a.memberRole }, 'file:delete').allow) {
          throw new AppError('ORG_ROLE_INSUFFICIENT');
        }
        if (row.status === 'quarantined') {
          await repo.insertCustody(tx, a.orgId, {
            fileId: id,
            caseId: row.caseId,
            event: 'delete',
            actorId: a.userId,
            sha256: row.sha256,
            ipTrunc: null,
            metadata: parseCustodyMetadata('delete', {
              reason: 'quarantine',
              size_bytes: row.sizeBytes,
              file_type: row.fileType,
            }),
          });
          await repo.purgeFileRows(tx, a.orgId, id);
          const keys = [objectKeyOf(a.orgId, row.caseId, id)];
          if (row.hasSearchable) keys.push(`${keys[0]}.searchable`);
          if (row.hasClean) keys.push(`${keys[0]}.clean`);
          // Nesne silme COMMIT sonrası; başarısızsa `orphans.sweep` toplar (anahtar zaten yok).
          tx.afterCommit(async () => {
            for (const k of keys) await deps.store.delete(k).catch(() => undefined);
          });
          return { at, grace: at };
        }
        if (row.caseId !== null) {
          const gate = await repo.getCaseGate(tx, a.orgId, row.caseId);
          if (gate?.legalHold === true) {
            throw new AppError('FILE_DELETE_BLOCKED', { reason: 'legal_hold' });
          }
          if (gate?.status === 'archived') {
            throw new AppError('FILE_DELETE_BLOCKED', { reason: 'case_archived' });
          }
        }
        if (await repo.orgLegalHold(tx, a.orgId)) {
          throw new AppError('FILE_DELETE_BLOCKED', { reason: 'legal_hold' });
        }
        const marked = await repo.markDeleteRequested(tx, a.orgId, id, a.userId);
        if (marked === null) throw fileNotFound();
        const grace = new Date(
          marked.deleteRequestedAt.getTime() + limits.deleteGraceDays * DAY_MS,
        );
        await repo.insertCustody(tx, a.orgId, {
          fileId: id,
          caseId: row.caseId,
          event: 'delete_request',
          actorId: a.userId,
          sha256: null,
          ipTrunc: null,
          metadata: parseCustodyMetadata('delete_request', {
            reason: 'user',
            grace_until: grace.toISOString(),
          }),
        });
        return { at: marked.deleteRequestedAt, grace };
      });
      return {
        id,
        deleteRequestedAt: result.at.toISOString(),
        graceUntil: result.grace.toISOString(),
      };
    },
  };
}

export type FilesService = ReturnType<typeof createFilesService>;

export type { FileActor, FilesDb, FilesDeps, FilesLimits } from './shared.ts';
export { objectKeyOf, sealedLength } from './shared.ts';
