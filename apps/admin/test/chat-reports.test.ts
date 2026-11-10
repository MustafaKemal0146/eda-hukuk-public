// @tk TK-28
// P27 "Sohbetler ve raporlar" web modeli: menü, tarih aralığı, toplulaştırma yardımcıları ve gizlilik
// (sözleşme içerik alanı kabul etmez; görünümde indirme/CSV kodu yok).
import { readFileSync } from 'node:fs';
import { ChatReportsResponse } from '@eda/contracts/api/admin-chat-reports';
import { describe, expect, it } from 'vitest';
import {
  CHAT_REPORT_MAX_DAYS,
  rangeQuery,
  share,
  sumDaily,
  toolErrorTotals,
  weightedAvgTurnSeconds,
} from '../src/features/chat-reports/model.ts';
import { navFor } from '../src/features/shell/nav.ts';

const day = (over: Partial<Parameters<typeof sumDaily>[0][number]> = {}) => ({
  day: '2026-10-01',
  conversations: 1,
  messages: 4,
  userMessages: 2,
  turns: 2,
  turnErrors: 0,
  avgTurnSeconds: 10,
  activeOrgs: 1,
  chatCalls: 2,
  petitionCalls: 0,
  sourcesDecision: 1,
  sourcesLegislation: 0,
  feedbackUp: 0,
  feedbackDown: 1,
  ...over,
});

const empty = {
  from: '2026-10-01',
  to: '2026-10-01',
  daily: [day()],
  modes: [],
  aliases: [],
  tools: [],
  sources: [],
  sourceOrigins: [],
  feedback: { up: 0, down: 0, downCategories: [] },
  orgKinds: [],
  unavailable: ['masking_notices'],
};

describe('KK-P27-chat-4: Sohbetler ve raporlar menüsü ve model', () => {
  it('menüde yalnız süper yönetici için "chatReports" /sohbetler girdisi var', () => {
    expect(navFor('super_admin').find((n) => n.key === 'chatReports')?.href).toBe('/sohbetler');
    expect(navFor('support').map((n) => n.key)).not.toContain('chatReports');
  });

  it('tarih aralığı en çok 92 gün ve bugünü içerir', () => {
    const today = new Date(2026, 9, 16);
    expect(rangeQuery(7, today)).toBe('from=2026-10-10&to=2026-10-16');
    const long = rangeQuery(500, today);
    const [from, to] = long.replace('from=', '').split('&to=') as [string, string];
    const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    expect(span).toBe(CHAT_REPORT_MAX_DAYS - 1);
  });

  it('tur ağırlıklı ortalama süre, oran ve araç toplamı', () => {
    const d = [day({ turns: 1, avgTurnSeconds: 10 }), day({ turns: 3, avgTurnSeconds: 20 })];
    expect(weightedAvgTurnSeconds(d)).toBe(17.5);
    expect(weightedAvgTurnSeconds([day({ avgTurnSeconds: null })])).toBeNull();
    expect(share(1, 4)).toBe(0.25);
    expect(share(1, 0)).toBeNull();
    expect(sumDaily(d, 'messages')).toBe(8);
    expect(
      toolErrorTotals([
        { tool: 'get_decision', calls: 4, errors: 1, errorRate: 0.25, avgDurationMs: 10 },
        { tool: 'search_decisions', calls: 6, errors: 0, errorRate: 0, avgDurationMs: 10 },
      ]),
    ).toEqual({ calls: 10, errors: 1 });
  });
});

describe('KK-P27-chat-5: gizlilik sözleşmesi', () => {
  it('yanıt şeması içerik veya kimlik alanı kabul etmez (strictObject)', () => {
    expect(ChatReportsResponse.safeParse(empty).success).toBe(true);
    for (const extra of [{ title: 'x' }, { userId: 'x' }, { messages: [] }, { text: 'x' }]) {
      expect(ChatReportsResponse.safeParse({ ...empty, ...extra }).success).toBe(false);
    }
    expect(
      ChatReportsResponse.safeParse({ ...empty, daily: [{ ...day(), parts: 'x' }] }).success,
    ).toBe(false);
  });

  it('görünüm indirme veya CSV üretmez', () => {
    const src = readFileSync(
      new URL('../src/features/chat-reports/chat-reports-view.tsx', import.meta.url),
      'utf8',
    );
    for (const bad of [
      'Blob',
      'createObjectURL',
      'text/csv',
      'download=',
      `dangerously${'SetInnerHTML'}`,
    ]) {
      expect(src, bad).not.toContain(bad);
    }
  });
});
