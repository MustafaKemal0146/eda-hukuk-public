// @tk TK-33
// Ana sayfa sahne çizelgesi (GSAP yerine bağımsız): iz örnekleme, kaydırma ilerlemesi, yumuşatma ve
// sahne/adım eşlemesi saf işlevlerdir; hareket kodu bunların üzerine kurulur.
import { describe, expect, it } from 'vitest';
import {
  clamp,
  EASE,
  type Seg,
  sample,
  sceneAt,
  scrollProgress,
  smooth,
  stepAt,
} from '../src/features/marketing/home/engine/timeline.ts';

const seg = (start: number, dur: number, from: number, to: number): Seg => ({
  start,
  dur,
  from,
  to,
  ease: EASE.linear,
});

describe('çizelge izi', () => {
  it('parçadan önce ilk from, sonda son to; ortada doğrusal', () => {
    const track = [seg(1, 2, 0, 10)];
    expect(sample(track, 0)).toBe(0);
    expect(sample(track, 1)).toBe(0);
    expect(sample(track, 2)).toBeCloseTo(5);
    expect(sample(track, 3)).toBe(10);
    expect(sample(track, 9)).toBe(10);
  });

  it('ardışık parçalar arasında önceki to korunur (gir, bekle, çık)', () => {
    const track = [seg(0, 1, 0, 1), seg(3, 1, 1, 0)];
    expect(sample(track, 2)).toBe(1);
    expect(sample(track, 3.5)).toBeCloseTo(0.5);
    expect(sample(track, 5)).toBe(0);
  });

  it('işlev değerleri her örneklemede yeniden okunur (yeniden boyutlama)', () => {
    let hero = 100;
    const track: Seg[] = [{ start: 0, dur: 1, from: () => hero, to: 0, ease: EASE.linear }];
    expect(sample(track, 0)).toBe(100);
    hero = 40;
    expect(sample(track, 0)).toBe(40);
  });

  it('yumuşatmalar 0..1 aralığında ve uçlarda tam', () => {
    for (const fn of Object.values(EASE)) {
      expect(fn(0)).toBeCloseTo(0);
      expect(fn(1)).toBeCloseTo(1);
    }
    expect(EASE.power2InOut(0.5)).toBeCloseTo(0.5);
    expect(EASE.power2Out(0.5)).toBeGreaterThan(0.5);
    expect(EASE.power1In(0.5)).toBeLessThan(0.5);
  });
});

describe('kaydırma ilerlemesi ve yumuşatma', () => {
  it('kapsayıcı üstü görünüm üstüne gelince 0, altı görünüm altına gelince 1', () => {
    expect(scrollProgress(100, 5000, 800)).toBe(0);
    expect(scrollProgress(0, 5000, 800)).toBe(0);
    expect(scrollProgress(-2100, 5000, 800)).toBeCloseTo(0.5);
    expect(scrollProgress(-4200, 5000, 800)).toBe(1);
    expect(scrollProgress(-9000, 5000, 800)).toBe(1);
    expect(scrollProgress(-10, 700, 800)).toBe(0);
  });

  it('oynatma başı hedefe yaklaşır, aşmaz', () => {
    let cur = 0;
    for (let i = 0; i < 60; i++) cur = smooth(cur, 5, 1 / 60, 0.23);
    expect(cur).toBeGreaterThan(4);
    expect(cur).toBeLessThan(5);
    expect(smooth(2, 2, 0.1, 0.23)).toBe(2);
    expect(clamp(7, 0, 5)).toBe(5);
  });

  it('sahne eşikleri: sohbet < 2,1 ≤ stüdyo < 3,5 ≤ takvim; adım 0..3', () => {
    expect(sceneAt(0)).toBe(0);
    expect(sceneAt(2.09)).toBe(0);
    expect(sceneAt(2.1)).toBe(1);
    expect(sceneAt(3.49)).toBe(1);
    expect(sceneAt(3.5)).toBe(2);
    expect(sceneAt(5)).toBe(2);
    expect([0, 0.85, 1.2, 1.5, 1.8, 4].map(stepAt)).toEqual([0, 0, 1, 2, 3, 3]);
  });
});
