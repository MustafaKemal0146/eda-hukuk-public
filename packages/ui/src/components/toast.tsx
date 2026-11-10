'use client';
// Toast (052 §3, §14.1; KK-052-27): Base UI Toast. Bölge `labels.region` adlı polite canlı bölgedir;
// hata toast'ı yüksek öncelikle (`role="alert"`) duyurulur. Hata ve eylemli toast kendiliğinden
// kapanmaz; diğerleri `durationMs` sonra kapanır, fare/odak üzerindeyken süre durur (Base UI).
// Odak çalınmaz; aynı `key` ile gelen ileti yenisini açmaz, mevcut olanı günceller. En çok 3 görünür.
import { Toast as Base } from '@base-ui/react/toast';
import { type ReactNode, useMemo } from 'react';
import { Icon, type IconName } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export const TOAST_TONES = ['success', 'info', 'warning', 'error'] as const;
export type ToastTone = (typeof TOAST_TONES)[number];

const TONE_ICON: Record<ToastTone, IconName> = {
  success: 'tone.success',
  info: 'tone.info',
  warning: 'tone.warning',
  error: 'tone.danger',
};

export type ToastOptions = {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Eylemli toast ("Geri al"); varsa kendiliğinden kapanmaz. */
  action?: { label: string; onAction: () => void };
  /** Tekilleştirme anahtarı: aynı anahtar mevcut toast'ı günceller. */
  key?: string;
};

export type ToastProviderProps = {
  /** Otomatik kapanma süresi (çağıran `ui.toastDurationMs` verir). */
  durationMs: number;
  labels: { region: string; close: string };
  limit?: number;
  children: ReactNode;
};

export function ToastProvider({ durationMs, labels, limit = 3, children }: ToastProviderProps) {
  return (
    <Base.Provider timeout={durationMs} limit={limit}>
      {children}
      <Base.Portal>
        <Base.Viewport
          aria-label={labels.region}
          className="fixed right-4 bottom-4 z-toast flex w-dialog max-w-sm flex-col-reverse gap-2 outline-none"
        >
          <ToastList closeLabel={labels.close} />
        </Base.Viewport>
      </Base.Portal>
    </Base.Provider>
  );
}

// Koyu (inverse) yüzey üstündeki denetim: kendi sınıfları (açık tema düğme sınıflarıyla çakışmaz).
const INVERSE_ACTION =
  'mt-2 inline-flex min-h-control-sm items-center justify-center rounded-md border border-inverse-fg px-2.5 ' +
  'text-body-sm font-medium text-inverse-fg hover:underline focus-visible:focus-ring pointer-coarse:min-h-11';
const INVERSE_CLOSE =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-inverse-fg ' +
  'hover:border-inverse-fg focus-visible:focus-ring pointer-coarse:size-11';

type ToastData = { tone: ToastTone; actionLabel?: string };

function ToastList({ closeLabel }: { closeLabel: string }) {
  const { toasts } = Base.useToastManager();
  return toasts.map((toast) => {
    const data = toast.data as ToastData | undefined;
    const tone = data?.tone ?? 'info';
    return (
      <Base.Root
        key={toast.id}
        toast={toast}
        className={cn(
          'w-full rounded-lg border border-inverse-bg bg-inverse-bg text-inverse-fg shadow-2',
          'focus-visible:focus-ring data-[limited]:hidden',
        )}
      >
        <Base.Content className="flex items-start gap-3 px-3.5 py-3">
          <Icon icon={TONE_ICON[tone]} size="sm" className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <Base.Title className="text-body-sm font-medium" />
            <Base.Description className="mt-0.5 text-body-sm" />
            {data?.actionLabel && <Base.Action className={INVERSE_ACTION} />}
          </div>
          <Base.Close aria-label={closeLabel} className={INVERSE_CLOSE}>
            <Icon icon="action.close" size="sm" />
          </Base.Close>
        </Base.Content>
      </Base.Root>
    );
  });
}

/** Toast kuyruğu kancası: `show` toast kimliği döner; `close` kapatır. */
export function useToast(): {
  show: (options: ToastOptions) => string;
  close: (id: string) => void;
} {
  const manager = Base.useToastManager();
  return useMemo(
    () => ({
      show: ({ title, description, tone = 'info', action, key }: ToastOptions) => {
        const sticky = tone === 'error' || action !== undefined;
        const data: ToastData =
          action === undefined ? { tone } : { tone, actionLabel: action.label };
        return manager.add({
          ...(key === undefined ? {} : { id: key }),
          title,
          description,
          type: tone,
          priority: tone === 'error' ? 'high' : 'low',
          ...(sticky ? { timeout: 0 } : {}),
          ...(action === undefined
            ? {}
            : { actionProps: { children: action.label, onClick: action.onAction } }),
          data,
        });
      },
      close: (id: string) => manager.close(id),
    }),
    [manager],
  );
}
