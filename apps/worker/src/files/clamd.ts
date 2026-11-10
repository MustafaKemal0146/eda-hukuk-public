// clamd INSTREAM istemcisi (033 §7.6): `zINSTREAM\0`, ardından uint32 BE uzunluklu parçalar, 0 uzunluklu
// parçayla bitiş; yanıt `stream: OK`, `stream: <imza> FOUND` veya `… ERROR`. Yeni bağımlılık yok (net).
// Düz metin yalnız bu soket ve bellek tamponlarındadır; diske yazılmaz. clamd yalnız `docproc`
// ağındadır (dışarı çıkmaz). Her çağrı yeni bağlantıdır (INSTREAM bağlantıyı kapatır).
import { connect, type Socket } from 'node:net';
import { ScannerUnavailableError, type ScanResult, type VirusScanner } from './scanner.ts';

/** clamd varsayılan `StreamMaxLength` altında güvenli parça boyutu (INSTREAM parçası). */
export const CLAMD_CHUNK_BYTES = 64 * 1024;
const TERMINATOR = Buffer.alloc(4);

export interface ClamdOptions {
  readonly host: string;
  readonly port: number;
  /** Bağlantı ve her G/Ç beklemesi için üst süre. */
  readonly timeoutMs: number;
}

/** `stream: OK` / `stream: Eicar-Signature FOUND` / `... ERROR` yanıtını çözer. */
export function parseInstreamReply(reply: string): ScanResult {
  const line = reply.replace(/\0+$/, '').trim();
  if (/^stream:\s*OK$/.test(line)) return { status: 'clean' };
  const found = /^stream:\s*(.+?)\s+FOUND$/.exec(line);
  if (found?.[1] !== undefined) return { status: 'infected', signature: found[1] };
  throw new ScannerUnavailableError('protocol');
}

/**
 * `VERSION` yanıtı `ClamAV 1.4.2/27500/Tue Oct 14 08:32:11 2026` biçimindedir; imza tarihi son
 * alandır. Çözülemezse `protocol` hatası (fail-closed).
 */
export function parseSignatureDate(version: string): Date {
  const parts = version.replace(/\0+$/, '').trim().split('/');
  const raw = parts[2];
  const date = raw === undefined ? new Date(Number.NaN) : new Date(`${raw} UTC`);
  if (Number.isNaN(date.getTime())) throw new ScannerUnavailableError('protocol');
  return date;
}

function wait(socket: Socket, event: 'connect' | 'drain', timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ScannerUnavailableError('timeout')), timeoutMs);
    const onError = () => {
      clearTimeout(timer);
      reject(new ScannerUnavailableError('connect'));
    };
    socket.once('error', onError);
    socket.once(event, () => {
      clearTimeout(timer);
      socket.off('error', onError);
      resolve();
    });
  });
}

function readAll(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new ScannerUnavailableError('timeout'));
    }, timeoutMs);
    socket.on('data', (d: Buffer) => {
      size += d.length;
      if (size > 4096) {
        clearTimeout(timer);
        socket.destroy();
        reject(new ScannerUnavailableError('protocol'));
        return;
      }
      chunks.push(d);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      reject(new ScannerUnavailableError('connect'));
    });
    socket.once('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

async function open(o: ClamdOptions): Promise<Socket> {
  const socket = connect({ host: o.host, port: o.port });
  socket.setNoDelay(true);
  await wait(socket, 'connect', o.timeoutMs);
  // Sonraki hatalar `readAll`/yazma yolunda ele alınır; işlenmeyen olay süreci düşürmesin.
  socket.on('error', () => undefined);
  return socket;
}

async function write(socket: Socket, data: Uint8Array, timeoutMs: number): Promise<void> {
  if (socket.destroyed) throw new ScannerUnavailableError('connect');
  if (!socket.write(data)) await wait(socket, 'drain', timeoutMs);
}

export function createClamdScanner(o: ClamdOptions): VirusScanner {
  return {
    async scan(source) {
      const socket = await open(o);
      try {
        await write(socket, Buffer.from('zINSTREAM\0'), o.timeoutMs);
        for await (const raw of source) {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          for (let i = 0; i < chunk.length; i += CLAMD_CHUNK_BYTES) {
            const part = chunk.subarray(i, i + CLAMD_CHUNK_BYTES);
            const len = Buffer.alloc(4);
            len.writeUInt32BE(part.length, 0);
            await write(socket, Buffer.concat([len, part]), o.timeoutMs);
          }
        }
        await write(socket, TERMINATOR, o.timeoutMs);
        return parseInstreamReply(await readAll(socket, o.timeoutMs));
      } finally {
        socket.destroy();
      }
    },

    async databaseAgeDays(now) {
      const socket = await open(o);
      try {
        await write(socket, Buffer.from('zVERSION\0'), o.timeoutMs);
        const date = parseSignatureDate(await readAll(socket, o.timeoutMs));
        return Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
      } finally {
        socket.destroy();
      }
    },
  };
}
