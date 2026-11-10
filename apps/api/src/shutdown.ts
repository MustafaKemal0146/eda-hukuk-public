// Zarif kapanış (040 §12.2). t=0: draining, /ready 503, sunucular yeni bağlantı almaz.
// drainGrace − finalizeBudget: kalan akışlar durdurulur (P09 bağlar). drainGrace − 2 sn: zorla çıkış 1.
// İkinci sinyal: hemen çıkış 1.
import type { Server } from 'node:http';
import type { EdaLogger } from '@eda/observability/logger';
import type { RuntimeState } from './context/types.ts';

export type ShutdownOptions = {
  servers: readonly Pick<Server, 'close' | 'closeIdleConnections'>[];
  logger: EdaLogger;
  state: RuntimeState;
  drainGraceMs: number;
  finalizeBudgetMs: number;
  exit: (code: number) => void;
  /** Uçuştaki akışları durdurur (P09). */
  abortStreams?: () => void;
  /** Kapanış öncesi kaynakları boşaltır (havuzlar, kuyruklar; P03+). */
  release?: () => Promise<void>;
};

const FORCE_MARGIN_MS = 2000;

export function createShutdown(opts: ShutdownOptions): (signal: string) => void {
  let started = false;
  return (signal) => {
    if (started) {
      opts.logger.error({ event: 'shutdown.forced', reason: 'second_signal' });
      opts.exit(1);
      return;
    }
    started = true;
    opts.state.draining = true;
    opts.logger.info({ event: 'shutdown.started', signal });

    const abortTimer = setTimeout(
      () => opts.abortStreams?.(),
      Math.max(0, opts.drainGraceMs - opts.finalizeBudgetMs),
    );
    const forceTimer = setTimeout(
      () => {
        opts.logger.error({ event: 'shutdown.forced', reason: 'timeout' });
        opts.exit(1);
      },
      Math.max(0, opts.drainGraceMs - FORCE_MARGIN_MS),
    );
    abortTimer.unref();
    forceTimer.unref();

    const closed = opts.servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections();
        }),
    );
    void Promise.all(closed)
      .then(() => opts.release?.())
      .then(() => {
        clearTimeout(abortTimer);
        clearTimeout(forceTimer);
        opts.logger.info({ event: 'shutdown.completed' });
        opts.exit(0);
      });
  };
}
