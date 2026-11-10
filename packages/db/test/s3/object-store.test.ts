// @tk TK-06
// KK-P20-4 (KK-033-20): nesne deposu adaptörü (sahte S3 istemcisi) ve bellek içi sahte depo: tek/çok
// parçalı yazım, hata hâlinde iptal, aralıklı okuma, kopya, not_found eşlemesi.
import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { createObjectStore } from '../../src/s3/client.ts';
import { createMemoryObjectStore } from '../../src/s3/memory.ts';
import { ObjectStoreError } from '../../src/s3/port.ts';

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };

function fakeClient(handler: (cmd: Cmd, calls: Cmd[]) => unknown): {
  client: S3Client;
  calls: Cmd[];
} {
  const calls: Cmd[] = [];
  const client = {
    send: async (cmd: Cmd) => {
      calls.push(cmd);
      return handler(cmd, calls);
    },
  } as unknown as S3Client;
  return { client, calls };
}

async function* chunks(...sizes: number[]): AsyncGenerator<Buffer> {
  for (const n of sizes) yield Buffer.alloc(n, 1);
}

const names = (calls: Cmd[]): string[] => calls.map((c) => c.constructor.name);

describe('KK-P20-4: gerçek adaptör (sahte S3 istemcisi)', () => {
  it('parça boyutundan küçük gövde tek PutObject ile yazılır', async () => {
    const { client, calls } = fakeClient(() => ({}));
    const store = createObjectStore(client, 'eda-files', { partBytes: 100 });
    const r = await store.put('org/a/inbox/b', chunks(40, 40));
    expect(r.size).toBe(80);
    expect(names(calls)).toEqual(['PutObjectCommand']);
    expect(calls[0]?.input.Bucket).toBe('eda-files');
    expect(Buffer.byteLength(calls[0]?.input.Body as Buffer)).toBe(80);
  });

  it('büyük gövde çok parçalı yazılır; son parça kalan bayttır', async () => {
    const { client, calls } = fakeClient((cmd) =>
      cmd.constructor.name === 'CreateMultipartUploadCommand'
        ? { UploadId: 'u1' }
        : { ETag: '"e"' },
    );
    const store = createObjectStore(client, 'eda-files', { partBytes: 100 });
    const r = await store.put('k', chunks(60, 60, 60, 60, 60));
    expect(r.size).toBe(300);
    expect(names(calls)).toEqual([
      'CreateMultipartUploadCommand',
      'UploadPartCommand',
      'UploadPartCommand',
      'UploadPartCommand',
      'CompleteMultipartUploadCommand',
    ]);
    const sizes = calls
      .filter((c) => c.constructor.name === 'UploadPartCommand')
      .map((c) => (c.input.Body as Buffer).length);
    expect(sizes).toEqual([100, 100, 100]);
  });

  it('kaynak akış kesilirse çok parçalı yükleme iptal edilir ve kaynak hatası aynen döner', async () => {
    const { client, calls } = fakeClient((cmd) =>
      cmd.constructor.name === 'CreateMultipartUploadCommand'
        ? { UploadId: 'u1' }
        : { ETag: '"e"' },
    );
    const store = createObjectStore(client, 'eda-files', { partBytes: 100 });
    async function* broken(): AsyncGenerator<Buffer> {
      yield Buffer.alloc(150);
      throw new Error('istemci koptu');
    }
    await expect(store.put('k', broken())).rejects.toThrow('istemci koptu');
    expect(names(calls)).toContain('AbortMultipartUploadCommand');
    expect(names(calls)).not.toContain('CompleteMultipartUploadCommand');
  });

  it('depo hatası iç ayrıntı taşımaz; 404 not_found, head 404 null', async () => {
    const notFound = Object.assign(new Error('NoSuchKey: gizli-anahtar'), {
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    });
    const { client } = fakeClient(() => {
      throw notFound;
    });
    const store = createObjectStore(client, 'eda-files');
    await expect(store.get('k')).rejects.toMatchObject({ kind: 'not_found' });
    expect(await store.head('k')).toBeNull();
    await expect(store.delete('k')).resolves.toBeUndefined();
    const down = fakeClient(() => {
      throw Object.assign(new Error('ECONNREFUSED 10.0.0.5 gizli'), { name: 'Error' });
    });
    const err = await createObjectStore(down.client, 'b')
      .put('k', chunks(5))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ObjectStoreError);
    expect((err as ObjectStoreError).kind).toBe('unavailable');
    expect((err as Error).message).not.toContain('10.0.0.5');
  });

  it('aralıklı okuma Range başlığı üretir; kopya kaynağı kova önekli', async () => {
    const { client, calls } = fakeClient((cmd) =>
      cmd.constructor.name === 'GetObjectCommand'
        ? { Body: Readable.from([Buffer.from('x')]) }
        : {},
    );
    const store = createObjectStore(client, 'eda-files');
    await store.get('k', { start: 24, end: 65_575 });
    expect(calls[0]?.input.Range).toBe('bytes=24-65575');
    await store.copy('org/a/inbox/f', 'org/a/case/c/f');
    expect(calls[1]?.input.CopySource).toBe('eda-files/org/a/inbox/f');
    expect(calls[1]?.input.Key).toBe('org/a/case/c/f');
  });
});

describe('KK-P20-4: bellek içi sahte depo gerçek sözleşmeyi taşır', () => {
  it('yaz/oku/aralık/kopya/sil ve hata enjeksiyonu', async () => {
    const mem = createMemoryObjectStore();
    await mem.put('a', chunks(10, 10));
    expect((await mem.head('a'))?.size).toBe(20);
    const part: Buffer[] = [];
    for await (const c of await mem.get('a', { start: 5, end: 9 })) part.push(c as Buffer);
    expect(Buffer.concat(part).length).toBe(5);
    await mem.copy('a', 'b');
    expect(mem.objects.has('b')).toBe(true);
    await mem.delete('a');
    expect(await mem.head('a')).toBeNull();
    await expect(mem.get('a')).rejects.toMatchObject({ kind: 'not_found' });
    mem.failPutAfterBytes = 5;
    await expect(mem.put('c', chunks(10))).rejects.toMatchObject({ kind: 'unavailable' });
    expect(mem.objects.has('c')).toBe(false);
    mem.unavailable = true;
    await expect(mem.head('b')).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
