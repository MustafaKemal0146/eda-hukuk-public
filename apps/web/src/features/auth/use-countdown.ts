'use client';
import { useCallback, useEffect, useState } from 'react';

/** Saniye cinsinden geri sayım; `start(n)` ile başlar, 0'a inince durur (canlı bölgeye yazılmaz). */
export function useCountdown(): { left: number; start: (seconds: number) => void } {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const start = useCallback((s: number) => setLeft(Math.max(0, Math.ceil(s))), []);
  return { left, start };
}
