// `notifications` ve `maintenance` kuyruklarının e-posta iş yükleri (045 §6.2–§6.3; 043 §3.1;
// 002 §26 madde 86). Yükte yalnız sürüm, kaynak istek, iz bağlamı ve teslimat kimliği bulunur;
// alıcı adresi, ad, bağlantı ve belirteç YOKTUR (sır `email_deliveries.sealed_params`'tadır).
import { z } from 'zod';
import { JobEnvelope } from './envelope.ts';

/** `email.send`: `jobId = deliveryId` (045 §6.2 madde 2). */
export const EmailSendJob = JobEnvelope.extend({ deliveryId: z.uuid() }).strict();
export type EmailSendJob = z.infer<typeof EmailSendJob>;

/** `email_outbox.sweep` (045 §6.2 madde 5): zamanlayıcı işi, zarf dışında alan yok. */
export const EmailOutboxSweepPayload = JobEnvelope.extend({}).strict();
export type EmailOutboxSweepPayload = z.infer<typeof EmailOutboxSweepPayload>;
