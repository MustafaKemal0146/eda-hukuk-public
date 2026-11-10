// Sınıf birleştirme: yalnız koşullu sınıf seçimi içindir. Dinamik sınıf adı üretmek (bg-${x}) yasaktır (051 §15).
import { type ClassValue, clsx } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
