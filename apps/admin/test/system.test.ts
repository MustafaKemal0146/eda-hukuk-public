// @tk TK-28
// Sistem ekranı modeli ve menü kaydı: durum-ton eşlemesi, bayt biçimi, kuyruk toplamı, metin anahtarları.
import { readFileSync } from 'node:fs';
import { SYSTEM_SERVICE_KEYS } from '@eda/contracts/api/admin-system';
import { SOURCE_CANARY_OUTCOMES, SOURCE_CANARY_PROBES } from '@eda/contracts/enums';
import { describe, expect, it } from 'vitest';
import { navFor } from '../src/features/shell/nav.ts';
import {
  formatBytes,
  overallState,
  PROBE_ICON,
  PROBE_TONE,
  queueTotals,
  STATE_ICON,
  STATE_TONE,
  successPercent,
} from '../src/features/system/model.ts';

const tr = JSON.parse(readFileSync(new URL('../messages/tr.json', import.meta.url), 'utf8')) as {
  nav: Record<string, string>;
  system: {
    svc: Record<string, string>;
    sources: {
      probe: Record<string, string>;
      state: Record<string, string>;
      outcome: Record<string, string>;
    } & Record<string, unknown>;
  };
};

describe('KK-SISTEM-6: Sistem menüsü ve durum modeli', () => {
  it('Sistem yalnız süper yöneticide görünür', () => {
    expect(navFor('super_admin').some((n) => n.key === 'system' && n.href === '/sistem')).toBe(
      true,
    );
    expect(navFor('support').some((n) => n.key === 'system')).toBe(false);
    expect(tr.nav.system).toBe('Sistem');
  });

  it('her durumun farklı tonu ve simgesi var (renk tek başına anlam taşımaz)', () => {
    expect(new Set(Object.values(STATE_TONE)).size).toBe(3);
    expect(new Set(Object.values(STATE_ICON)).size).toBe(3);
    expect(overallState([{ state: 'ok' }, { state: 'ok' }])).toBe('ok');
    expect(overallState([{ state: 'ok' }, { state: 'degraded' }])).toBe('degraded');
    expect(overallState([{ state: 'degraded' }, { state: 'fail' }])).toBe('fail');
  });

  it('bayt biçimi ve kuyruk toplamı', () => {
    expect(formatBytes(0)).toEqual({ value: 0, unit: 'B' });
    expect(formatBytes(1536)).toEqual({ value: 1.5, unit: 'KB' });
    expect(formatBytes(5 * 1024 ** 3)).toEqual({ value: 5, unit: 'GB' });
    expect(
      queueTotals([
        { name: 'chat', waiting: 1, active: 2, failed: 3, delayed: 4 },
        { name: 'billing', waiting: 10, active: 0, failed: 0, delayed: 1 },
      ]),
    ).toEqual({ waiting: 11, active: 2, failed: 3, delayed: 5 });
  });

  it('her servis anahtarı için metin tanımlı', () => {
    for (const k of SYSTEM_SERVICE_KEYS) {
      expect(tr.system.svc[k], k).toBeTruthy();
    }
  });
});

describe('KK-KANARYA-3: Kaynak durumu kartı modeli ve metinleri', () => {
  it('rozet: yeşil / kırmızı / nötr, her durumun ayrı simgesi', () => {
    expect(PROBE_TONE).toEqual({ ok: 'success', failing: 'danger', unknown: 'neutral' });
    expect(new Set(Object.values(PROBE_ICON)).size).toBe(3);
  });

  it('başarı oranı aşağı yuvarlanır; pencere boşsa null', () => {
    const base = {
      probe: 'uyap_search',
      state: 'ok',
      lastCheckedAt: null,
      lastOutcome: null,
      lastDurationMs: null,
      consecutiveFailures: 0,
      degraded: false,
      windowRuns: 0,
      windowOk: 0,
    } as const;
    expect(successPercent({ ...base, successRate: 0.999 })).toBe(99);
    expect(successPercent({ ...base, successRate: 1 })).toBe(100);
    expect(successPercent({ ...base, successRate: null })).toBeNull();
  });

  it('beş yoklama ve sonuç adları katalogda; görünen adlarda "Bedesten" yok, "UYAP" var', () => {
    for (const p of SOURCE_CANARY_PROBES) expect(tr.system.sources.probe[p], p).toBeTruthy();
    for (const o of SOURCE_CANARY_OUTCOMES.filter((x) => x !== 'ok')) {
      expect(tr.system.sources.outcome[o], o).toBeTruthy();
    }
    for (const st of ['ok', 'failing', 'unknown']) expect(tr.system.sources.state[st]).toBeTruthy();
    expect(tr.system.sources.probe.uyap_search).toBe('UYAP karar araması');
    const values = (o: unknown): string[] =>
      typeof o === 'string' ? [o] : Object.values(o as Record<string, unknown>).flatMap(values);
    for (const v of values(tr.system.sources)) expect(v).not.toMatch(/bedesten/i);
  });
});
