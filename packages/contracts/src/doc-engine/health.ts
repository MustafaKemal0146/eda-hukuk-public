// doc-engine sağlık yanıtı şeması (`GET /health`).
import { z } from 'zod';

export const HealthResponse = z
  .object({
    status: z.literal('ok'),
    version: z.string(),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponse>;
