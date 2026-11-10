// S3 bootstrap (033 §3.1, §3.4): `eda_s3_admin` kimliğiyle kovalar ve yaşam döngüsü kuralları. Tek
// yetkili yer burasıdır (uygulama kimlikleri kova/ilke yönetemez). İdempotent: kova varsa oluşturulmaz,
// yaşam döngüsü ve Object Lock kuralları her koşuda yeniden yazılır (PUT tam değiştirir).
//   eda-files        sürümleme KAPALI (hiç açılmaz), yarım çok parçalı yükleme 1 gün sonra iptal
//   eda-exports      aynı + `retention.exportsDays` sonra süre sonu (config'ten ÜRETİLİR)
//   eda-audit-seals  Object Lock COMPLIANCE, `retention.auditLogYears` yıl
// Sağlayıcı bir özelliği desteklemiyorsa (501/NotImplemented) SESSİZCE atlanmaz: rapora `unsupported`
// olarak yazılır ve çağıran günlüğe uyarı düşer; eşdeğeri 033 §3.4/Açık Soru 3'tedir.
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectLockConfigurationCommand,
} from '@aws-sdk/client-s3';

export interface BootstrapClient {
  send(command: unknown): Promise<unknown>;
}

export interface S3BootstrapConfig {
  readonly buckets: { readonly files: string; readonly exports: string; readonly audit: string };
  readonly exportsDays: number;
  readonly auditLockYears: number;
}

export interface S3BootstrapReport {
  readonly created: string[];
  readonly configured: string[];
  readonly unsupported: { readonly bucket: string; readonly feature: string }[];
}

export interface S3BootstrapOptions {
  /** Geçici hatada toplam deneme sayısı (en az 1). */
  readonly attempts?: number;
  readonly delayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (event: string, fields: Readonly<Record<string, string | number>>) => void;
}

function statusOf(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
}
function nameOf(err: unknown): string {
  return (err as { name?: string } | null)?.name ?? '';
}

const NOT_IMPLEMENTED = new Set(['NotImplemented', 'XNotImplemented']);
const ALREADY_OWNED = new Set(['BucketAlreadyOwnedByYou', 'BucketAlreadyExists']);

export function isNotImplemented(err: unknown): boolean {
  return statusOf(err) === 501 || NOT_IMPLEMENTED.has(nameOf(err));
}
function isNotFound(err: unknown): boolean {
  return statusOf(err) === 404 || nameOf(err) === 'NotFound' || nameOf(err) === 'NoSuchBucket';
}
/** Ağ hatası (durum kodu yok) veya 5xx (501 hariç) yeniden denenir. */
function isTransient(err: unknown): boolean {
  const s = statusOf(err);
  if (isNotImplemented(err)) return false;
  return s === undefined || s >= 500;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runS3Bootstrap(
  client: BootstrapClient,
  cfg: S3BootstrapConfig,
  options: S3BootstrapOptions = {},
): Promise<S3BootstrapReport> {
  const attempts = Math.max(1, options.attempts ?? 1);
  const delayMs = options.delayMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? (() => undefined);
  const report: S3BootstrapReport = { created: [], configured: [], unsupported: [] };

  async function send(command: unknown): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await client.send(command);
      } catch (err) {
        if (attempt >= attempts || !isTransient(err)) throw err;
        log('s3.bootstrap.retry', { attempt });
        await sleep(delayMs * attempt);
      }
    }
  }

  async function ensureBucket(bucket: string, objectLock: boolean): Promise<void> {
    try {
      await send(new HeadBucketCommand({ Bucket: bucket }));
      return;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    try {
      await send(
        new CreateBucketCommand({
          Bucket: bucket,
          ...(objectLock ? { ObjectLockEnabledForBucket: true } : {}),
        }),
      );
      report.created.push(bucket);
      log('s3.bootstrap.bucket_created', { bucket });
    } catch (err) {
      if (!ALREADY_OWNED.has(nameOf(err))) throw err;
    }
  }

  async function feature(bucket: string, name: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
      report.configured.push(`${bucket}:${name}`);
    } catch (err) {
      if (!isNotImplemented(err)) throw err;
      report.unsupported.push({ bucket, feature: name });
      log('s3.bootstrap.unsupported', { bucket, feature: name });
    }
  }

  const abortRule = {
    ID: 'abort-incomplete-mpu',
    Status: 'Enabled' as const,
    Filter: { Prefix: '' },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
  };

  await ensureBucket(cfg.buckets.files, false);
  await feature(cfg.buckets.files, 'lifecycle', () =>
    send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: cfg.buckets.files,
        LifecycleConfiguration: { Rules: [abortRule] },
      }),
    ),
  );

  await ensureBucket(cfg.buckets.exports, false);
  await feature(cfg.buckets.exports, 'lifecycle', () =>
    send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: cfg.buckets.exports,
        LifecycleConfiguration: {
          Rules: [
            abortRule,
            {
              ID: 'expire-exports',
              Status: 'Enabled' as const,
              Filter: { Prefix: '' },
              Expiration: { Days: cfg.exportsDays },
            },
          ],
        },
      }),
    ),
  );

  await ensureBucket(cfg.buckets.audit, true);
  await feature(cfg.buckets.audit, 'object_lock', () =>
    send(
      new PutObjectLockConfigurationCommand({
        Bucket: cfg.buckets.audit,
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: cfg.auditLockYears } },
        },
      }),
    ),
  );

  return report;
}
