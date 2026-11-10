// Gerçek nesne deposu adaptörü (@aws-sdk/client-s3 → SeaweedFS S3, 033 §3, §6.2). Uygulama kimliği
// yalnız `eda-files` / `eda-exports` okur/yazar; kova ve ilke yönetimi `bootstrap.ts`'tedir.
// Çok parçalı yükleme elle yazılmıştır (yeni bağımlılık `lib-storage` YOK): parça 8 MiB, sıralı.
import { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { type ObjectRange, type ObjectStore, ObjectStoreError } from './port.ts';

export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;

export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface S3ClientOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly credentials: S3Credentials;
}

/** SeaweedFS uyumu: yol stili adresleme; zorunlu olmayan sağlama toplamı eklentileri kapalı. */
export function createS3Client(o: S3ClientOptions): S3Client {
  return new S3Client({
    endpoint: o.endpoint,
    region: o.region,
    credentials: {
      accessKeyId: o.credentials.accessKeyId,
      secretAccessKey: o.credentials.secretAccessKey,
    },
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function statusOf(err: unknown): number | undefined {
  const meta = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata;
  return meta?.httpStatusCode;
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'NoSuchKey' || name === 'NotFound' || statusOf(err) === 404;
}

function toStoreError(err: unknown): ObjectStoreError {
  return err instanceof ObjectStoreError
    ? err
    : new ObjectStoreError(isNotFound(err) ? 'not_found' : 'unavailable');
}

export function createObjectStore(
  client: S3Client,
  bucket: string,
  options: { readonly partBytes?: number } = {},
): ObjectStore {
  const part = options.partBytes ?? MULTIPART_PART_BYTES;

  async function abort(key: string, uploadId: string): Promise<void> {
    await client
      .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
      .catch(() => undefined);
  }

  return {
    async put(key, source) {
      let uploadId: string | undefined;
      const etags: { ETag: string; PartNumber: number }[] = [];
      let pending: Buffer = Buffer.alloc(0);
      let total = 0;
      const uploadPart = async (body: Buffer): Promise<void> => {
        if (uploadId === undefined) {
          const created = await client.send(
            new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
          );
          if (created.UploadId === undefined) throw new ObjectStoreError('unavailable');
          uploadId = created.UploadId;
        }
        const partNumber = etags.length + 1;
        const res = await client.send(
          new UploadPartCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: body,
            ContentLength: body.length,
          }),
        );
        if (res.ETag === undefined) throw new ObjectStoreError('unavailable');
        etags.push({ ETag: res.ETag, PartNumber: partNumber });
      };
      // Kaynak (istemci gövdesi, şifreleme, tür denetimi) hataları S3 hatasıyla karışmaz: olduğu gibi
      // yeniden fırlatılır; yalnız S3 çağrı hataları `ObjectStoreError`'a çevrilir.
      const it = source[Symbol.asyncIterator]();
      let sourceFailure: { readonly error: unknown } | undefined;
      const next = async (): Promise<IteratorResult<Uint8Array>> => {
        try {
          return await it.next();
        } catch (error) {
          sourceFailure = { error };
          throw error;
        }
      };
      try {
        for (;;) {
          const r = await next();
          if (r.done === true) break;
          const chunk = r.value;
          total += chunk.length;
          pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
          // Son parça akış sonunda bilinir: yalnız bir parçadan FAZLA birikince öndekini yükle.
          while (pending.length > part) {
            await uploadPart(pending.subarray(0, part));
            pending = pending.subarray(part);
          }
        }
        if (uploadId === undefined) {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: pending,
              ContentLength: pending.length,
            }),
          );
          return { size: total };
        }
        await uploadPart(pending);
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: { Parts: etags },
          }),
        );
        return { size: total };
      } catch (err) {
        if (uploadId !== undefined) await abort(key, uploadId);
        await it.return?.().catch(() => undefined);
        throw sourceFailure === undefined ? toStoreError(err) : sourceFailure.error;
      }
    },

    async get(key, range?: ObjectRange) {
      try {
        const res = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ...(range === undefined ? {} : { Range: `bytes=${range.start}-${range.end}` }),
          }),
        );
        if (!(res.Body instanceof Readable)) throw new ObjectStoreError('unavailable');
        return res.Body;
      } catch (err) {
        throw toStoreError(err);
      }
    },

    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: Number(res.ContentLength ?? 0) };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw toStoreError(err);
      }
    },

    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        if (isNotFound(err)) return;
        throw toStoreError(err);
      }
    },

    async copy(fromKey, toKey) {
      try {
        await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: toKey,
            CopySource: `${bucket}/${fromKey}`,
          }),
        );
      } catch (err) {
        throw toStoreError(err);
      }
    },
  };
}
