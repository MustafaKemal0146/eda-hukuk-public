// Dosya hattı iş yükleri (043 §3.2; 033 §7.2): yük yalnız kimlik taşır (dosya adı, içerik, imza adı YOK).
// `userId` yükleyen kullanıcıdır: işçi RLS altında bu kimlikle `withTenant` açar.
import { z } from 'zod';
import { JobEnvelope } from './envelope.ts';

export const FileScanJob = JobEnvelope.extend({
  orgId: z.uuid(),
  fileId: z.uuid(),
  userId: z.uuid(),
}).strict();
export type FileScanJob = z.infer<typeof FileScanJob>;

/** `file.extract` yükü `file.scan` ile aynıdır (yalnız kimlik; 033 §7.2). */
export const FileExtractJob = JobEnvelope.extend({
  orgId: z.uuid(),
  fileId: z.uuid(),
  userId: z.uuid(),
}).strict();
export type FileExtractJob = z.infer<typeof FileExtractJob>;

/** BullMQ `jobId`: `<iş>__<fileId>__<epoch>`; `:` BullMQ'da yasaktır (043 §8.1). */
export function fileJobId(
  job: 'file.scan' | 'file.extract',
  fileId: string,
  epochSec: number,
): string {
  return `${job}__${fileId}__${epochSec}`;
}
