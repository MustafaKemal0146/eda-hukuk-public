// @tk TK-28
// KK-P20-19 (KK-033-12/13): clamd INSTREAM istemcisi: çerçeveleme (`zINSTREAM\0`, uint32 BE uzunluklu
// parçalar, 0 uzunluklu bitiş), `OK`/`FOUND`/`ERROR` yanıtları, VERSION imza tarihi, bağlantı hatası ve
// zaman aşımı `ScannerUnavailableError`. Gerçek TCP soketi üzerinde sahte clamd ile koşar.
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAMD_CHUNK_BYTES,
  createClamdScanner,
  parseInstreamReply,
  parseSignatureDate,
} from '../src/files/clamd.ts';
import { ScannerUnavailableError } from '../src/files/scanner.ts';

interface Fake {
  readonly port: number;
  readonly commands: string[];
  readonly received: Buffer[][];
  close(): Promise<void>;
}

const servers: Server[] = [];

async function fakeClamd(
  reply: (cmd: string, socket: Socket, framed: Buffer[]) => void | Promise<void>,
): Promise<Fake> {
  const commands: string[] = [];
  const received: Buffer[][] = [];
  const server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    let command: string | null = null;
    const framed: Buffer[] = [];
    socket.on('error', () => undefined);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (command === null) {
        const nul = buf.indexOf(0);
        if (nul < 0) return;
        command = buf.subarray(0, nul).toString('ascii');
        commands.push(command);
        buf = buf.subarray(nul + 1);
        if (command === 'zVERSION' || command.endsWith('VERSION')) {
          void reply(command, socket, framed);
          return;
        }
      }
      while (command === 'zINSTREAM' && buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          received.push(framed);
          void reply(command, socket, framed);
          return;
        }
        if (buf.length < 4 + len) return;
        framed.push(Buffer.from(buf.subarray(4, 4 + len)));
        buf = buf.subarray(4 + len);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  return {
    port,
    commands,
    received,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

afterEach(async () => {
  for (const s of servers.splice(0)) s.close();
});

async function* chunks(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield p;
}

const opts = (port: number) => ({ host: '127.0.0.1', port, timeoutMs: 1500 });

describe('KK-P20-19: clamd INSTREAM çerçevelemesi ve yanıtlar', () => {
  it('temiz akış: zINSTREAM, uzunluklu parçalar, bitiş parçası; yanıt OK', async () => {
    const fake = await fakeClamd((_c, s) => {
      s.end('stream: OK\0');
    });
    const scanner = createClamdScanner(opts(fake.port));
    const big = Buffer.alloc(CLAMD_CHUNK_BYTES * 2 + 10, 7);
    const result = await scanner.scan(chunks(Buffer.from('abc'), big));
    expect(result).toEqual({ status: 'clean' });
    expect(fake.commands).toEqual(['zINSTREAM']);
    const framed = fake.received[0] ?? [];
    expect(Buffer.concat(framed).equals(Buffer.concat([Buffer.from('abc'), big]))).toBe(true);
    expect(framed.every((f) => f.length <= CLAMD_CHUNK_BYTES)).toBe(true);
  });

  it('FOUND: imza adı döner', async () => {
    const fake = await fakeClamd((_c, s) => {
      s.end('stream: Win.Test.EICAR_HDB-1 FOUND\0');
    });
    const result = await createClamdScanner(opts(fake.port)).scan(chunks(Buffer.from('x')));
    expect(result).toEqual({ status: 'infected', signature: 'Win.Test.EICAR_HDB-1' });
  });

  it('ERROR ve tanınmayan yanıt protocol hatasıdır (temiz sayılmaz)', async () => {
    for (const reply of ['INSTREAM size limit exceeded. ERROR\0', 'stream: ERROR\0', 'merhaba\0']) {
      const fake = await fakeClamd((_c, s) => {
        s.end(reply);
      });
      await expect(
        createClamdScanner(opts(fake.port)).scan(chunks(Buffer.from('x'))),
      ).rejects.toMatchObject({
        name: 'ScannerUnavailableError',
        reason: 'protocol',
      });
    }
  });

  it('kaynak akış hata verirse bitiş parçası GÖNDERİLMEZ ve hata aynen yayılır', async () => {
    const fake = await fakeClamd((_c, s) => {
      s.end('stream: OK\0');
    });
    async function* broken(): AsyncGenerator<Uint8Array> {
      yield Buffer.from('ilk');
      throw new Error('bütünlük hatası');
    }
    await expect(createClamdScanner(opts(fake.port)).scan(broken())).rejects.toThrow(
      'bütünlük hatası',
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.received).toEqual([]);
  });
});

describe('KK-P20-19 (KK-033-13): altyapı kesintisi', () => {
  it('bağlantı reddi connect, sessiz sunucu timeout', async () => {
    const fake = await fakeClamd(() => undefined);
    const port = fake.port;
    await expect(
      createClamdScanner({ host: '127.0.0.1', port, timeoutMs: 150 }).scan(
        chunks(Buffer.from('x')),
      ),
    ).rejects.toMatchObject({ reason: 'timeout' });
    await fake.close();
    await expect(
      createClamdScanner({ host: '127.0.0.1', port, timeoutMs: 500 }).scan(
        chunks(Buffer.from('x')),
      ),
    ).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it('VERSION: imza tarihi çözülür ve yaş gün olarak hesaplanır', async () => {
    const fake = await fakeClamd((_c, s) => {
      s.end('ClamAV 1.4.2/27500/Tue Oct 14 08:32:11 2026\0');
    });
    const age = await createClamdScanner(opts(fake.port)).databaseAgeDays(
      new Date('2026-10-16T08:32:11Z'),
    );
    expect(age).toBeCloseTo(2, 5);
    expect(fake.commands).toEqual(['zVERSION']);
  });

  it('çözülemeyen VERSION yanıtı fail-closed protocol hatası', () => {
    expect(() => parseSignatureDate('ClamAV 1.4.2')).toThrow(ScannerUnavailableError);
    expect(() => parseSignatureDate('ClamAV 1.4.2/27500/gecersiz tarih')).toThrow(
      ScannerUnavailableError,
    );
    expect(parseSignatureDate('ClamAV 1.4.2/27500/Tue Oct 14 08:32:11 2026').toISOString()).toBe(
      '2026-10-14T08:32:11.000Z',
    );
  });

  it('parseInstreamReply sonda NUL ve boşlukları yok sayar', () => {
    expect(parseInstreamReply('stream: OK\0\0')).toEqual({ status: 'clean' });
    expect(parseInstreamReply('stream: Eicar-Signature FOUND\n')).toEqual({
      status: 'infected',
      signature: 'Eicar-Signature',
    });
  });
});
