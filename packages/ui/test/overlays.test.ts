// @vitest-environment happy-dom
// @tk TK-33
// KK-P05-20 (KK-052-26 bileşen yarısı): AlertDialog varsayılan odak "Vazgeç", dış tıklama kapatmaz,
// Esc vazgeçer; Dialog Esc ile kapanır; modal içinde modal açılmaz (ikinci açılış reddedilir).
// KK-P05-22 Announcer (052 §3, 055 §4.1): iki canlı bölge ilk boyamada boş ve DOM'da; ". " ile
// birleştirme ve `key` tekilleştirme; ConversationView/Message akan kapta `aria-live` yok.
// KK-P05-21 Toast (KK-052-27): hata ve eylemli toast kendiliğinden kapanmaz, bilgi toast'ı süre
// sonunda kapanır, üzerine gelinince süre durur; odak çalınmaz; bölge adı `labels`'tan.
// Metinler sentetik örnektir.
import { act, createElement, type ReactNode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationView, Message } from '../src/ai-elements/index.ts';
import { AlertDialog } from '../src/components/alert-dialog.tsx';
import { type Announce, Announcer, useAnnounce } from '../src/components/announcer.tsx';
import { Dialog } from '../src/components/dialog.tsx';
import { getActiveModalId } from '../src/components/modal-guard.ts';
import { type ToastOptions, ToastProvider, useToast } from '../src/components/toast.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

async function mount(node: ReactNode): Promise<void> {
  await act(async () => root.render(node));
  await settle();
}

/** Base UI odak/konum işleri rAF ve zamanlayıcıyla yürür; kısa bir tur bekle. */
async function settle(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function byText(text: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('button, [role]')].find(
    (el) => el.textContent?.trim() === text,
  );
}

function alertDialog(onOpenChange: (open: boolean) => void, onConfirm = vi.fn()) {
  return createElement(AlertDialog, {
    open: true,
    onOpenChange,
    title: 'Örnek başlık',
    impact: 'Örnek etki',
    cancelLabel: 'Örnek vazgeç',
    destructiveLabel: 'Örnek sil',
    onConfirm,
  });
}

describe('KK-P05-20: AlertDialog', () => {
  it('varsayılan odak "Vazgeç" düğmesindedir; rol alertdialog', async () => {
    await mount(alertDialog(vi.fn()));
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.activeElement?.textContent?.trim()).toBe('Örnek vazgeç');
  });

  it('dış tıklama kapatmaz', async () => {
    const onOpenChange = vi.fn();
    await mount(alertDialog(onOpenChange));
    const outside = document.createElement('button');
    document.body.append(outside);
    await act(async () => {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        outside.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      }
    });
    await settle();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it('Esc vazgeçer; "Vazgeç" kapatır; onay onConfirm çağırır', async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    await mount(alertDialog(onOpenChange, onConfirm));
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();
    await act(async () => byText('Örnek vazgeç')?.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await act(async () => byText('Örnek sil')?.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('KK-P05-20: Dialog ve modal içinde modal', () => {
  it('Dialog Esc ile kapanma ister ve kapat düğmesi adlıdır', async () => {
    const onOpenChange = vi.fn();
    await mount(
      createElement(
        Dialog,
        { open: true, onOpenChange, title: 'Örnek diyalog', labels: { close: 'Örnek kapat' } },
        createElement('input', { 'aria-label': 'Örnek alan' }),
      ),
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Örnek kapat"]')).not.toBeNull();
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    // Dialog, Base UI ayrıntı nesnesini ikinci bağımsız değişken olarak iletir.
    expect(onOpenChange.mock.calls.some((call) => call[0] === false)).toBe(true);
  });

  it('arka plan erişilemez olur ve kapanınca odak açana döner', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Örnek açıcı';
    document.body.prepend(opener);
    opener.focus();
    const dialog = (open: boolean) =>
      createElement(Dialog, {
        open,
        onOpenChange: vi.fn(),
        title: 'Örnek diyalog',
        labels: { close: 'Örnek kapat' },
      });
    await mount(dialog(true));
    const popup = document.querySelector('[role="dialog"]');
    expect(popup?.contains(document.activeElement)).toBe(true);
    // Base UI arka planı `inert` veya `aria-hidden` ile ekran okuyucu ve odaktan çıkarır.
    const hidden =
      opener.closest('[inert], [aria-hidden="true"]') ?? (opener.inert ? opener : null);
    expect(hidden).not.toBeNull();
    await act(async () => root.render(dialog(false)));
    await settle(100);
    expect(document.activeElement).toBe(opener);
  });

  it('bir modal açıkken ikinci modal reddedilir (çizilmez, onOpenChange(false))', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const second = vi.fn();
    await mount(
      createElement(
        'div',
        null,
        createElement(Dialog, {
          open: true,
          onOpenChange: vi.fn(),
          title: 'Örnek birinci',
          labels: { close: 'Örnek kapat' },
        }),
        alertDialog(second),
      ),
    );
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(second).toHaveBeenCalledWith(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('kapanınca modal kilidi bırakılır', async () => {
    await mount(alertDialog(vi.fn()));
    expect(getActiveModalId()).not.toBeNull();
    await act(async () => root.render(null));
    expect(getActiveModalId()).toBeNull();
  });
});

describe('KK-P05-22 (055 §4.1, 052 §3): Announcer', () => {
  let announce: Announce = () => undefined;
  function Grab() {
    const a = useAnnounce();
    useEffect(() => {
      announce = a;
    }, [a]);
    return null;
  }

  function region(politeness: 'polite' | 'assertive'): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-politeness="${politeness}"]`);
    if (el === null) throw new Error('bölge yok');
    return el;
  }

  it('KK-P05-22: iki kalıcı bölge ilk boyamada boş ve DOM’da', async () => {
    await mount(createElement(Announcer, { coalesceMs: 50 }));
    expect(region('polite').getAttribute('aria-live')).toBe('polite');
    expect(region('assertive').getAttribute('aria-live')).toBe('assertive');
    expect(region('polite').textContent).toBe('');
    expect(region('assertive').textContent).toBe('');
    expect(region('polite').getAttribute('role')).toBe('status');
    expect(region('assertive').getAttribute('role')).toBe('alert');
    expect(region('polite').getAttribute('aria-atomic')).toBe('true');
  });

  it('KK-P05-22: pencere içindeki iletiler ". " ile birleşir; aynı key öncekinin yerine geçer', async () => {
    await mount(createElement(Announcer, { coalesceMs: 30 }, createElement(Grab)));
    await act(async () => {
      announce('Örnek bir', { key: 'durum' });
      announce('Örnek iki', { key: 'durum' });
      announce('Örnek üç');
    });
    expect(region('polite').textContent).toBe('');
    await settle(60);
    expect(region('polite').textContent).toBe('Örnek iki. Örnek üç');
    await act(async () => announce('Örnek acil', { politeness: 'assertive' }));
    await settle(60);
    expect(region('assertive').textContent).toBe('Örnek acil');
  });

  it('KK-P05-22: noktalanmış iletiye ikinci nokta eklenmez; boş ileti yok sayılır', async () => {
    await mount(createElement(Announcer, { coalesceMs: 30 }, createElement(Grab)));
    await act(async () => {
      announce('Örnek kopyalandı.');
      announce('  ');
      announce('Örnek sonraki');
    });
    await settle(60);
    expect(region('polite').textContent).toBe('Örnek kopyalandı. Örnek sonraki');
  });

  it('KK-P05-22: ConversationView ve Message akan kapta aria-live taşımaz', async () => {
    await mount(
      createElement(Announcer, {
        coalesceMs: 30,
        children: createElement(ConversationView, {
          label: 'Örnek sohbet',
          labels: { scrollToLatest: 'Örnek en son' },
          children: createElement(Message, {
            from: 'assistant',
            label: 'Örnek yanıt',
            children: 'Örnek akan metin',
          }),
        }),
      }),
    );
    const live = [...document.querySelectorAll('[aria-live]')];
    expect(live.length).toBe(2);
    for (const el of live) expect(el.closest('[data-slot="announcer"]')).not.toBeNull();
    expect(document.querySelector('article[aria-label="Örnek yanıt"]')).not.toBeNull();
  });

  it('KK-P05-22: sağlayıcı yoksa useAnnounce hata verir', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(mount(createElement(Grab))).rejects.toThrow(/Announcer/);
    error.mockRestore();
  });
});

describe('KK-P05-21 (KK-052-27): Toast', () => {
  let show: (o: ToastOptions) => string = () => '';
  function Grab() {
    const t = useToast();
    useEffect(() => {
      show = t.show;
    }, [t]);
    return null;
  }

  async function mountToasts(): Promise<void> {
    await mount(
      createElement(ToastProvider, {
        // Süre gerçek zamanlıdır; paralel test yükünde 20 ms'lik ilk kontrol bu süreyi aşmasın diye geniş tutulur.
        durationMs: 1000,
        labels: { region: 'Örnek bildirimler', close: 'Örnek kapat' },
        children: createElement(Grab),
      }),
    );
  }

  it('KK-P05-21: bölge adı labels’tan gelir (sabit İngilizce ad yok)', async () => {
    await mountToasts();
    const regionEl = document.querySelector('[role="region"]');
    expect(regionEl?.getAttribute('aria-label')).toBe('Örnek bildirimler');
  });

  it('KK-P05-21: bilgi toast’ı süre sonunda kapanır; hata ve eylemli toast kendiliğinden kapanmaz', async () => {
    await mountToasts();
    await act(async () => {
      show({ title: 'Örnek bilgi', tone: 'info' });
      show({ title: 'Örnek hata', tone: 'error' });
      show({
        title: 'Örnek eylemli',
        tone: 'success',
        action: { label: 'Örnek geri al', onAction: () => undefined },
      });
    });
    await settle(20);
    expect(document.body.textContent).toContain('Örnek bilgi');
    expect(document.body.textContent).toContain('Örnek hata');
    expect(document.body.textContent).toContain('Örnek eylemli');
    await settle(1300);
    expect(document.body.textContent).not.toContain('Örnek bilgi');
    expect(document.body.textContent).toContain('Örnek hata');
    expect(document.body.textContent).toContain('Örnek eylemli');
    expect(byText('Örnek geri al')).toBeDefined();
  });

  it('KK-P05-21: fare bölgenin üzerindeyken süre durur, ayrılınca kapanır', async () => {
    await mountToasts();
    await act(async () => {
      show({ title: 'Örnek durdurulan', tone: 'info' });
    });
    await settle(20);
    const regionEl = document.querySelector<HTMLElement>('[role="region"]');
    if (regionEl === null) throw new Error('bölge yok');
    await act(async () => {
      regionEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await settle(1300);
    expect(document.body.textContent).toContain('Örnek durdurulan');
    await act(async () => {
      regionEl.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
      );
    });
    await settle(1300);
    expect(document.body.textContent).not.toContain('Örnek durdurulan');
  });

  it('KK-P05-21: aynı key ikinci toast açmaz; odak çalınmaz', async () => {
    await mountToasts();
    const focused = document.activeElement;
    await act(async () => {
      show({ title: 'Örnek kopya', tone: 'warning', key: 'k1' });
      show({ title: 'Örnek kopya', tone: 'warning', key: 'k1' });
    });
    await settle(20);
    const count = document.body.textContent?.split('Örnek kopya').length ?? 0;
    expect(count - 1).toBe(1);
    expect(document.activeElement).toBe(focused);
  });
});
