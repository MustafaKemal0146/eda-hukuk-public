// #56: sohbet karşılama başlığı günün saatine göre değişir. Saf dilim/seçim fonksiyonları ve
// tr.json karşılama metinleri (her dilimde 3 cümle) doğrulanır.
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import {
  GREETING_VARIANTS,
  type GreetingPeriod,
  greetingPeriod,
  greetingVariant,
} from '../src/features/chat/greeting.ts';

const PERIODS: readonly GreetingPeriod[] = ['morning', 'afternoon', 'evening', 'night'];

// Metin anahtarları next-intl tip denetiminden geçsin diye birebir yazılır.
const KEYS = {
  morning: ['chat.greetings.morning.0', 'chat.greetings.morning.1', 'chat.greetings.morning.2'],
  afternoon: [
    'chat.greetings.afternoon.0',
    'chat.greetings.afternoon.1',
    'chat.greetings.afternoon.2',
  ],
  evening: ['chat.greetings.evening.0', 'chat.greetings.evening.1', 'chat.greetings.evening.2'],
  night: ['chat.greetings.night.0', 'chat.greetings.night.1', 'chat.greetings.night.2'],
} as const;

describe('#56: günün saatine göre karşılama', () => {
  it('saat dilimleri sınır değerlerinde doğru belirlenir', () => {
    const rows: readonly (readonly [number, GreetingPeriod])[] = [
      [4, 'night'],
      [5, 'morning'],
      [11, 'morning'],
      [12, 'afternoon'],
      [17, 'afternoon'],
      [18, 'evening'],
      [22, 'evening'],
      [23, 'night'],
      [0, 'night'],
    ];
    for (const [hour, period] of rows) expect(greetingPeriod(hour), String(hour)).toBe(period);
  });

  it('seçim daima 0, 1 veya 2 aralığında ve aynı gün için aynıdır', () => {
    for (let day = 1; day <= 31; day += 1) {
      const v = greetingVariant(2026, 10, day);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(GREETING_VARIANTS);
      expect(greetingVariant(2026, 10, day)).toBe(v);
    }
  });

  it('her dilimde tam üç boş olmayan cümle var', () => {
    for (const period of PERIODS) {
      const list = messages.chat.greetings[period];
      expect(list, period).toHaveLength(GREETING_VARIANTS);
      for (const line of list) expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it('karşılama anahtarları çözülebilir (t metni verir)', () => {
    const t = createTranslator({ locale: 'tr', messages, timeZone: 'Europe/Istanbul' });
    for (const period of PERIODS) {
      const list = messages.chat.greetings[period];
      KEYS[period].forEach((key, i) => {
        expect(t(key), key).toBe(list[i]);
      });
    }
  });
});
