// @tk TK-33
// KK-053-02-7 (bileşen yarısı): hazır ayar eşlemesi, onay kutusu kuralları (alt öğe, boş seçim →
// otomatik), istek gövdesi serileştirmesi; her kurum için `tr` metni var; uç nokta adı metinlerde yok.
import {
  SCOPE_CATALOG,
  SCOPE_GROUPS,
  SCOPE_OUT_OF_COVERAGE,
  SCOPE_PRESET_IDS,
} from '@eda/contracts/scope';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { buildChatTurnRequest } from '../src/features/chat/chat-request.ts';
import { InstitutionMark } from '../src/features/scope/institution-mark.tsx';
import { presetOf, ScopePicker, toggleScope } from '../src/features/scope/scope-picker.tsx';

const userMsg = [
  {
    id: '01990000-0000-7000-8000-000000000021',
    role: 'user' as const,
    parts: [{ type: 'text', text: 'Sentetik soru' }],
  },
];

describe('KK-053-02-7: ScopePicker', () => {
  it('hazır ayar eşlemesi: null otomatiktir; sıra önemsizdir; özel seçim hazır ayar değildir', () => {
    expect(presetOf(null)).toBe('auto');
    expect(presetOf(['mevzuat', 'danistay'])).toBe('admin_tax');
    expect(presetOf(['yargitay', 'kyb', 'istinaf', 'mevzuat'])).toBe('private_law');
    expect(presetOf(['yargitay'])).toBeNull();
  });

  it('otomatikten bir kurum kaldırmak geri kalan hepsini seçili bırakır', () => {
    const next = toggleScope(null, 'uyusmazlik', false);
    expect(next).toEqual(SCOPE_CATALOG.map((i) => i.id).filter((id) => id !== 'uyusmazlik'));
  });

  it('Yargıtay kaldırılınca kanun yararına bozma da kalkar; son öğe kalkınca otomatiğe döner', () => {
    expect(toggleScope(['yargitay', 'kyb', 'mevzuat'], 'yargitay', false)).toEqual(['mevzuat']);
    expect(toggleScope(['mevzuat'], 'mevzuat', false)).toBeNull();
  });

  it('istek gövdesi seçimi courtTypes ve sources olarak taşır', () => {
    expect(buildChatTurnRequest(userMsg, 'edai-flash', ['aym', 'mevzuat']).scope).toEqual({
      sources: ['anayasa', 'mevzuat'],
      courtTypes: ['aym_bireysel', 'aym_norm'],
      chamber: null,
      dateFrom: null,
      dateTo: null,
    });
    expect(buildChatTurnRequest(userMsg, 'edai-flash').scope.courtTypes).toBeNull();
  });

  it('tüm kurum, grup ve hazır ayarların metni var; metinlerde uç nokta adı geçmez', () => {
    const s = messages.scope;
    for (const item of SCOPE_CATALOG) expect(s.items[item.id].label).toBeTruthy();
    for (const g of SCOPE_GROUPS) expect(s.groups[g]).toBeTruthy();
    for (const p of SCOPE_PRESET_IDS) expect(s.presets[p].label).toBeTruthy();
    for (const o of SCOPE_OUT_OF_COVERAGE) expect(s.outOfCoverage.items[o]).toBeTruthy();
    expect(JSON.stringify(s)).not.toMatch(/bedesten|uyap|mcp/i);
  });

  it('tetikleyici seçime göre etiketlenir ve kurum işaretleri süsleyicidir', () => {
    const render = (value: Parameters<typeof ScopePicker>[0]['value']) =>
      renderToStaticMarkup(
        createElement(NextIntlClientProvider, {
          locale: 'tr',
          messages,
          timeZone: 'Europe/Istanbul',
          children: createElement(ScopePicker, { value, onChange: () => {} }),
        }),
      );
    expect(render(null)).toContain('Akıllı otomatik seçim');
    expect(render(['danistay', 'mevzuat'])).toContain('Danıştay');
    expect(render(['yargitay', 'aym', 'mevzuat'])).toContain('3 kaynak');
    const mark = renderToStaticMarkup(createElement(InstitutionMark, { id: 'aym' }));
    expect(mark).toContain('aria-hidden="true"');
  });
});
