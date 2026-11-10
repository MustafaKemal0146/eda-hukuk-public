'use client';
// Ana sayfa hareket katmanı: görünür bir şey çizmez; sunucuda çizilen `.mk` işaretlemesine sahne
// motorunu bağlar (kaydırmalı sahne dönüşümü, demo, zincir, kapı, ince etkileşimler). Animasyon
// kodu yalnız bu istemci sınırının arkasındadır; sayfa sunucu bileşenidir.
import { useEffect } from 'react';
import { startHome } from './engine/index.ts';
import type { EngineText } from './engine/types.ts';

export function HomeEffects({ rootId, text }: { rootId: string; text: EngineText }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return undefined;
    return startHome(root, text);
  }, [rootId, text]);
  return null;
}
