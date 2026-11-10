// Rota yardımcıları (040 §5, §6): kimlikten aktör, gövde/sorgu/yol ayrıştırma ve `no-store` yanıt.
// Doğrulama hataları 044 §5.2 biçimindedir (`VALIDATION_FAILED` + `fields`).

import type { MemberRole, VerificationStatus } from '@eda/contracts/enums';
import { AppError, fieldIssueOf } from '@eda/contracts/errors';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { SurfaceEnv } from '../context/types.ts';

export interface TenantActor {
  readonly orgId: string;
  readonly userId: string;
  readonly memberRole: MemberRole;
  readonly verificationStatus: VerificationStatus;
}

export function tenantActor(c: Context<SurfaceEnv>): TenantActor {
  const t = c.get('tenant');
  const u = c.get('user');
  if (t === null || t === undefined || u === undefined) throw new AppError('ORG_NO_ACTIVE');
  return {
    orgId: t.orgId,
    userId: t.userId,
    memberRole: t.memberRole,
    verificationStatus: u.verificationStatus,
  };
}

function fieldsOf(prefix: string, error: z.ZodError) {
  return error.issues.slice(0, 20).map((i) => ({
    path: [prefix, ...i.path.map(String)].join('.'),
    issue: fieldIssueOf(i),
  }));
}

export async function jsonBody<T>(c: Context<SurfaceEnv>, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError('VALIDATION_MALFORMED_BODY');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError('VALIDATION_FAILED', { fields: fieldsOf('body', r.error) });
  return r.data;
}

/** Gövde isteğe bağlıdır: boş gövde `{}` sayılır (ör. `POST …/versions` adsız). */
export async function optionalJsonBody<T>(
  c: Context<SurfaceEnv>,
  schema: z.ZodType<T>,
): Promise<T> {
  const text = await c.req.text();
  let raw: unknown = {};
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AppError('VALIDATION_MALFORMED_BODY');
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError('VALIDATION_FAILED', { fields: fieldsOf('body', r.error) });
  return r.data;
}

export function queryOf<T>(c: Context<SurfaceEnv>, schema: z.ZodType<T>): T {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw new AppError('VALIDATION_FAILED', { fields: fieldsOf('query', r.error) });
  return r.data;
}

export function send<T>(
  c: Context<SurfaceEnv>,
  schema: z.ZodType<T>,
  dto: T,
  status: 200 | 201 = 200,
) {
  c.header('Cache-Control', 'no-store');
  return c.json(schema.parse(dto) as object, status);
}
