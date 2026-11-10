// Bağımlılık TCP erişim denetimi. P01b hazırlığı TCP düzeyindedir; P03 gerçek SELECT 1 / PING ile
// değiştirir.
import { connect } from 'node:net';

export function tcpReachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
