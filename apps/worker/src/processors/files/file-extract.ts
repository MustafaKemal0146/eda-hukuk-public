// `file.extract` işleyicisi (033 §7.1-§7.4, §7.9; P21 ilk dilimi). Adımlar:
//  1. Kısa kiracı işlemi: evrak okunur; temiz taranmamış (`scanned_at` NULL; fail-closed), silinmek
//     üzere işaretli veya `extracting` dışındaki evrakta iş durur. Büro DEK'i ve dosya anahtarı çözülür.
//  2. İşlem DIŞINDA: nesne çözülür (segment etiketi doğrulanmadan bayt kullanılmaz) ve doc-engine
//     `POST /v1/extract`'e gönderilir.
//  3. Kısa kiracı işlemi: sonuç yazılır. Metin: `file_texts` + inbox eki `ready` (033 §7.9 kısayolu;
//     uzun ek sohbet turunda parça seçimiyle bağlama girer), dava evrakı `chunking` (parçalama/gömme
//     sonraki dilim). Metin katmanı yok veya sayfa sınırı: `ocr_skipped` (OCR bu dilimde yok). Yapısal
//     ret: `failed` + neden. doc-engine/objstore kesintisi durumu DEĞİŞTİRMEZ, iş ertelenir.
// Günlükte yalnız kimlik ve sonuç kodu vardır (ad, içerik yok).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { CryptoError, decryptIterable, deriveVariantKey, unwrapFileKey, wipe } from '@eda/crypto';
import {
  failExtract,
  finishExtract,
  loadExtractTarget,
  markOcrSkipped,
  noteDocEngineUnavailable,
} from '@eda/db/files';
import type { Keyring } from '@eda/db/keyring';
import { type ObjectStore, ObjectStoreError } from '@eda/db/s3';
import type { EdaLogger } from '@eda/observability/logger';
import {
  type DocEngineClient,
  DocEngineRejectedError,
  DocEngineUnavailableError,
} from '../../files/doc-engine.ts';
import type { Metrics } from '../../metrics.ts';
import { deferDelayMs, type FileScanDb } from './file-scan.ts';

export interface FileExtractDeps {
  readonly db: FileScanDb;
  readonly store: Pick<ObjectStore, 'get' | 'head'>;
  readonly keyring: Pick<Keyring, 'dekByVersion'>;
  readonly docEngine: DocEngineClient;
  readonly logger: EdaLogger;
  readonly metrics: Metrics;
  readonly uuid: () => string;
  readonly now?: () => Date;
}

export interface FileExtractJobView {
  readonly orgId: string;
  readonly fileId: string;
  readonly userId: string;
  readonly deferrals: number;
  readonly enqueuedAt: Date;
}

export type FileExtractOutcome =
  | { readonly status: 'ready' | 'chunking' }
  | { readonly status: 'ocr_skipped'; readonly reason: 'no_text_layer' | 'page_limit' }
  | { readonly status: 'failed'; readonly reason: string }
  | {
      readonly status: 'skipped';
      readonly reason: 'gone' | 'deleted' | 'not_scanned' | 'terminal' | 'unsupported_type';
    }
  | {
      readonly status: 'deferred';
      readonly untilMs: number;
      readonly reason: 'doc_engine' | 'storage';
    }
  | { readonly status: 'gave_up'; readonly reason: 'dependency_unavailable' };

/** 020 §10.5 tahmini (3 karakter ≈ 1 token); `@eda/ai` `estimateTokens` ile aynı kural. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

const EXTRACTABLE = new Set(['pdf', 'docx', 'txt']);
const IMAGE = new Set(['png', 'jpeg', 'tiff']);

type Prep =
  | { readonly kind: 'done'; readonly outcome: FileExtractOutcome }
  | {
      readonly kind: 'extract';
      readonly objectKey: string;
      readonly keyVersion: number;
      readonly variantKey: Buffer;
      readonly fileType: 'pdf' | 'docx' | 'txt';
      readonly inbox: boolean;
    };

export async function processFileExtract(
  job: FileExtractJobView,
  deps: FileExtractDeps,
): Promise<FileExtractOutcome> {
  const now = deps.now ?? (() => new Date());
  const { orgId, fileId, userId } = job;
  const ctx = { orgId, userId };
  const log = (outcome: string, extra: Readonly<Record<string, string | number>> = {}): void => {
    deps.logger.info({ event: 'file.extract', outcome, fileId, ...extra });
    deps.metrics.inc('eda_file_extract_total', { outcome });
  };

  const prep = await deps.db.withTenant(ctx, async (tx): Promise<Prep> => {
    const t = await loadExtractTarget(tx, orgId, fileId);
    const skip = (reason: Extract<FileExtractOutcome, { status: 'skipped' }>['reason']): Prep => ({
      kind: 'done',
      outcome: { status: 'skipped', reason },
    });
    if (t === null) return skip('gone');
    if (t.deleteRequestedAt !== null) return skip('deleted');
    if (t.scannedAt === null) return skip('not_scanned');
    if (t.status !== 'extracting') return skip('terminal');
    if (IMAGE.has(t.fileType)) {
      // Görüntü yalnız OCR ile okunur; OCR bu dilimde yoktur.
      await markOcrSkipped(tx, orgId, fileId, { pageCount: null, reason: null });
      return { kind: 'done', outcome: { status: 'ocr_skipped', reason: 'no_text_layer' } };
    }
    // UDF okuyucusu P19b'dedir: evrak `extracting`te kalır (yeniden işlemeyle sonra alınır).
    if (!EXTRACTABLE.has(t.fileType)) return skip('unsupported_type');
    const dek = await deps.keyring.dekByVersion(tx, orgId, t.wrapDekVersion);
    try {
      const fileKey = unwrapFileKey(
        dek.dek,
        { orgId, fileId, keyVersion: t.keyVersion },
        t.wrappedFileKey,
      );
      try {
        return {
          kind: 'extract',
          objectKey: t.objectKey,
          keyVersion: t.keyVersion,
          variantKey: deriveVariantKey(fileKey, 'orig'),
          fileType: t.fileType as 'pdf' | 'docx' | 'txt',
          inbox: t.caseId === null,
        };
      } finally {
        wipe(fileKey);
      }
    } catch (err) {
      if (err instanceof CryptoError) {
        await failExtract(tx, orgId, fileId, 'integrity_failed');
        return { kind: 'done', outcome: { status: 'failed', reason: 'integrity_failed' } };
      }
      throw err;
    } finally {
      wipe(dek.dek);
    }
  });
  if (prep.kind === 'done') {
    const o = prep.outcome;
    log(o.status === 'skipped' ? `skipped_${o.reason}` : o.status);
    return o;
  }

  const defer = async (reason: 'doc_engine' | 'storage'): Promise<FileExtractOutcome> => {
    if (
      now().getTime() - job.enqueuedAt.getTime() >
      CONFIG_DEFAULTS['jobs.dependencyDeferMaxHours'] * 3_600_000
    ) {
      deps.logger.error({ event: 'file.extract.gave_up', fileId, reason });
      log('gave_up', { reason });
      return { status: 'gave_up', reason: 'dependency_unavailable' };
    }
    if (reason === 'doc_engine') {
      await deps.db
        .withTenant(ctx, (tx) => noteDocEngineUnavailable(tx, orgId, fileId))
        .catch(() => undefined);
    }
    log('deferred', { reason });
    return { status: 'deferred', untilMs: now().getTime() + deferDelayMs(job.deferrals), reason };
  };

  type Read =
    | { readonly kind: 'result'; readonly result: Awaited<ReturnType<DocEngineClient['extract']>> }
    | { readonly kind: 'fail'; readonly reason: string };
  let read: Read;
  try {
    const head = await deps.store.head(prep.objectKey);
    if (head === null) {
      read = { kind: 'fail', reason: 'object_missing' };
    } else {
      const chunks: Buffer[] = [];
      const plain = decryptIterable(
        await deps.store.get(prep.objectKey),
        { orgId, fileId, keyVersion: prep.keyVersion },
        prep.variantKey,
        { objectLength: head.size },
      );
      for await (const c of plain) chunks.push(Buffer.from(c));
      const body = Buffer.concat(chunks);
      try {
        const result = await deps.docEngine.extract({
          jobId: deps.uuid(),
          fileType: prep.fileType,
          maxPages: CONFIG_DEFAULTS['upload.maxPagesPerFile'],
          body,
        });
        read = { kind: 'result', result };
      } finally {
        body.fill(0);
        for (const c of chunks) c.fill(0);
      }
    }
  } catch (err) {
    if (err instanceof DocEngineUnavailableError) return defer('doc_engine');
    if (err instanceof DocEngineRejectedError) {
      read = { kind: 'fail', reason: 'doc_engine_error' };
    } else if (err instanceof ObjectStoreError) {
      if (err.kind === 'not_found') read = { kind: 'fail', reason: 'object_missing' };
      else return defer('storage');
    } else if (err instanceof CryptoError) {
      read = { kind: 'fail', reason: 'integrity_failed' };
      deps.metrics.inc('eda_file_integrity_failures_total');
    } else {
      throw err;
    }
  } finally {
    wipe(prep.variantKey);
  }

  return deps.db.withTenant(ctx, async (tx): Promise<FileExtractOutcome> => {
    if (read.kind === 'fail') {
      await failExtract(tx, orgId, fileId, read.reason);
      log('failed', { reason: read.reason });
      return { status: 'failed', reason: read.reason };
    }
    const r = read.result;
    if (r.verdict === 'reject') {
      if (r.rejectReason === 'page_limit') {
        await markOcrSkipped(tx, orgId, fileId, { pageCount: r.pageCount, reason: 'page_limit' });
        log('ocr_skipped', { reason: 'page_limit' });
        return { status: 'ocr_skipped', reason: 'page_limit' };
      }
      const reason = r.rejectReason ?? 'corrupt';
      await failExtract(tx, orgId, fileId, reason);
      log('failed', { reason });
      return { status: 'failed', reason };
    }
    if (!r.hasTextLayer || r.text.trim() === '') {
      await markOcrSkipped(tx, orgId, fileId, { pageCount: r.pageCount, reason: null });
      log('ocr_skipped', { reason: 'no_text_layer' });
      return { status: 'ocr_skipped', reason: 'no_text_layer' };
    }
    const nextStatus = prep.inbox ? 'ready' : 'chunking';
    await finishExtract(tx, orgId, fileId, {
      text: r.text,
      tokenCount: estimateTokens(r.text),
      pageCount: r.pageCount,
      pageOffsets: r.pageOffsets,
      hiddenContentReport: r.hiddenContent,
      hasHiddenContent: r.hiddenContent.found,
      extractorVersion: r.extractorVersion,
      nextStatus,
    });
    log(nextStatus, { pages: r.pageCount ?? 0 });
    return { status: nextStatus };
  });
}
