// KK-053-02-7 (sözleşme yarısı) ve P12 K5/K7: kapsam serileştirmesi, kesişim ve tek canlı kaynak seçimi.
import { describe, expect, it } from 'vitest';
import {
  effectiveCourtTypes,
  pickLiveSource,
  SCOPE_CATALOG,
  SCOPE_ITEM_IDS,
  SCOPE_PRESETS,
  scopeAllowsLegislation,
  scopeFromRequest,
  scopePromptLabel,
  scopeToRequest,
} from '../src/scope/index.ts';
import { ChatTurnRequest } from '../src/stream/requests.ts';

describe('KK-053-02-7: kapsam serileştirmesi', () => {
  it('boş veya null seçim Akıllı otomatik seçimdir', () => {
    expect(scopeToRequest(null)).toEqual({ sources: [], courtTypes: null });
    expect(scopeToRequest([])).toEqual({ sources: [], courtTypes: null });
    expect(scopePromptLabel(null)).toBe('Tümü');
  });

  it('kurum seçimi kaynak ve mahkeme türlerine iner; geri dönüş aynı seçimi verir', () => {
    const req = scopeToRequest(['yargitay', 'istinaf', 'mevzuat']);
    expect(req).toEqual({
      sources: ['bedesten', 'mevzuat'],
      courtTypes: ['yargitay', 'istinaf_hukuk'],
    });
    expect(scopeFromRequest(req)).toEqual(['yargitay', 'istinaf', 'mevzuat']);
    expect(scopePromptLabel(['yargitay', 'mevzuat'])).toBe('Yargıtay, Mevzuat');
  });

  it('Anayasa Mahkemesi iki mahkeme türünü birlikte taşır', () => {
    expect(scopeToRequest(['aym']).courtTypes).toEqual(['aym_bireysel', 'aym_norm']);
  });

  it('hazır ayarlar yalnız katalogdaki kurumları içerir', () => {
    for (const ids of Object.values(SCOPE_PRESETS)) {
      for (const id of ids ?? []) expect(SCOPE_ITEM_IDS).toContain(id);
    }
    expect(SCOPE_CATALOG.map((i) => i.id)).toEqual([...SCOPE_ITEM_IDS]);
  });

  it('istek şeması courtTypes alanı olmadan da geçerlidir (geriye uyumlu, null)', () => {
    const base = {
      trigger: 'submit-message',
      message: {
        id: '01a12705-0fd0-7725-b35d-97784a0ac2f8',
        role: 'user',
        parts: [{ type: 'text', text: 'kira' }],
      },
      regenerateMessageId: null,
      alias: 'edai-flash',
      mode: 'chat',
      scope: { sources: [], chamber: null, dateFrom: null, dateTo: null },
      attachments: [],
      mentions: [],
      documentId: null,
      documentBaseVersion: null,
      liveSearch: false,
    };
    const parsed = ChatTurnRequest.parse(base);
    expect(parsed.scope.courtTypes).toBeNull();
    const bad = { ...base, scope: { ...base.scope, courtTypes: ['emsal'] } };
    expect(ChatTurnRequest.safeParse(bad).success).toBe(false);
  });
});

describe('P12 K5/K7: kapsam kesişimi ve canlı kaynak', () => {
  const only = (ids: Parameters<typeof scopeToRequest>[0]) => scopeToRequest(ids);

  it('model türleri kapsamla kesilir; kapsam dışı istek boş küme döner', () => {
    expect(effectiveCourtTypes(only(null), ['yargitay'])).toEqual(['yargitay']);
    expect(effectiveCourtTypes(only(['danistay']), null)).toEqual(['danistay']);
    expect(effectiveCourtTypes(only(['danistay']), ['yargitay'])).toEqual([]);
    expect(effectiveCourtTypes(only(['mevzuat']), null)).toEqual([]);
  });

  it('tek canlı kaynak: bedesten > anayasa > uyusmazlik; türler kaynağa göre süzülür', () => {
    expect(pickLiveSource(null)).toEqual({ source: 'bedesten', courtTypes: null });
    expect(pickLiveSource(['aym_bireysel', 'uyusmazlik'])).toEqual({
      source: 'anayasa',
      courtTypes: ['aym_bireysel'],
    });
    expect(pickLiveSource(['uyusmazlik', 'yargitay'])).toEqual({
      source: 'bedesten',
      courtTypes: ['yargitay'],
    });
  });

  it('mevzuat yüzeyi yalnız kapsamdaysa açıktır', () => {
    expect(scopeAllowsLegislation(only(null))).toBe(true);
    expect(scopeAllowsLegislation(only(['yargitay']))).toBe(false);
    expect(scopeAllowsLegislation(only(['yargitay', 'mevzuat']))).toBe(true);
  });
});
