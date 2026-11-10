// Evrak nesne deposu bağlantısı (033 §3): `eda-files` kovası, `eda_app` kimliği. Port ve gerçek adaptör
// `@eda/db/s3` içindedir (worker ile ortak); burada yalnız yapılandırmadan kurulur. Kimlik bilgileri
// sır dosyasından gelir ve hiçbir yere yazılmaz. objstore iç ağdadır (NO_PROXY); presigned URL yoktur.
import { createObjectStore, createS3Client, type ObjectStore } from '@eda/db/s3';
import type { ApiConfig } from '../config/load.ts';

export type { ObjectStore } from '@eda/db/s3';

export function createFilesObjectStore(config: ApiConfig): ObjectStore {
  return createObjectStore(
    createS3Client({
      endpoint: config.env.S3_ENDPOINT,
      region: config.env.S3_REGION,
      credentials: {
        accessKeyId: config.secrets.get('S3_ACCESS_KEY_ID_FILE'),
        secretAccessKey: config.secrets.get('S3_SECRET_ACCESS_KEY_FILE'),
      },
    }),
    config.env.S3_BUCKET_FILES,
  );
}
