// @vitest-environment happy-dom
// @tk TK-33
// #28 (P23 ilk dilim): tema/yoğunluk tercihi cihazda kök özniteliğinde tutulur. Ayarlar sekmeleri,
// tema menüsü ve komut paleti aynı tercihi değiştirdiği için `applyUiPrefs` abonelere haber verir;
// böylece bir denetimden yapılan değişiklik diğerlerinde de görünür (tarayıcı doğrulamasında
// menü "Sistem"te kalırken ayarlar sekmesi "Aydınlık" gösteriyordu).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyUiPrefs,
  parseUiPrefs,
  readUiPrefs,
  serializeUiPrefs,
  subscribeUiPrefs,
} from '../src/features/shell/ui-prefs.ts';

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.density;
});

describe('#28: arayüz tercihleri', () => {
  it('bilinmeyen ve eksik değerler güvenli varsayılana düşer', () => {
    expect(parseUiPrefs(undefined)).toEqual({ theme: 'system', density: 'comfortable' });
    expect(parseUiPrefs('t=dark&d=compact')).toEqual({ theme: 'dark', density: 'compact' });
    expect(parseUiPrefs('t=mor&d=dev')).toEqual({ theme: 'system', density: 'comfortable' });
    expect(serializeUiPrefs({ theme: 'light', density: 'compact' })).toBe('t=light&d=compact');
  });

  it('applyUiPrefs kök özniteliğini günceller, readUiPrefs geri okur', () => {
    applyUiPrefs({ theme: 'dark', density: 'compact' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.density).toBe('compact');
    expect(readUiPrefs()).toEqual({ theme: 'dark', density: 'compact' });
  });

  it('aboneler her değişiklikte güncel tercihi alır; abonelik kaldırılınca sessiz kalır', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeUiPrefs((prefs) => seen.push(prefs.theme));

    applyUiPrefs({ theme: 'light', density: 'comfortable' });
    applyUiPrefs({ theme: 'dark', density: 'comfortable' });
    expect(seen).toEqual(['light', 'dark']);

    unsubscribe();
    applyUiPrefs({ theme: 'system', density: 'comfortable' });
    expect(seen).toEqual(['light', 'dark']);
  });
});
