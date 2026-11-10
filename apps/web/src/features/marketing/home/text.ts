// Tanıtım ana sayfası metin erişimi: yalnız `marketing` kataloğu (tr.json). Çeviriler ICU çözümlemesi
// olmadan ham okunur (kesme işareti, köşeli parantez ve [K#] etiketleri olduğu gibi kalır);
// vurgulu sözcük `*sözcük*` işaretiyle yazılır ve `Emph` ile tek `<em>` öğesine çizilir.
import type { Translator } from '../translator.ts';

export type Tx = {
  /** Düz metin. */
  s: (key: string) => string;
  /** Dizi veya nesne (katalogdaki ham değer). */
  a: <T>(key: string) => readonly T[];
  o: <T>(key: string) => T;
};

export function makeTx(t: Translator): Tx {
  return {
    s: (key) => String(t.raw(key)),
    a: <T>(key: string) => t.raw(key) as readonly T[],
    o: <T>(key: string) => t.raw(key) as T,
  };
}

/** `{count}` yer tutucusunu doldurur (ICU değil; yalnız bu sayfanın sayaç metinleri). */
export function fill(template: string, count: number): string {
  return template.replace('{count}', String(count));
}
