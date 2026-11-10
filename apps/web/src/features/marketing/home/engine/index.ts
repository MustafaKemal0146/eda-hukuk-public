// Ana sayfa sahne motoru girişi: işaretleme sunucuda çizilir; bu işlev `.mk` köküne bağlanır, hareket
// kipini seçer (sahne modu veya statik) ve bileşenleri başlatır. Dönen işlev her şeyi söker
// (React Strict Mode çift çalıştırması ve sayfa değişimi için).
import { createMock } from './mock.ts';
import { createSections } from './sections.ts';
import { createStage } from './stage.ts';
import type { EngineText } from './types.ts';

export type HomeEngineOptions = {
  /** Test ve karşılaştırma için kipi zorla; verilmezse ortam sorgulanır. */
  reduced?: boolean;
  scripting?: boolean;
  fine?: boolean;
};

const mq = (q: string): boolean => window.matchMedia(q).matches;

export function startHome(
  root: HTMLElement,
  text: EngineText,
  o: HomeEngineOptions = {},
): () => void {
  const reduced = o.reduced ?? mq('(prefers-reduced-motion: reduce)');
  // Sahne düzeni CSS'te `(scripting: enabled)` ile açılır; aynı koşul burada da aranır ki ikisi uyuşsun.
  const scripting = o.scripting ?? mq('(scripting: enabled)');
  const fine = o.fine ?? mq('(hover: hover) and (pointer: fine)');
  const cine = !reduced && scripting;
  const mock = createMock(root, text, { reduced });
  const stage = createStage(root, mock, { cine, reduced });
  const sections = createSections(root, { reduced, fine });
  // Hata ayıklama ve görsel karşılaştırma için (yan etkisiz).
  const probe = {
    setScene: mock.setScene,
    setFinal: mock.setFinal,
    run: mock.run,
    mode: stage.mode,
  };
  (window as unknown as { __edaHome?: typeof probe }).__edaHome = probe;
  return () => {
    sections.destroy();
    stage.destroy();
    mock.destroy();
    delete root.dataset.stage;
    delete (window as unknown as { __edaHome?: typeof probe }).__edaHome;
  };
}
