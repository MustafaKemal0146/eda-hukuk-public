// Bildirim kutusu modeli (saf): rozet, bağlantı, sayfa birleştirme; metin kataloğu tür kapsaması.
//  KK-P28-20 rozet 99+, KK-P28-21 sayfa birleştirme, KK-P28-22 tür etiketi eksiksiz
import { NOTIFICATION_TYPES } from '@eda/contracts/enums';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json' with { type: 'json' };
import {
  badgeText,
  linkFor,
  mergePages,
} from '../src/features/notifications/notification-model.ts';

const n = (id: string) => ({
  id,
  type: 'reminder' as const,
  payload: {},
  readAt: null,
  createdAt: '2026-10-15T10:00:00.000Z',
});

describe('KK-P28-20: rozet', () => {
  it('sıfır gizli, 99 üstü 99+', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});

describe('KK-P28-21: bağlantı ve birleştirme', () => {
  it('derin bağlantılar sabit yollardır; bilinmeyen tür bağlantısızdır', () => {
    expect(linkFor('deadline_due')).toBe('/takvim');
    expect(linkFor('export_ready')).toBe('/belgeler');
    expect(linkFor('announcement')).toBeNull();
  });
  it('aynı kimlik iki kez eklenmez', () => {
    const merged = mergePages([n('a'), n('b')], [n('b'), n('c')]);
    expect(merged.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('KK-P28-22: metin kataloğu', () => {
  it('her uygulama içi bildirim türünün Türkçe etiketi var', () => {
    const labels = tr.notifications.types as Record<string, string>;
    for (const t of NOTIFICATION_TYPES) expect(labels[t], t).toBeTruthy();
  });
});
