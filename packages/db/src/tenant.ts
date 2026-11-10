// Kiracı bağı (031 §4): kiracılı her sorgu yalnız `withTenant(ctx, fn)` içinde koşar. Bağ tek
// parametreli ifadeyle ve işlem yerel kurulur: SELECT set_config('app.org_id', $1, true), ...
// (string birleştirme, `SET LOCAL app.…`, `set_config(…, false)` YASAK). `app.member_role()` NULL ise
// `fn` hiç çağrılmadan ROLLBACK + ORG_NOT_MEMBER. Rol oturum değişkeniyle taşınmaz (002 §9;
// rol değişkeni geçersizdir): `fn`'e `member_role()` dönüşü verilir. `set_config(` bu dosya ve migrasyonlar dışında
// yazılmaz (031 §4.5; CI denetimi P03c).
//
// İşlem kapsamı kuralları (031 §4.3): `fn` içinde AĞ ÇAĞRISI YOK (LLM, yargi-mcp, S3, doc-engine,
// e-posta); iç içe sarmalayıcı yok (AsyncLocalStorage ile algılanır); SSE boyunca işlem açık tutulmaz.
// Commit sonrası yan etki (kuyruğa ekleme vb.) `tx.afterCommit()` ile (043 §12).
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import {
  DELETION_REASONS,
  type DeletionReason,
  MEMBER_ROLES,
  type MemberRole,
} from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { z } from 'zod';

export const NO_TENANT_REASONS = [
  'webhook',
  'corpus',
  'health',
  'pre_auth_audit',
  'catalog',
  // P04a: `email.send` teslimat satırının alıcı kimliklerini `app.email_delivery_route` ile
  // okumak için; ardından satır alıcı bağlamında (`withUserScope`) işlenir.
  'notification_route',
] as const;
export type NoTenantReason = (typeof NO_TENANT_REASONS)[number];

export interface TenantCtx {
  readonly orgId: string;
  readonly userId: string;
  /** Yalnız yavaş işlem günlüğü için (içerik değil). */
  readonly requestId?: string;
}
export interface UserCtx {
  readonly userId: string;
  readonly requestId?: string;
}
export interface TxOptions {
  readonly readOnly?: boolean;
  /** Metrik/günlük etiketi (`eda_db_tx_duration_seconds{label}`); içerik taşımaz. */
  readonly label?: string;
}

/**
 * 031 §4.2 madde 6: 2 sn'yi aşan işlem `warn` (yalnız label, süre, requestId). 002 §7'de anahtarı
 * yoktur; öneri `db.slowTxWarnMs`.
 */
export const SLOW_TX_WARN_MS = 2000;

/** Yeniden denenen SQLSTATE'ler: serileştirme hatası ve ölümcül kilitlenme (bir kez). */
const RETRYABLE = new Set(['40001', '40P01']);

declare const txBrand: unique symbol;

interface TxBase {
  /** Parametreli sorgu (değerler daima `$n` ile; string birleştirme YOK). */
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
  /** Drizzle sorgu oluşturucu (aynı bağlantı ve işlem; `db.transaction()` KULLANILMAZ). */
  readonly db: NodePgDatabase;
  /** Commit sonrası çalışır; geri almada çalışmaz (043 §12). */
  afterCommit(fn: () => void | Promise<void>): void;
}
export type TenantTx = TxBase & { readonly [txBrand]: 'tenant' };
export type UserTx = TxBase & { readonly [txBrand]: 'user' };
export type NoTenantTx = TxBase & { readonly [txBrand]: 'none' };

export interface TenantLogEntry {
  readonly level: 'warn';
  readonly event: 'db.tx.slow' | 'db.tx.after_commit_failed';
  readonly label: string;
  readonly ms: number;
  readonly requestId?: string;
}
export interface TenantLogger {
  write(entry: TenantLogEntry): void;
}

const stdoutTenantLogger: TenantLogger = {
  write(entry) {
    process.stdout.write(`${JSON.stringify({ service: 'eda-db', ...entry })}\n`);
  },
};

/** İç içe sarmalayıcı (031 §4.3 madde 2). */
export class TenantNestingError extends Error {
  override name = 'TenantNestingError';
  constructor() {
    super('withTenant iç içe çağrılamaz: dış işlem kapanmadan yeni kiracı işlemi açılamaz');
  }
}

/** İşlem kapandıktan sonra `tx` kullanımı. */
export class TenantTxClosedError extends Error {
  override name = 'TenantTxClosedError';
  constructor() {
    super('işlem kapandı: tx yalnız withTenant geri çağrısı içinde kullanılabilir');
  }
}

const Uuid = z.uuid();
const TenantCtxSchema = z.object({ orgId: Uuid, userId: Uuid });
const UserCtxSchema = z.object({ userId: Uuid });
const MemberRoleSchema = z.enum(MEMBER_ROLES);
const NoTenantReasonSchema = z.enum(NO_TENANT_REASONS);
const DeletionReasonSchema = z.enum(DELETION_REASONS);

function validationFailed(paths: readonly string[]): AppError<'VALIDATION_FAILED'> {
  return new AppError('VALIDATION_FAILED', {
    fields: paths.map((path) => ({ path, issue: 'invalid_uuid' as const })),
  });
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const res = schema.safeParse(value);
  if (!res.success) {
    throw validationFailed([...new Set(res.error.issues.map((i) => i.path.join('.') || 'ctx'))]);
  }
  return res.data;
}

const sqlStateOf = (err: unknown): string | undefined => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
};

type Binding =
  | { readonly kind: 'tenant'; readonly orgId: string; readonly userId: string }
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'none' };

export interface TenantRunner {
  withTenant<T>(
    ctx: TenantCtx,
    fn: (tx: TenantTx, role: MemberRole) => Promise<T>,
    opts?: TxOptions,
  ): Promise<T>;
  withUserScope<T>(ctx: UserCtx, fn: (tx: UserTx) => Promise<T>, opts?: TxOptions): Promise<T>;
  withNoTenant<T>(reason: NoTenantReason, fn: (tx: NoTenantTx) => Promise<T>): Promise<T>;
}

export interface TenantRunnerOptions {
  readonly logger?: TenantLogger;
  /** Saat kaynağı (test). */
  readonly now?: () => number;
}

/** Bağlam sızıntısı ve iç içe çağrı algılaması süreç geneli tektir (birden çok havuz olsa da). */
const activeTx = new AsyncLocalStorage<true>();

/**
 * Havuz parametreli çalıştırıcı (032 §12): uygulama varsayılan `eda_app` havuzunu kullanır; seed ve
 * test fixture'ları `eda_owner` havuzuyla aynı politikalardan geçer (031 §6.1).
 */
export function createTenantRunner(pool: pg.Pool, options: TenantRunnerOptions = {}): TenantRunner {
  const logger = options.logger ?? stdoutTenantLogger;
  const now = options.now ?? (() => performance.now());

  async function runOnce<T>(
    binding: Binding,
    fn: (tx: TxBase, role: MemberRole | null) => Promise<T>,
    opts: TxOptions & { readonly requestId?: string | undefined },
  ): Promise<T> {
    const started = now();
    const hooks: (() => void | Promise<void>)[] = [];
    const client = await pool.connect();
    let open = true;
    let discard = false;
    let result: T;
    try {
      await client.query(opts.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
      if (binding.kind === 'tenant') {
        await client.query(
          "SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)",
          [binding.orgId, binding.userId],
        );
      } else if (binding.kind === 'user') {
        await client.query("SELECT set_config('app.user_id', $1, true)", [binding.userId]);
      }
      let role: MemberRole | null = null;
      if (binding.kind === 'tenant') {
        const res = await client.query<{ role: string | null }>('SELECT app.member_role() AS role');
        const parsed = MemberRoleSchema.safeParse(res.rows[0]?.role);
        if (!parsed.success) throw new AppError('ORG_NOT_MEMBER');
        role = parsed.data;
      }
      let db: NodePgDatabase | undefined;
      const guard = (): void => {
        if (!open) throw new TenantTxClosedError();
      };
      const tx: TxBase = {
        query: (text, values) => {
          guard();
          return client.query(text, values as unknown[] | undefined);
        },
        get db() {
          guard();
          db ??= drizzle({ client });
          return db;
        },
        afterCommit: (hook) => {
          guard();
          hooks.push(hook);
        },
      };
      result = await activeTx.run(true, () => fn(tx, role));
      await client.query('COMMIT');
      open = false;
    } catch (err) {
      open = false;
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw err;
    } finally {
      open = false;
      client.release(discard ? true : undefined);
      const ms = Math.round(now() - started);
      if (ms > SLOW_TX_WARN_MS) {
        logger.write({
          level: 'warn',
          event: 'db.tx.slow',
          label: opts.label ?? binding.kind,
          ms,
          ...(opts.requestId ? { requestId: opts.requestId } : {}),
        });
      }
    }
    for (const hook of hooks) {
      try {
        await hook();
      } catch {
        logger.write({
          level: 'warn',
          event: 'db.tx.after_commit_failed',
          label: opts.label ?? binding.kind,
          ms: 0,
          ...(opts.requestId ? { requestId: opts.requestId } : {}),
        });
      }
    }
    return result;
  }

  async function run<T>(
    binding: Binding,
    fn: (tx: TxBase, role: MemberRole | null) => Promise<T>,
    opts: TxOptions & { readonly requestId?: string | undefined },
  ): Promise<T> {
    if (activeTx.getStore() !== undefined) throw new TenantNestingError();
    try {
      return await runOnce(binding, fn, opts);
    } catch (err) {
      const state = sqlStateOf(err);
      if (state === undefined || !RETRYABLE.has(state)) throw err;
      return await runOnce(binding, fn, opts);
    }
  }

  return {
    async withTenant(ctx, fn, opts = {}) {
      const { orgId, userId } = parseOrThrow(TenantCtxSchema, ctx);
      return run(
        { kind: 'tenant', orgId, userId },
        (tx, role) => fn(tx as TenantTx, role as MemberRole),
        { ...opts, requestId: ctx.requestId },
      );
    },
    async withUserScope(ctx, fn, opts = {}) {
      const { userId } = parseOrThrow(UserCtxSchema, ctx);
      return run({ kind: 'user', userId }, (tx) => fn(tx as UserTx), {
        ...opts,
        requestId: ctx.requestId,
      });
    },
    async withNoTenant(reason, fn) {
      const label = parseOrThrow(NoTenantReasonSchema, reason);
      return run({ kind: 'none' }, (tx) => fn(tx as NoTenantTx), { label });
    },
  };
}

/** Sorgu yapabilen asgari arayüz (pg istemcisi veya işlem). */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * İmha nedeni (030 §1.8): yalnız açık bir işlem içinde, `app.log_deletion()`'ın okuyacağı
 * `app.deletion_reason`'ı işlem yerel kurar. İmha işleri (035; eda_jobs) içindir.
 */
export async function bindDeletionReason(client: Queryable, reason: DeletionReason): Promise<void> {
  const value = parseOrThrow(DeletionReasonSchema, reason);
  await client.query("SELECT set_config('app.deletion_reason', $1, true)", [value]);
}

/**
 * Seed sentetik bağı (032 §11.3): `eda_owner` ile açık işlemdeki istemciye işlem yerel (`set_config(…,
 * true)`) kullanıcı ve isteğe bağlı büro bağı kurar; böylece seed yazımları uygulamayla aynı
 * politikalardan (`WITH CHECK`) geçer. Yalnız dev seed aşamaları çağırır (prod profili yüklemez).
 * Bağ işlem sonunda düşer; aynı işlemde yeniden çağrı öncekini ezer.
 */
export async function bindSeedContext(
  client: pg.ClientBase,
  ctx: { readonly userId: string; readonly orgId?: string | null },
): Promise<void> {
  await client.query(
    "SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)",
    [ctx.orgId ?? '', ctx.userId],
  );
}
