// @tk TK-28
// Kullanım ve limitler (modül): İstanbul takvim günü, aralık doğrulaması, pay hesabı, limit girdisi
// ve menü kaydı. Saf yardımcılar; tarayıcı veya ağ gerekmez.
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json' with { type: 'json' };
import { navFor } from '../src/features/shell/nav.ts';
import {
  addDays,
  istanbulDay,
  MAX_RANGE_DAYS,
  microToUsd,
  parseLimitValue,
  presetRange,
  rangeProblem,
  share,
  UUID_RE,
} from '../src/features/usage/usage-model.ts';

describe('KK-USAGE-W1: İstanbul gün sınırı ve aralık', () => {
  it('UTC gece yarısına yakın an İstanbul takvim gününe göre çözülür', () => {
    // 2026-03-10 21:30 UTC = 2026-03-11 00:30 İstanbul (UTC+3)
    expect(istanbulDay(new Date('2026-03-10T21:30:00Z'))).toBe('2026-03-11');
    expect(istanbulDay(new Date('2026-03-10T20:59:59Z'))).toBe('2026-03-10');
  });

  it('ön ayar aralığı bugün dahil N gündür; gün aritmetiği ay ve yıl sınırını geçer', () => {
    const now = new Date('2026-03-01T10:00:00Z');
    expect(presetRange(7, now)).toEqual({ from: '2026-02-23', to: '2026-03-01' });
    expect(presetRange(90, now).from).toBe(addDays('2026-03-01', -89));
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('en çok 92 gün farkı (93 gün) kabul edilir; fazlası, ters sıra ve bozuk tarih reddedilir', () => {
    expect(MAX_RANGE_DAYS).toBe(92);
    expect(rangeProblem('2026-01-01', addDays('2026-01-01', 92))).toBeNull();
    expect(rangeProblem('2026-01-01', addDays('2026-01-01', 93))).toBe('tooLong');
    expect(rangeProblem('2026-02-02', '2026-02-01')).toBe('order');
    expect(rangeProblem('', '2026-02-01')).toBe('invalid');
    expect(rangeProblem('2026-13-45', '2026-14-01')).toBe('invalid');
    // 90 günlük ön ayar sunucu sınırı içindedir.
    const r = presetRange(90, new Date('2026-06-15T12:00:00Z'));
    expect(rangeProblem(r.from, r.to)).toBeNull();
  });
});

describe('KK-USAGE-W2: tutar, pay ve limit girdisi', () => {
  it('micro-USD dolara çevrilir; pay sıfır bölende 0', () => {
    expect(microToUsd(2_500_000)).toBe(2.5);
    expect(share(25, 100)).toBe(0.25);
    expect(share(5, 0)).toBe(0);
  });

  it('limit değeri yalnız pozitif tam sayıdır; büro kimliği UUID olmalı', () => {
    expect(parseLimitValue(' 12 ')).toBe(12);
    for (const bad of ['', '0', '-3', '1.5', '1e3', 'abc', '12345678901234567890']) {
      expect(parseLimitValue(bad), bad).toBeNull();
    }
    expect(UUID_RE.test('0198a2b4-1c2d-7e3f-8a9b-0c1d2e3f4a5b')).toBe(true);
    expect(UUID_RE.test('0198a2b4')).toBe(false);
  });
});

describe('KK-USAGE-W3: menü ve metinler', () => {
  it('"Kullanım ve limitler" yalnız super_admin menüsündedir ve metni vardır', () => {
    expect(navFor('super_admin').map((n) => n.key)).toContain('usage');
    expect(navFor('support').map((n) => n.key)).not.toContain('usage');
    expect(messages.nav.usage).toBe('Kullanım ve limitler');
    const entry = navFor('super_admin').find((n) => n.key === 'usage');
    expect(entry?.href).toBe('/kullanim');
  });

  it('limit grupları ve ekran başlıkları katalogdadır', () => {
    for (const g of [
      'chat',
      'costGuard',
      'credits',
      'rateLimit',
      'upload',
      'files',
      'kvkk',
      'sources',
      'trial',
    ]) {
      expect(Object.keys(messages.usage.limits.group), g).toContain(g);
    }
    expect(messages.usage.title).toBe('Kullanım ve limitler');
  });
});
