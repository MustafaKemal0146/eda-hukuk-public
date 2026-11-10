// `file.scan` işleyicisi (033 §7.1-§7.2, §7.6; 043 §11.1). Adımlar:
//  1. Kısa kiracı işlemi (yükleyen kullanıcı bağlamı, RLS açık): evrak okunur; silinmek üzere işaretli,
//     karantinada veya zaten taranmış evrakta iş durur (idempotent); `uploaded -> scanning`; büro DEK'i
//     ve dosya anahtarı çözülür. `CLAMAV_ENABLED=false` (yalnız dev/test) `scanned_at` yazar, sayaç artar.
//  2. İşlem DIŞINDA: nesne çözülerek (segment etiketi doğrulanmadan bayt yayılmaz) clamd'ye akıtılır.
//  3. Kısa kiracı işlemi: sonuç yazılır. Temiz: `scanned_at = now()`, `extracting`. Zararlı:
//     `quarantined` + `av_detected` (`scanned_at` NULL kalır; imza adı yalnız günlüğe). Dosyaya ait kalıcı
//     hata (nesne yok, bütünlük): `failed`. ALTYAPI kesintisi (clamd, objstore, eski imza) durumu
//     DEĞİŞTİRMEZ: iş gecikmeli yeniden denenir ve deneme tüketmez (fail-closed: `scanned_at` NULL kaldığı
//     sürece evrak işlenmez ve indirilemez).
// Günlükte ve metrikte dosya adı, içerik ve imza adı dışında yalnız kimlik ve sonuç kodu vardır.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import { CryptoError, decryptIterable, deriveVariantKey, unwrapFileKey, wipe } from '@eda/crypto';
import type { TenantTx } from '@eda/db';
import {
  failScan,
  finishScanClean,
  finishScanInfected,
  loadScanTarget,
  markScanning,
  noteScanUnavailable,
} from '@eda/db/files';
import type { Keyring } from '@eda/db/keyring';
import { type ObjectStore, ObjectStoreError } from '@eda/db/s3';
import type { EdaLogger } from '@eda/observability/logger';
import { ScannerUnavailableError, type VirusScanner } from '../../files/scanner.ts';
import type { Metrics } from '../../metrics.ts';

export interface FileScanDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
}

export interface FileScanDeps {
  readonly db: FileScanDb;
  readonly store: Pick<ObjectStore, 'get' | 'head'>;
  readonly keyring: Pick<Keyring, 'dekByVersion'>;
  /** `null`: `CLAMAV_ENABLED=false` (yalnız development/test). */
  readonly scanner: VirusScanner | null;
  readonly logger: EdaLogger;
  readonly metrics: Metrics;
  readonly now?: () => Date;
}

export interface FileScanJobView {
  readonly orgId: string;
  readonly fileId: string;
  readonly userId: string;
  /** Bu iş kaç kez ertelendi (gecikme üstel artar). */
  readonly deferrals: number;
  /** İşin ilk kuyruğa girdiği an (bağımlılık bekleme üst sınırı). */
  readonly enqueuedAt: Date;
}

export type FileScanOutcome =
  | { readonly status: 'clean' }
  | { readonly status: 'clean_unscanned' }
  | { readonly status: 'infected' }
  | { readonly status: 'failed'; readonly reason: 'object_missing' | 'integrity_failed' }
  | {
      readonly status: 'skipped';
      readonly reason: 'gone' | 'deleted' | 'quarantined' | 'already_scanned' | 'terminal';
    }
  | {
      readonly status: 'deferred';
      readonly untilMs: number;
      readonly reason: 'connect' | 'timeout' | 'protocol' | 'database_stale' | 'storage';
    }
  /** Bekleme üst sınırı aşıldı: durum değişmez, alarm üretilir (süper admin). */
  | { readonly status: 'gave_up'; readonly reason: 'dependency_unavailable' };

/** Erteleme: 30 sn × 2^n, `jobs.deferMaxDelaySec` ile sınırlı (043 §6.2). */
export function deferDelayMs(deferrals: number): number {
  const base = CONFIG_DEFAULTS['jobs.backoffBaseMs'] * 2 ** Math.min(deferrals, 10);
  return Math.min(base, CONFIG_DEFAULTS['jobs.deferMaxDelaySec'] * 1000);
}

type Prep =
  | { readonly kind: 'done'; readonly outcome: FileScanOutcome }
  | {
      readonly kind: 'scan';
      readonly objectKey: string;
      readonly keyVersion: number;
      readonly variantKey: Buffer;
    };

export async function processFileScan(
  job: FileScanJobView,
  deps: FileScanDeps,
): Promise<FileScanOutcome> {
  const now = deps.now ?? (() => new Date());
  const { orgId, fileId, userId } = job;
  const ctx = { orgId, userId };

  const log = (outcome: string, extra: Readonly<Record<string, string | number>> = {}): void => {
    deps.logger.info({ event: 'file.scan', outcome, fileId, ...extra });
    deps.metrics.inc('eda_file_scan_total', { outcome });
  };

  // 1) Ön işlem.
  const prep = await deps.db.withTenant(ctx, async (tx): Promise<Prep> => {
    const t = await loadScanTarget(tx, orgId, fileId);
    const skip = (reason: Extract<FileScanOutcome, { status: 'skipped' }>['reason']): Prep => ({
      kind: 'done',
      outcome: { status: 'skipped', reason },
    });
    if (t === null) return skip('gone');
    if (t.deleteRequestedAt !== null) return skip('deleted');
    if (t.status === 'quarantined') return skip('quarantined');
    if (t.scannedAt !== null) return skip('already_scanned');
    if (t.status !== 'uploaded' && t.status !== 'scanning') return skip('terminal');
    await markScanning(tx, orgId, fileId);
    if (deps.scanner === null) {
      // Yalnız development/test (prod'da CLAMAV_ENABLED=false başlatma hatasıdır; env şeması).
      await finishScanClean(tx, orgId, fileId);
      deps.metrics.inc('eda_file_scan_skipped_total');
      return { kind: 'done', outcome: { status: 'clean_unscanned' } };
    }
    const dek = await deps.keyring.dekByVersion(tx, orgId, t.wrapDekVersion);
    try {
      const fileKey = unwrapFileKey(
        dek.dek,
        { orgId, fileId, keyVersion: t.keyVersion },
        t.wrappedFileKey,
      );
      try {
        return {
          kind: 'scan',
          objectKey: t.objectKey,
          keyVersion: t.keyVersion,
          variantKey: deriveVariantKey(fileKey, 'orig'),
        };
      } finally {
        wipe(fileKey);
      }
    } catch (err) {
      if (err instanceof CryptoError) {
        await failScan(tx, orgId, fileId, 'integrity_failed');
        return { kind: 'done', outcome: { status: 'failed', reason: 'integrity_failed' } };
      }
      throw err;
    } finally {
      wipe(dek.dek);
    }
  });
  if (prep.kind === 'done') {
    log(prep.outcome.status === 'skipped' ? `skipped_${prep.outcome.reason}` : prep.outcome.status);
    return prep.outcome;
  }

  // 2) İşlem dışı: imza yaşı kapısı, nesne okuma + çözme + tarama.
  const scanner = deps.scanner;
  if (scanner === null) throw new Error('tarayıcı yok');
  const defer = async (
    reason: Extract<FileScanOutcome, { status: 'deferred' }>['reason'],
  ): Promise<FileScanOutcome> => {
    if (
      now().getTime() - job.enqueuedAt.getTime() >
      CONFIG_DEFAULTS['jobs.dependencyDeferMaxHours'] * 3_600_000
    ) {
      deps.logger.error({ event: 'file.scan.gave_up', fileId, reason });
      log('gave_up', { reason });
      return { status: 'gave_up', reason: 'dependency_unavailable' };
    }
    await deps.db
      .withTenant(ctx, (tx) => noteScanUnavailable(tx, orgId, fileId))
      .catch(() => undefined);
    log('deferred', { reason });
    return { status: 'deferred', untilMs: now().getTime() + deferDelayMs(job.deferrals), reason };
  };

  type Scanned =
    | { readonly kind: 'result'; readonly infected: string | null }
    | { readonly kind: 'fail'; readonly reason: 'object_missing' | 'integrity_failed' };
  let scanned: Scanned;
  try {
    const age = await scanner.databaseAgeDays(now());
    deps.metrics.set('eda_clamav_db_age_hours', age * 24);
    if (age > CONFIG_DEFAULTS['files.clamavMaxDbAgeDays']) {
      throw new ScannerUnavailableError('database_stale');
    }
    const head = await deps.store.head(prep.objectKey);
    if (head === null) {
      scanned = { kind: 'fail', reason: 'object_missing' };
    } else {
      const body = await deps.store.get(prep.objectKey);
      const plain = decryptIterable(
        body,
        { orgId, fileId, keyVersion: prep.keyVersion },
        prep.variantKey,
        { objectLength: head.size },
      );
      const result = await scanner.scan(plain);
      scanned = {
        kind: 'result',
        infected: result.status === 'infected' ? result.signature : null,
      };
      if (result.status === 'infected') {
        // İmza adı yalnız günlüğe (dosya adı değil); hiçbir DB kolonuna yazılmaz.
        deps.logger.warn({ event: 'file.scan.infected', fileId, signature: result.signature });
      }
    }
  } catch (err) {
    if (err instanceof ScannerUnavailableError) return defer(err.reason);
    if (err instanceof ObjectStoreError) {
      if (err.kind === 'not_found') scanned = { kind: 'fail', reason: 'object_missing' };
      else return defer('storage');
    } else if (err instanceof CryptoError) {
      scanned = { kind: 'fail', reason: 'integrity_failed' };
      deps.metrics.inc('eda_file_integrity_failures_total');
    } else {
      throw err;
    }
  } finally {
    wipe(prep.variantKey);
  }

  // 3) Sonuç işlemi.
  return deps.db.withTenant(ctx, async (tx): Promise<FileScanOutcome> => {
    if (scanned.kind === 'fail') {
      await failScan(tx, orgId, fileId, scanned.reason);
      log('failed', { reason: scanned.reason });
      return { status: 'failed', reason: scanned.reason };
    }
    if (scanned.infected !== null) {
      await finishScanInfected(tx, orgId, fileId);
      log('infected');
      return { status: 'infected' };
    }
    await finishScanClean(tx, orgId, fileId);
    log('clean');
    return { status: 'clean' };
  });
}

/** `AppError` ORG_NOT_MEMBER: yükleyen büroden ayrılmış; iş yeniden denenmez (kalıcı). */
export function isPermanentContextError(err: unknown): boolean {
  return err instanceof AppError && err.code === 'ORG_NOT_MEMBER';
}
