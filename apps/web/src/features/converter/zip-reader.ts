// ZIP okuyucu (bağımlılıksız): merkezi dizinden girdileri okur; "store" ve "deflate" yöntemlerini
// destekler (`DecompressionStream('deflate-raw')`). UDF ve DOCX paketleri için yeterlidir; şifreli,
// çok parçalı ve ZIP64 arşivler reddedilir. Tüm işlem tarayıcıdadır, dosya sunucuya gitmez.

export class ZipError extends Error {}

/** Açılmış bir girdinin üst sınırı: zip bombası koruması (50 MiB). */
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;

type CentralEntry = {
  name: string;
  method: number;
  compSize: number;
  size: number;
  offset: number;
};

const dec = new TextDecoder('utf-8');

function findEnd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new ZipError('not-zip');
}

function centralDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new ZipError('not-zip');
  const end = findEnd(view);
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const out: CentralEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50)
      throw new ZipError('bad-zip');
    const flags = view.getUint16(p + 8, true);
    if (flags & 1) throw new ZipError('encrypted');
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    out.push({
      method: view.getUint16(p + 10, true),
      compSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      offset: view.getUint32(p + 42, true),
      name: dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_ENTRY_BYTES) {
      await reader.cancel();
      throw new ZipError('too-large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Arşivdeki dosya adlarını verir. */
export function zipNames(bytes: Uint8Array): string[] {
  return centralDirectory(bytes).map((e) => e.name);
}

/** Adı verilen girdiyi açar; yoksa `null`. */
export async function zipRead(bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
  const entry = centralDirectory(bytes).find((e) => e.name === name);
  if (!entry) return null;
  if (entry.size > MAX_ENTRY_BYTES) throw new ZipError('too-large');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = entry.offset;
  if (p + 30 > bytes.length || view.getUint32(p, true) !== 0x04034b50)
    throw new ZipError('bad-zip');
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  const raw = bytes.subarray(start, start + entry.compSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw);
  throw new ZipError('unsupported-method');
}
