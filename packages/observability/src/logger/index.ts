// Yapılandırılmış günlükleyici (040 §14, 002 §23): pino, tek satır JSON, UTC ISO 8601.
// İlke izin listesi önce: alanlar yalnız kimlik, kod, süre, sayı ve durum taşır; redact son savunmadır.
import { type Logger, type LoggerOptions, pino } from 'pino';

/** 002 §23 kanonik redact listesi (birebir). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'req.query',
  'req.body',
  'res.body',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.secret',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  '*.apiKey',
  '*.api_key',
  '*.otp',
  '*.totpCode',
  '*.backupCodes',
  '*.privateKey',
  '*.tckn',
  '*.vkn',
  '*.iban',
  '*.email',
  '*.phone',
  '*.address',
  '*.name',
  '*.fullName',
  '*.title',
  '*.fileName',
  '*.originalName',
  '*.content',
  '*.text',
  '*.parts',
  '*.llmParts',
  '*.llmContext',
  '*.messages',
  '*.prompt',
  '*.instructions',
  '*.reasoning',
  '*.query',
  '*.q',
  '*.input',
  '*.arguments',
  '*.output',
  '*.result',
  '*.snippet',
  '*.outline',
  '*.ops',
  '*.endpoint',
  '*.p256dh',
  '*.auth_secret',
  '*.sealed_params',
  '*.raw',
  '*.quote',
  '*.taxId',
  '*.providerToken',
  '*.customerRef',
] as const;

/** Kapalı olay sözlüğü (040 §14). Listede olmayan `event` kullanılmaz. */
export const LOG_EVENTS = [
  'server.started',
  'shutdown.started',
  'shutdown.completed',
  'shutdown.forced',
  'config.loaded',
  'config.setting_invalid',
  'http.request.completed',
  'auth.session.rejected',
  'security.origin_rejected',
  'security.rls_violation',
  'rate_limit.exceeded',
  'idempotency.replayed',
  'idempotency.conflict',
  'queue.enqueue_failed',
  'dependency.degraded',
  'process.fatal',
  // 045 §12.1 (P04a): e-posta gönderim sonuçları; alanlar yalnız teslimat kimliği, şablon, sınıf, kod.
  'email.sent',
  'email.failed',
  'email.suppressed',
] as const;
export type LogEvent = (typeof LOG_EVENTS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type EdaLogger = Logger;

export type CreateLoggerOptions = {
  service: string;
  level?: LogLevel;
  /** Test için hedef akış; verilmezse stdout. */
  destination?: { write(msg: string): void };
};

export function createLogger(opts: CreateLoggerOptions): EdaLogger {
  const options: LoggerOptions = {
    level: opts.level ?? 'info',
    base: { service: opts.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
  };
  return opts.destination ? pino(options, opts.destination) : pino(options);
}
