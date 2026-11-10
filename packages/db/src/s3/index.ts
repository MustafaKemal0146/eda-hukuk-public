// @eda/db/s3: nesne deposu portu, gerçek adaptör ve bootstrap (033 §3, §6.2). Bellek içi sahte depo
// yalnız testler içindir: `@eda/db/testing`.
export {
  type BootstrapClient,
  isNotImplemented,
  runS3Bootstrap,
  type S3BootstrapConfig,
  type S3BootstrapOptions,
  type S3BootstrapReport,
} from './bootstrap.ts';
export {
  createObjectStore,
  createS3Client,
  MULTIPART_PART_BYTES,
  type S3ClientOptions,
  type S3Credentials,
} from './client.ts';
export {
  type ObjectRange,
  type ObjectStore,
  ObjectStoreError,
  type ObjectStoreErrorKind,
} from './port.ts';
