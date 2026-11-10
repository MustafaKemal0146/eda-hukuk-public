// Zarif boşaltma (043 §13, KK-043-10 öncülü): yeni iş alınmaz (`pause`), aktif işler en çok
// `jobs.shutdownGraceSec` beklenir; süre dolarsa `close(true)` ile bırakılır (kilit `lockDuration`
// sonunda düşer, iş stalled olarak yeniden kuyruğa girer; işleyiciler idempotenttir).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';

export interface DrainableWorker {
  pause(doNotWaitActive?: boolean): Promise<void>;
  close(force?: boolean): Promise<void>;
}

export type DrainResult = 'drained' | 'forced';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

export async function drainWorker(
  worker: DrainableWorker,
  graceMs: number = CONFIG_DEFAULTS['jobs.shutdownGraceSec'] * 1000,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<DrainResult> {
  // pause(false): bayrak hemen kalkar (yeni iş alınmaz), söz aktif işler bitince çözülür.
  const finished = worker.pause(false).then((): DrainResult => 'drained');
  const timedOut = wait(graceMs).then((): DrainResult => 'forced');
  const result = await Promise.race([finished, timedOut]);
  await worker.close(result === 'forced');
  return result;
}
