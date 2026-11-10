// Eşzamanlı yükleme sınırları (033 §6.1 #6): kullanıcı başına `upload.maxConcurrentPerUser`, süreç
// genelinde `upload.maxConcurrentApi`. Süreç içi sayaçtır (tek api çoğaltması; çoğaltma eklenirse
// Valkey `eda:rl:` sayacına taşınır). Aşımda 429 `QUOTA_CONCURRENCY_LIMIT`.
import { AppError } from '@eda/contracts/errors';

export interface UploadSlots {
  /** Slot alır; dönen işlev bırakır (idempotent). */
  acquire(userId: string): () => void;
}

export function createUploadSlots(limits: { perUser: number; api: number }): UploadSlots {
  const perUser = new Map<string, number>();
  let total = 0;
  return {
    acquire(userId) {
      const mine = perUser.get(userId) ?? 0;
      if (mine >= limits.perUser || total >= limits.api) {
        throw new AppError('QUOTA_CONCURRENCY_LIMIT', {
          reason: 'upload',
          meta: { limit: mine >= limits.perUser ? limits.perUser : limits.api },
        });
      }
      perUser.set(userId, mine + 1);
      total += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        total -= 1;
        const left = (perUser.get(userId) ?? 1) - 1;
        if (left <= 0) perUser.delete(userId);
        else perUser.set(userId, left);
      };
    },
  };
}
