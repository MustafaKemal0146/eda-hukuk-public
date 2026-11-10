// @tk TK-33
// #28 Ayarlar düzeni: bölüm grupları ve kalıcı bağlantılar, avatar baş harfleri, cihaz etiketi.
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import {
  initialsOf,
  SECTION_SLUGS,
  SETTINGS_GROUPS,
  SETTINGS_TABS,
  tabOfSlug,
} from '../src/features/settings/settings-model.ts';
import { deviceLabel, deviceOf } from '../src/features/settings/user-agent.ts';

describe('KK-P23-7: bölüm grupları ve kalıcı bağlantı', () => {
  it('her bölüm tam bir gruptadır ve Türkçe adresle eşlenir', () => {
    const grouped = SETTINGS_GROUPS.flatMap((g) => g.tabs);
    expect([...grouped].sort()).toEqual([...SETTINGS_TABS].sort());
    for (const tab of SETTINGS_TABS) expect(tabOfSlug(SECTION_SLUGS[tab])).toBe(tab);
    expect(tabOfSlug('bilinmeyen')).toBe('profile');
    expect(tabOfSlug(null)).toBe('profile');
    for (const g of SETTINGS_GROUPS) {
      expect(messages.settings.groups[g.key], g.key).toBeTruthy();
    }
  });

  it('baş harfler Türkçe büyük harfle; tek sözcük ve boş ad', () => {
    expect(initialsOf('ismail ünal')).toBe('İÜ');
    expect(initialsOf('Ayşe Nur Çelik')).toBe('AÇ');
    expect(initialsOf('Deniz')).toBe('D');
    expect(initialsOf('  ')).toBe('?');
  });
});

describe('KK-P23-8: cihaz etiketi', () => {
  it('yaygın tarayıcı ve sistemleri tanır; Edge Chrome sayılmaz', () => {
    const chromeWin =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
    const edge = `${chromeWin} Edg/128.0`;
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(deviceLabel(chromeWin, '?')).toBe('Chrome · Windows');
    expect(deviceLabel(edge, '?')).toBe('Edge · Windows');
    expect(deviceLabel(iphone, '?')).toBe('Safari · iOS');
    expect(deviceOf(iphone).mobile).toBe(true);
    expect(deviceLabel(null, 'Bilinmeyen')).toBe('Bilinmeyen');
  });
});
