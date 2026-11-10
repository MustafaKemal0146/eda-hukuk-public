// Sahne motoru ortak yardımcıları. Motor yalnız `.mk` kökü altında çalışır; DOM okuma/yazma burada
// toplanır. Stiller CSSOM ile (`element.style.x = ...`) yazılır: CSP `style-src-attr` bunu engellemez.

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Zorunlu öğe: işaretleme ile motor arasındaki sözleşme bozulursa açık hata verir. */
export function must<T extends Element>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Ana sayfa motoru: "${sel}" öğesi yok`);
  return el;
}

export const all = <T extends Element>(root: ParentNode, sel: string): T[] =>
  Array.from(root.querySelectorAll<T>(sel));

/** Metni harf harf yazar; `alive` false dönerse (yeni oynatma başladı) sessizce durur. */
export function typeText(
  el: HTMLElement,
  text: string,
  speed: number,
  alive: () => boolean = () => true,
): Promise<void> {
  el.classList.add('typing');
  return new Promise((resolve) => {
    let i = 0;
    const step = (): void => {
      if (!alive()) {
        el.classList.remove('typing');
        resolve();
        return;
      }
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        el.classList.remove('typing');
        resolve();
        return;
      }
      setTimeout(step, speed);
    };
    step();
  });
}

/** Görünürlük ve saydamlık birlikte (GSAP `autoAlpha` karşılığı). */
export function setAlpha(el: HTMLElement, alpha: number): void {
  el.style.opacity = String(alpha);
  el.style.visibility = alpha <= 0.001 ? 'hidden' : 'inherit';
}
