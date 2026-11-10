// @vitest-environment happy-dom
// @tk TK-33
// Ana sayfa sahne motoru (DOM): işaretleme sunucuda çizilir, motor yalnız sınıf/öznitelik/metin
// günceller. Hareket azaltılmış kipte maket son durumuyla, zincir ve taramalar tamamlanmış gösterilir;
// hareketli kipte sahne işaretleri ve demo başlar; söküm her şeyi geri alır.
import { createTranslator } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/tr.json';
import { startHome } from '../src/features/marketing/home/engine/index.ts';
import { buildEngineText } from '../src/features/marketing/home/engine-text.ts';
import { HomeView } from '../src/features/marketing/home/home-view.tsx';
import { makeTx } from '../src/features/marketing/home/text.ts';
import type { Translator } from '../src/features/marketing/translator.ts';

const t = createTranslator({
  locale: 'tr',
  messages,
  namespace: 'marketing',
}) as unknown as Translator;
const text = buildEngineText(makeTx(t));

function mount(): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(
    createElement(HomeView, {
      t,
      appUrl: 'https://app.eda.localhost',
      fontClass: '',
      footer: null,
    }),
  );
  const root = document.getElementById('mk-root');
  if (!root) throw new Error('kök yok');
  return root;
}

const $ = (root: ParentNode, sel: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(sel);
  return el;
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: false, addEventListener: () => undefined }),
    configurable: true,
  });
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Ana sayfa motoru: hareket azaltılmış kip (statik, son durum)', () => {
  it('maket son durumuyla gösterilir: yanıt, doğrulanmış çipler, kaynaklar, süre özeti', () => {
    const root = mount();
    const stop = startHome(root, text, { reduced: true, scripting: true, fine: false });
    expect(root.dataset.stage).toBe('static');
    const device = $(root, '.device');
    expect($(device, '.scene-chat').classList.contains('is-conv')).toBe(true);
    const chips = [...device.querySelectorAll('.c-prose .e-chip')];
    expect(chips.map((c) => c.getAttribute('data-k')).sort()).toEqual(['K1', 'K4']);
    expect(chips.every((c) => c.getAttribute('data-status') === 'verified')).toBe(true);
    expect($(device, '.c-pipe').getAttribute('data-state')).toBe('done');
    expect($(device, '.c-src-count').textContent).toBe('4 kaynak getirildi');
    expect(device.querySelectorAll('.c-prose h3')).toHaveLength(3);
    // Stüdyo ve takvim son durumda: sözcük/alan sayaçları dolu, 16 Ekim seçili.
    expect($(device, '.s-fill').textContent).toBe('3 doldurulacak alan');
    expect(Number(/\d+/.exec($(device, '.s-words').textContent ?? '')?.[0])).toBeGreaterThan(100);
    expect(
      [...device.querySelectorAll('.s-paper .ref')].every((r) => r.classList.contains('done')),
    ).toBe(true);
    expect($(device, '.k-table td[data-d="16"]').classList.contains('sel')).toBe(true);
    expect($(device, '.k-sum-day').textContent).toBe('16 Ekim Cuma');
    stop();
  });

  it('Künye Kilidi zinciri tamamlanmış, kapı anahtarı çalışır, taramalar bitmiş', async () => {
    const root = mount();
    const stop = startHome(root, text, { reduced: true, scripting: true, fine: false });
    const chain = $(root, '.mk-chain');
    expect(chain.querySelectorAll('.mk-node.lit')).toHaveLength(3);
    expect($(chain, '.stamp').classList.contains('ok')).toBe(true);
    expect($(chain, '.kn').textContent).toContain('Yargıtay 9. Hukuk Dairesi');
    const gate = $(root, '.mk-gate');
    const toggle = $(gate, '.mk-gd-toggle') as HTMLInputElement;
    expect(gate.dataset.state).toBe('pending');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(gate.dataset.state).toBe('ok');
    expect($(gate, '.k2 .e-chip').getAttribute('data-status')).toBe('verified');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(gate.dataset.state).toBe('pending');
    expect($(gate, '.k2 .e-chip').getAttribute('data-status')).toBe('pending');
    stop();
  });

  it('kenar menüsü öğesi sahneyi değiştirir (statik kip)', () => {
    const root = mount();
    const stop = startHome(root, text, { reduced: true, scripting: true, fine: false });
    const device = $(root, '.device');
    $(device, '.e-navi[data-go="2"]').click();
    expect(device.dataset.scene).toBe('2');
    expect($(device, '.e-navi[data-go="2"]').classList.contains('on')).toBe(true);
    expect($(device, '.chrome-path').textContent).toBe('/takvim');
    stop();
  });

  it('ince etkileşimler kurulmaz (imleç ışığı, manyetik düğme): CSS değişkeni yazılmaz', () => {
    const root = mount();
    const stop = startHome(root, text, { reduced: true, scripting: true, fine: true });
    const card = $(root, '.mk-card.mk-glow');
    card.dispatchEvent(new Event('pointermove'));
    expect(card.style.getPropertyValue('--mk-x')).toBe('');
    stop();
  });
});

describe('Ana sayfa motoru: hareketli kip', () => {
  it('sahne modu işaretlenir; demo yazmaya başlar ve söküm durumu temizler', async () => {
    const root = mount();
    const stop = startHome(root, text, { reduced: false, scripting: true, fine: true });
    expect(root.dataset.stage).toBe('cine');
    expect(window.__edaHome?.mode).toBe('cine');
    await vi.advanceTimersByTimeAsync(1600 + 500 + 450 + 600);
    const typed = $(root, '.c-composer-home .c-typed').textContent ?? '';
    expect(typed.length).toBeGreaterThan(0);
    expect(text.question.startsWith(typed)).toBe(true);
    stop();
    expect(root.dataset.stage).toBeUndefined();
    expect(window.__edaHome).toBeUndefined();
  });

  it('imleç ışığı ve manyetik düğme CSS değişkeniyle çalışır (satır içi stil özniteliği şablonda yok)', () => {
    const root = mount();
    const stop = startHome(root, text, { reduced: false, scripting: true, fine: true });
    const btn = $(root, '.mk-magnetic');
    btn.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 }));
    expect(btn.style.getPropertyValue('--mk-mx')).not.toBe('');
    btn.dispatchEvent(new Event('pointerleave'));
    expect(btn.style.getPropertyValue('--mk-mx')).toBe('0px');
    stop();
  });

  it('zincir hareketli kipte başta boşaltılır (görünürken baştan oynar)', () => {
    const root = mount();
    const stop = startHome(root, text, { reduced: false, scripting: false, fine: false });
    expect(root.dataset.stage).toBe('static');
    expect($(root, '.mk-chain').querySelectorAll('.mk-node.lit')).toHaveLength(0);
    expect($(root, '.mk-chain .kn').textContent).toBe('');
    stop();
  });
});

declare global {
  interface Window {
    __edaHome?: { mode: string };
  }
}
