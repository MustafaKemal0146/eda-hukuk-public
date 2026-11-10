// Duyuru şeridi modeli (saf): ton/rol eşlemesi, oturum içi kapatma kaydı, katalog kapsaması.
//  KK-P27-ANN-W1 ciddiyet eşlemesi   KK-P27-ANN-W2 kapatma kaydı bozuk/yok depoda güvenli
//  KK-P27-ANN-W3 metin kataloğu
import { ANNOUNCEMENT_SEVERITIES } from '@eda/contracts/enums';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json' with { type: 'json' };
import {
  DISMISSED_STORAGE_KEY,
  readDismissed,
  roleFor,
  SEVERITY_TONE,
  visibleOf,
  writeDismissed,
} from '../src/features/announcements/announcement-model.ts';

const item = (id: string, severity: 'info' | 'warning' | 'critical' = 'info') => ({
  id,
  severity,
  title: 'Örnek duyuru',
  body: 'Örnek metin',
  activeFrom: '2026-10-15T10:00:00.000Z',
  activeUntil: null,
});

describe('KK-P27-ANN-W1: ciddiyet eşlemesi', () => {
  it('her ciddiyetin tonu vardır; yalnız kritik alert rolü alır', () => {
    for (const s of ANNOUNCEMENT_SEVERITIES) expect(SEVERITY_TONE[s]).toBeDefined();
    expect(SEVERITY_TONE.critical).toBe('danger');
    expect(roleFor('critical')).toBe('alert');
    expect(roleFor('warning')).toBe('status');
    expect(roleFor('info')).toBe('status');
  });
});

describe('KK-P27-ANN-W2: kapatma kaydı', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };

  it('kapatılan duyuru gizlenir; yalnız etkin kimlikler saklanır', () => {
    const s = memory();
    writeDismissed(s, new Set(['a', 'eski']), ['a', 'b']);
    expect(JSON.parse(s.getItem(DISMISSED_STORAGE_KEY) ?? '[]')).toEqual(['a']);
    const dismissed = readDismissed(s);
    expect(visibleOf([item('a'), item('b')], dismissed).map((x) => x.id)).toEqual(['b']);
  });

  it('bozuk veya erişilemeyen depoda boş küme; yazma hatası sessiz', () => {
    expect(readDismissed(null).size).toBe(0);
    expect(readDismissed({ getItem: () => '{bozuk' }).size).toBe(0);
    expect(readDismissed({ getItem: () => '{"a":1}' }).size).toBe(0);
    expect(readDismissed({ getItem: () => '[1,"x"]' })).toEqual(new Set(['x']));
    expect(() =>
      writeDismissed(
        {
          setItem: () => {
            throw new Error('kota');
          },
        },
        new Set(['a']),
        ['a'],
      ),
    ).not.toThrow();
  });
});

describe('KK-P27-ANN-W3: metin kataloğu', () => {
  it('şerit metinleri tr.json içinde', () => {
    expect(tr.announcements.region.length).toBeGreaterThan(0);
    expect(tr.announcements.dismiss.length).toBeGreaterThan(0);
  });
});
