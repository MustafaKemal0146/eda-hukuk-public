// Aday (026 §6.1): her algılayıcı NFC ofsetinde aday üretir; öncelik tablosu ve adım bütçesi.
import { KvkkMaskingError } from '../errors.ts';
import type { Confidence, SpanSource, Tip } from '../types.ts';

export interface Candidate {
  start: number;
  end: number;
  tip: Tip;
  source: SpanSource;
  confidence: Confidence;
  priority: number;
  /** Açık kimlik (sözlük, öğrenilen, canonMap). Yoksa canon(tip, identitySurface ?? yüzey). */
  identity?: string;
  identitySurface?: string;
  /** Açık görünen değer (sözlük kaydı). */
  display?: string;
  /** Serbest görünen değer adayı (ör. ters sıralı adın düz biçimi). */
  displaySurface?: string;
  ambiguous?: boolean;
  weak?: boolean;
  /** Kesmeli ek (kesme dahil) veya kesmesiz ek; token ardında yazıldığı gibi kalır. */
  suffix?: { start: number; end: number };
  /** Öğrenilen yüzey kümesine kaynaklık eden tam biçim (026 §6.7). */
  learnable?: { words: string[]; core?: string };
}

/** 026 §6.1 öncelik tablosu. */
export const PRIORITY = {
  dict: 100,
  learned: 95,
  IBAN: 90,
  EPOSTA: 85,
  TCKN: 80,
  TEL: 70,
  VKN: 60,
  VKN_CONTEXT: 75,
  PLAKA: 55,
  TARIH_DOGUM: 50,
  SAGLIK: 45,
  SIRKET: 40,
  ADRES: 30,
  KISI: 20,
} as const;

/** Deterministik adım bütçesi (026 §10.3): pencere uzunlukları toplamı <= faktör x karakter. */
export class StepBudget {
  #used = 0;
  readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  charge(n: number): void {
    this.#used += n;
    if (this.#used > this.limit) throw new KvkkMaskingError('BUDGET_EXCEEDED');
  }

  get used(): number {
    return this.#used;
  }
}
