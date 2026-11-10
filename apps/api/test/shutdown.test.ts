// @tk TK-03
// KK-P01b-5: kapanış zaman çizelgesi (040 §12.2): ilk sinyal drenaj + temiz çıkış 0; ikinci sinyal 1;
// süre aşımında zorla çıkış 1.
import { createLogger } from '@eda/observability/logger';
import { describe, expect, it, vi } from 'vitest';
import { createShutdown } from '../src/shutdown.ts';

const logger = createLogger({ service: 'eda-api-test', destination: { write: () => undefined } });

function fakeServer(closeDelayMs: number) {
  return {
    close: (cb?: (err?: Error) => void) => {
      setTimeout(() => cb?.(), closeDelayMs);
      return undefined as never;
    },
    closeIdleConnections: vi.fn(),
  };
}

describe('KK-P01b-5: createShutdown', () => {
  it('ilk sinyal draining=true yapar ve sunucular kapanınca 0 ile çıkar', async () => {
    const state = { draining: false };
    const exit = vi.fn();
    const server = fakeServer(5);
    createShutdown({
      servers: [server],
      logger,
      state,
      drainGraceMs: 120_000,
      finalizeBudgetMs: 12_000,
      exit,
    })('SIGTERM');
    expect(state.draining).toBe(true);
    expect(server.closeIdleConnections).toHaveBeenCalled();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it('ikinci sinyal hemen 1 ile çıkar', () => {
    const exit = vi.fn();
    const stop = createShutdown({
      servers: [fakeServer(10_000)],
      logger,
      state: { draining: false },
      drainGraceMs: 120_000,
      finalizeBudgetMs: 12_000,
      exit,
    });
    stop('SIGTERM');
    stop('SIGTERM');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('süre aşımında (drainGrace − 2 sn) zorla 1 ile çıkar; akışlar önce durdurulur', () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      const abortStreams = vi.fn();
      createShutdown({
        servers: [fakeServer(1_000_000)],
        logger,
        state: { draining: false },
        drainGraceMs: 120_000,
        finalizeBudgetMs: 12_000,
        exit,
        abortStreams,
      })('SIGTERM');
      vi.advanceTimersByTime(108_000);
      expect(abortStreams).toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
