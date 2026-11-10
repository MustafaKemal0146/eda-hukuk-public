'use client';
// CSP uyumu (061 §2.3): sunucuda yazılan `style=""` özniteliği nonce ile açılamaz. Dinamik CSS
// değişkeni, hidrasyondan sonra CSSOM ile (`setProperty`) verilir; CSSOM yazımı CSP'ye takılmaz.
import { type RefObject, useLayoutEffect } from 'react';

export function useCssVar(ref: RefObject<HTMLElement | null>, name: string, value: string): void {
  useLayoutEffect(() => {
    ref.current?.style.setProperty(name, value);
  }, [ref, name, value]);
}
