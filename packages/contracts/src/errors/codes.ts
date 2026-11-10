// Hata kodu listesi: katalogdan türetilir (044 §2.3). Biçim `^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$`.
import { ERROR_CATALOG, type ErrorCode } from './catalog.ts';

export type { ErrorCode } from './catalog.ts';

export const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;

export const ERROR_CODES = Object.freeze(Object.keys(ERROR_CATALOG)) as readonly [
  ErrorCode,
  ...ErrorCode[],
];

const CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

/** Çalışma zamanı denetimi: değer katalogdaki bir kod mu. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}
