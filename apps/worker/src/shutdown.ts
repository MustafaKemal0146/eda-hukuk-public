// Sinyal ve ölümcül hata yönetimi (043 §13): ilk SIGTERM/SIGINT zarif kapanışı başlatır, ikinci
// sinyal hemen çıkar; `uncaughtException`/`unhandledRejection` -> `fatal` günlük ve kapanış (çıkış 1).
import type { EdaLogger } from '@eda/observability/logger';

export type ShutdownFn = (reason: string) => Promise<void>;

export function installShutdown(
  logger: EdaLogger,
  shutdown: ShutdownFn,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  let stopping = false;
  const run = (reason: string, code: number): void => {
    if (stopping) {
      logger.warn({ event: 'shutdown.forced', reason });
      exit(1);
      return;
    }
    stopping = true;
    logger.info({ event: 'shutdown.started', signal: reason });
    shutdown(reason).then(
      () => {
        logger.info({ event: 'shutdown.completed' });
        exit(code);
      },
      (err: unknown) => {
        logger.error({
          event: 'shutdown.forced',
          err: err instanceof Error ? err.name : 'unknown',
        });
        exit(1);
      },
    );
  };
  process.on('SIGTERM', () => run('SIGTERM', 0));
  process.on('SIGINT', () => run('SIGINT', 0));
  const fatal = (err: unknown): void => {
    logger.fatal({ event: 'process.fatal', err: err instanceof Error ? err.name : 'unknown' });
    run('fatal', 1);
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);
}
