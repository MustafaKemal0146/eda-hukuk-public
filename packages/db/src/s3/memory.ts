// Bellek içi nesne deposu: YALNIZ testler içindir (`@eda/db/testing` ile dışa açılır). Gerçek adaptörle
// aynı sözleşme: çok parçalı yazım, aralıklı okuma, kopya, yoksa `not_found`. Hata enjeksiyonu için
// `failNext`/`unavailable` bayrakları vardır.
import { Readable } from 'node:stream';
import { type ObjectRange, type ObjectStore, ObjectStoreError } from './port.ts';

export interface MemoryObjectStore extends ObjectStore {
  /** Anahtar -> bayt (testler şifreli nesneyi doğrudan inceler/bozar). */
  readonly objects: Map<string, Buffer>;
  /** `true` iken tüm işlemler `unavailable` verir. */
  unavailable: boolean;
  /** Bir sonraki `put` kaynağı bu kadar bayt okunduktan sonra `unavailable` ile kopar. */
  failPutAfterBytes: number | null;
}

export function createMemoryObjectStore(): MemoryObjectStore {
  const objects = new Map<string, Buffer>();
  const store: MemoryObjectStore = {
    objects,
    unavailable: false,
    failPutAfterBytes: null,
    async put(key, source) {
      if (store.unavailable) throw new ObjectStoreError('unavailable');
      const parts: Buffer[] = [];
      let size = 0;
      const limit = store.failPutAfterBytes;
      store.failPutAfterBytes = null;
      for await (const chunk of source) {
        parts.push(Buffer.from(chunk));
        size += chunk.length;
        if (limit !== null && size >= limit) throw new ObjectStoreError('unavailable');
      }
      objects.set(key, Buffer.concat(parts));
      return { size };
    },
    async get(key, range?: ObjectRange) {
      if (store.unavailable) throw new ObjectStoreError('unavailable');
      const obj = objects.get(key);
      if (obj === undefined) throw new ObjectStoreError('not_found');
      const body = range === undefined ? obj : obj.subarray(range.start, range.end + 1);
      // Gerçek depo gibi küçük parçalarla akıtır.
      return Readable.from(
        (function* () {
          for (let i = 0; i < body.length; i += 16_384) yield body.subarray(i, i + 16_384);
        })(),
      );
    },
    async head(key) {
      if (store.unavailable) throw new ObjectStoreError('unavailable');
      const obj = objects.get(key);
      return obj === undefined ? null : { size: obj.length };
    },
    async delete(key) {
      if (store.unavailable) throw new ObjectStoreError('unavailable');
      objects.delete(key);
    },
    async copy(fromKey, toKey) {
      if (store.unavailable) throw new ObjectStoreError('unavailable');
      const obj = objects.get(fromKey);
      if (obj === undefined) throw new ObjectStoreError('not_found');
      objects.set(toKey, Buffer.from(obj));
    },
  };
  return store;
}
