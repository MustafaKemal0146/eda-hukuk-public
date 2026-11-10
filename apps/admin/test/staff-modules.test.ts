// @tk TK-28
// Şablonlar, Destek ve Veri seti modülleri: menü rolleri, sözleşme sınırları ve arayüz metin kataloğu
// kapsamı (her kapalı küme değerinin Türkçe karşılığı vardır).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdminDatasetsDto, DatasetRunDto } from '@eda/contracts/api/admin-datasets';
import { AdminTicketDto, SetTicketStatusInput } from '@eda/contracts/api/admin-support';
import {
  AdminTemplateItemDto,
  AdminTemplateListResponse,
  TEMPLATE_VARIABLE_TYPES,
} from '@eda/contracts/api/admin-templates';
import {
  DOCUMENT_KINDS,
  INGESTION_RUN_KINDS,
  INGESTION_RUN_STATUSES,
  LAW_TYPES,
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from '@eda/contracts/enums';
import { NOTIFICATION_CLASSES } from '@eda/contracts/notifications';
import { describe, expect, it } from 'vitest';
import { isActive, NAV, navFor } from '../src/features/shell/nav.ts';

const KEYS = ['templates', 'support', 'datasets'] as const;

type Dict = Record<string, string>;
const tr = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'messages', 'tr.json'), 'utf8'),
) as {
  nav: Dict;
  templates: { docKind: Dict; class: Dict; varType: Dict };
  support: { status: Dict; category: Dict; priority: Dict; filter: Dict };
  datasets: { lawType: Dict; runKind: Dict; runStatus: Dict; state: Dict; breaker: Dict };
};

describe('KK-ADM-MENU-1: Şablonlar, Destek ve Veri seti menüsü', () => {
  it('üç modül de support ve super_admin için menüde; sıra korunur', () => {
    for (const role of ['support', 'super_admin'] as const) {
      const keys = navFor(role).map((n) => n.key);
      for (const k of KEYS) expect(keys, `${role} ${k}`).toContain(k);
    }
    const order = NAV.map((n) => n.key);
    expect(order.indexOf('templates')).toBeLessThan(order.indexOf('support'));
    expect(order.indexOf('support')).toBeLessThan(order.indexOf('datasets'));
  });

  it('yollar Türkçe ASCII kebab-case ve etkin yol eşlemesi çalışır', () => {
    const hrefs = Object.fromEntries(NAV.map((n) => [n.key, n.href]));
    expect(hrefs.templates).toBe('/sablonlar');
    expect(hrefs.support).toBe('/destek');
    expect(hrefs.datasets).toBe('/veri-seti');
    expect(isActive('/veri-seti', '/veri-seti')).toBe(true);
    expect(isActive('/veri-setim', '/veri-seti')).toBe(false);
  });

  it('menü etiketleri katalogda vardır', () => {
    for (const k of KEYS) expect(tr.nav[k]).toBeTruthy();
  });
});

describe('KK-ADM-ICERIK-1: sözleşmeler içerik taşımaz', () => {
  it('destek talebi DTO alanlarında konu ve gövde yoktur; fazladan alan reddedilir', () => {
    const keys = Object.keys(AdminTicketDto.shape);
    for (const forbidden of ['subject', 'body', 'name', 'title', 'content', 'text']) {
      expect(keys).not.toContain(forbidden);
    }
    const sample = {
      ticketId: crypto.randomUUID(),
      orgRef: crypto.randomUUID(),
      orgKind: 'individual',
      requesterEmail: null,
      category: 'technical',
      priority: 'normal',
      status: 'open',
      createdAt: '2026-01-15T09:30:00+03:00',
      updatedAt: '2026-01-15T09:30:00+03:00',
      closedAt: null,
    };
    expect(AdminTicketDto.safeParse(sample).success).toBe(true);
    expect(AdminTicketDto.safeParse({ ...sample, subject: 'x' }).success).toBe(false);
  });

  it('durum girdisi yalnız kapalı kümeden; serbest metin reddedilir', () => {
    expect(SetTicketStatusInput.safeParse({ status: 'closed' }).success).toBe(true);
    expect(SetTicketStatusInput.safeParse({ status: 'serbest' }).success).toBe(false);
    expect(SetTicketStatusInput.safeParse({ status: 'closed', note: 'x' }).success).toBe(false);
  });

  it('veri seti çalıştırma DTO’sunda hata ayrıntısı alanı yoktur', () => {
    const keys = Object.keys(DatasetRunDto.shape);
    expect(keys).not.toContain('errorSummary');
    expect(keys).not.toContain('params');
    expect(Object.keys(AdminDatasetsDto.shape).sort()).toEqual(
      ['generatedAt', 'legislation', 'runs', 'sources'].sort(),
    );
  });

  it('şablon yanıtı belge içeriğinin gizli olduğunu bildirir; değişken türleri kapalı', () => {
    expect(
      AdminTemplateListResponse.safeParse({ items: [], documentContentHidden: false }).success,
    ).toBe(false);
    expect(Object.keys(AdminTemplateItemDto.shape)).not.toContain('content');
    expect([...TEMPLATE_VARIABLE_TYPES].sort()).toEqual(['datetime', 'enum', 'number', 'string']);
  });
});

describe('KK-ADM-METIN-1: kapalı küme değerlerinin Türkçe karşılığı vardır', () => {
  const has = (obj: Record<string, string>, values: readonly string[]) => {
    for (const v of values) expect(obj[v], v).toBeTruthy();
  };
  it('şablonlar', () => {
    has(tr.templates.docKind, DOCUMENT_KINDS);
    has(tr.templates.class, NOTIFICATION_CLASSES);
    has(tr.templates.varType, TEMPLATE_VARIABLE_TYPES);
  });
  it('destek', () => {
    has(tr.support.status, SUPPORT_TICKET_STATUSES);
    has(tr.support.category, SUPPORT_TICKET_CATEGORIES);
    has(tr.support.priority, SUPPORT_TICKET_PRIORITIES);
    has(tr.support.filter, ['all', ...SUPPORT_TICKET_STATUSES]);
  });
  it('veri seti', () => {
    has(tr.datasets.lawType, LAW_TYPES);
    has(tr.datasets.runKind, INGESTION_RUN_KINDS);
    has(tr.datasets.runStatus, INGESTION_RUN_STATUSES);
    has(tr.datasets.state, ['up', 'degraded', 'down', 'disabled', 'unknown']);
    has(tr.datasets.breaker, ['closed', 'open', 'half_open']);
  });
});
