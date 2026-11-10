// @tk TK-28
// Denetim modülü (KK-AUDIT-WEB): olay kataloğu kapsaması, filtre -> sorgu, meta veri satırları ve
// menü yetkisi. Arayüz metni tr.json'dadır; her olay grubunun etiketi bulunmalı.
import { AUDIT_ACTIONS } from '@eda/contracts/audit-events';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json' with { type: 'json' };
import {
  AUDIT_GROUPS,
  buildEventsQuery,
  EMPTY_FILTERS,
  groupOf,
  isRangeIncomplete,
  isRangeInverted,
  metadataRows,
  SOURCE_FIELD,
} from '../src/features/audit/model.ts';
import { navFor } from '../src/features/shell/nav.ts';

describe('KK-AUDIT-WEB-1: katalog ve etiketler', () => {
  it('her olay grubunun Türkçe etiketi var; katalog dışı grup yok', () => {
    const labels = Object.keys(tr.audit.group);
    for (const g of AUDIT_GROUPS) expect(labels, g).toContain(g);
    expect(labels.sort()).toEqual([...AUDIT_GROUPS].sort());
    expect(groupOf('org_key.rotated')).toBe('org_key');
    expect(AUDIT_ACTIONS).toContain('admin.application.approved');
  });

  it('her hata kaynağının etiketi ve notu var', () => {
    for (const k of Object.keys(SOURCE_FIELD)) {
      expect(tr.audit.source).toHaveProperty(k);
      expect(tr.audit.sourceNote).toHaveProperty(k);
    }
  });
});

describe('KK-AUDIT-WEB-2: filtre ve meta veri', () => {
  it('boş filtre sorgusuz; tarih yalnız çift olarak gönderilir; imleç eklenir', () => {
    expect(buildEventsQuery(EMPTY_FILTERS).toString()).toBe('');
    const q = buildEventsQuery(
      { action: 'auth.login.failure', actorType: 'user', from: '2026-10-01', to: '2026-10-07' },
      '2026-10-07T10:00:00.123456Z|01890000-0000-7000-8000-000000000000',
    );
    expect(q.get('action')).toBe('auth.login.failure');
    expect(q.get('actorType')).toBe('user');
    expect(q.get('from')).toBe('2026-10-01');
    expect(q.get('cursor')).toContain('|');
    expect(buildEventsQuery({ ...EMPTY_FILTERS, from: '2026-10-01' }).has('from')).toBe(false);
  });

  it('eksik veya ters tarih aralığı algılanır', () => {
    expect(isRangeIncomplete({ ...EMPTY_FILTERS, from: '2026-10-01' })).toBe(true);
    expect(isRangeInverted({ ...EMPTY_FILTERS, from: '2026-10-09', to: '2026-10-01' })).toBe(true);
    expect(isRangeInverted(EMPTY_FILTERS)).toBe(false);
  });

  it('meta veri satırları anahtara göre sıralı ve metne çevrilmiştir', () => {
    expect(metadataRows({ reasonCode: 'other', amount: 5, kind: 'refund' })).toEqual([
      { key: 'amount', value: '5' },
      { key: 'kind', value: 'refund' },
      { key: 'reasonCode', value: 'other' },
    ]);
  });
});

describe('KK-AUDIT-WEB-3: menü yetkisi', () => {
  it('Denetim günlüğü hem super_admin hem support menüsünde', () => {
    expect(navFor('super_admin').some((n) => n.key === 'audit' && n.href === '/denetim')).toBe(
      true,
    );
    expect(navFor('support').some((n) => n.key === 'audit')).toBe(true);
    expect(tr.nav.audit).toBe('Denetim günlüğü');
  });
});
