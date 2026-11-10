// Rota sınırı doğrulaması (040 §6): gövde ve sorgu dizesi @eda/contracts şemalarıyla; hata 044
// `VALIDATION_FAILED` zarfı, alan yolu `body.*` / `query.*` / `path.*`. Değer yanıta yazılmaz.
import { AppError, fieldIssueOf } from '@eda/contracts/errors';
import type { z } from 'zod';

function fail(target: string, error: z.ZodError): never {
  throw new AppError('VALIDATION_FAILED', {
    fields: error.issues.slice(0, 20).map((i) => ({
      path: [target, ...i.path.map(String)].join('.'),
      issue: fieldIssueOf(i),
    })),
  });
}

/** JSON gövdesi; `optional` iken boş gövde `{}` sayılır. */
export async function parseJsonBody<S extends z.ZodType>(
  schema: S,
  req: Request,
  optional = false,
): Promise<z.infer<S>> {
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim() !== '' || !optional) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ path: 'body', issue: 'invalid_type' }],
      });
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) fail('body', r.error);
  return r.data;
}

export function parseQuery<S extends z.ZodType>(
  schema: S,
  query: Record<string, string>,
): z.infer<S> {
  const r = schema.safeParse(query);
  if (!r.success) fail('query', r.error);
  return r.data;
}
