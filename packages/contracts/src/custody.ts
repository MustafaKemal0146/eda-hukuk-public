// Delil zinciri olay metadata'sı (033 §8.1): olay başına strict şema; şema dışı anahtar yazılamaz.
// İçerik, dosya adı ve virüs imza adı metadata'ya GİRMEZ.
import { z } from 'zod';
import { ACCEPTED_FILE_TYPES, type CUSTODY_EVENTS, FILE_ORIGINS } from './enums.ts';

const Variant = z.enum(['orig', 'searchable', 'clean', 'text']);

export const CUSTODY_METADATA = {
  upload: z.strictObject({
    size_bytes: z.number().int().positive(),
    file_type: z.enum(ACCEPTED_FILE_TYPES),
    origin: z.enum(FILE_ORIGINS),
    case_id: z.uuid().nullable(),
  }),
  view: z.strictObject({ variant: Variant, range: z.string().max(64).nullable() }),
  download: z.strictObject({
    variant: Variant,
    range: z.string().max(64).nullable(),
    via_token: z.boolean(),
  }),
  export: z.strictObject({ export_id: z.uuid(), export_kind: z.string().max(40) }),
  move: z.strictObject({ from: z.literal('inbox'), to_case_id: z.uuid() }),
  delete_request: z.strictObject({
    reason: z.enum(['user', 'kvkk', 'retention']),
    grace_until: z.iso.datetime({ offset: true }).nullable(),
  }),
  delete_cancel: z.strictObject({}),
  delete: z.strictObject({
    reason: z.string().max(40),
    size_bytes: z.number().int().positive(),
    file_type: z.enum(ACCEPTED_FILE_TYPES),
  }),
} as const satisfies Record<(typeof CUSTODY_EVENTS)[number], z.ZodType>;

export type CustodyEventName = keyof typeof CUSTODY_METADATA;
export type CustodyMetadataOf<E extends CustodyEventName> = z.infer<(typeof CUSTODY_METADATA)[E]>;

/** Metadata'yı olaya özgü şemayla doğrular; geçersizse `ZodError` fırlatır (kayıt yazılmaz). */
export function parseCustodyMetadata<E extends CustodyEventName>(
  event: E,
  metadata: unknown,
): CustodyMetadataOf<E> {
  return CUSTODY_METADATA[event].parse(metadata) as CustodyMetadataOf<E>;
}
