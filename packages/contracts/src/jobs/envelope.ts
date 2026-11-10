// İş zarfı (043 §3.1): her iş yükü bu zarfı `.extend({ ...kimlikler }).strict()` ile genişletir.
// Yükte yalnız sürüm, kaynak istek kimliği, iz bağlamı ve kimlikler bulunur; içerik/PII yoktur (Y-54).
import { z } from 'zod';

/** W3C `traceparent` uzunluğu (sürüm 00: 2 + 1 + 32 + 1 + 16 + 1 + 2). */
const TRACEPARENT_LENGTH = 55;

export const JobEnvelope = z.strictObject({
  /** Yük sürümü (040 §8). */
  v: z.literal(1),
  /** Kaynak istek (040 §5.3); zamanlayıcı işlerinde yoktur. */
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,64}$/)
    .optional(),
  /** W3C iz bağlamı. */
  traceparent: z.string().length(TRACEPARENT_LENGTH).optional(),
});
export type JobEnvelope = z.infer<typeof JobEnvelope>;
