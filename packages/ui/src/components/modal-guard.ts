'use client';
// Modal içinde modal YOK (052 §14.2, KK-052-26): aynı anda tek modal katman açık olabilir.
// İkinci açılış reddedilir (çizilmez, `onOpenChange(false)` ile çağırana bildirilir) ve konsola
// geliştirici uyarısı yazılır (programlama hatasıdır; kullanıcıya metin gösterilmez).
// Dialog, AlertDialog ve Sheet bu kancayı paylaşır.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

let activeModal: string | null = null;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Şu an açık modal kimliği (test ve tanı amaçlı). */
export function getActiveModalId(): string | null {
  return activeModal;
}

/**
 * Modalın gerçekten açılıp açılamayacağını döner. Başka bir modal açıkken `false` döner ve
 * `onReject` bir kez çağrılır.
 */
export function useModalGuard(open: boolean, onReject: () => void): boolean {
  const id = useId();
  const rejectRef = useRef(onReject);
  rejectRef.current = onReject;
  const [rejected, setRejected] = useState(false);
  const blocked = open && activeModal !== null && activeModal !== id;

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setRejected(false);
      return;
    }
    if (activeModal !== null && activeModal !== id) {
      setRejected(true);
      // biome-ignore lint/suspicious/noConsole: P05.10 ikinci modal reddi geliştiriciye bildirilir (programlama hatası).
      console.warn('@eda/ui: modal içinde modal açılamaz; ikinci açılış reddedildi.');
      rejectRef.current();
      return;
    }
    activeModal = id;
    return () => {
      if (activeModal === id) activeModal = null;
    };
  }, [open, id]);

  return open && !blocked && !rejected;
}
