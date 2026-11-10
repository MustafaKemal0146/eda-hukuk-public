// Migrate günlüğü: tek satır JSON (032 §4.3). Yalnız olay adı ve sayısal/kimlik alanları yazılır;
// SQL metni, parametre, parola, token ve satır içeriği YAZILMAZ (KK-032-22). Hata iletisi yerine
// SQLSTATE ve kısıt/nesne adı taşınır (PostgreSQL ileti metni değer içerebilir).
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly level: LogLevel;
  readonly event: string;
  readonly id?: string;
  readonly kind?: string;
  readonly tx_mode?: 'transaction' | 'none';
  readonly attempt?: number;
  readonly ms?: number;
  readonly code?: number;
  readonly sqlstate?: string;
  readonly applied?: number;
  readonly pending?: number;
  readonly iteration?: number;
  readonly rows?: number;
  readonly check?: string;
  readonly count?: number;
  readonly reason?: string;
  /** Seed sayımları (032 §10.1). */
  readonly inserted?: number;
  readonly updated?: number;
  readonly skipped?: number;
}

export interface MigrateLogger {
  write(entry: LogEntry): void;
}

/** Standart çıktıya JSON satırı yazan günlükçü. */
export const stdoutLogger: MigrateLogger = {
  write(entry) {
    process.stdout.write(`${JSON.stringify({ service: 'eda-migrate', ...entry })}\n`);
  },
};

/** PostgreSQL hatasından yalnız güvenli alanları çıkarır. */
export function pgErrorFields(err: unknown): { sqlstate?: string; check?: string } {
  if (typeof err !== 'object' || err === null) return {};
  const e = err as { code?: unknown; constraint?: unknown };
  const out: { sqlstate?: string; check?: string } = {};
  if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) out.sqlstate = e.code;
  if (typeof e.constraint === 'string' && /^[a-z0-9_]{1,63}$/.test(e.constraint)) {
    out.check = e.constraint;
  }
  return out;
}
