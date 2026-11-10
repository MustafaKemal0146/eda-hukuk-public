// @tk TK-33
// KK-P05-10 (KK-051-10 rozet yarısı): `CitationStatusBadge` 8 künye durumu + `unresolved` için ayrı
// (simge, etiket, sınır biçimi) üretir; erişilebilir ad durum etiketini içerir; iki `warning` durumu
// düz/kesikli sınırla ayrışır. Diğer durum haritaları kanonik enum anahtarlarını birebir kapsar
// (051 §4.4–§4.6). Etiketler örnek metindir (çağıran katalogdan verir).
import {
  CALENDAR_EVENT_TYPES,
  DATA_CLASSES,
  DEADLINE_CHECK_STATUSES,
  DOCUMENT_EXPORT_STATUSES,
  DOCUMENT_STATUSES,
  FILE_STATUSES,
  KUNYE_STATUSES,
  MESSAGE_STATUSES,
  PIPELINE_STATUSES,
  SUGGESTION_STATUSES,
} from '@eda/contracts/enums';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SourceChip } from '../src/components/source-chip.tsx';
import {
  CitationStatusBadge,
  DataClassChip,
  EventChip,
  FileStatusBadge,
  ProviderBadge,
} from '../src/components/status-badges.tsx';
import {
  CITATION_STATUS_VIEW,
  CITATION_VIEW_KEYS,
  type CitationViewKey,
  DATA_CLASS_VIEW,
  DEADLINE_CHECK_VIEW,
  DOCUMENT_STATUS_VIEW,
  deadlineUrgency,
  EVENT_TYPE_VIEW,
  EXPORT_STATUS_VIEW,
  FILE_STATUS_VIEW,
  MESSAGE_STATUS_VIEW,
  PIPELINE_STATUS_VIEW,
  SUGGESTION_STATUS_VIEW,
} from '../src/components/status-maps.ts';
import { ICON_NAMES } from '../src/icons/registry.ts';

/** Örnek etiketler: her durum için ayrı metin (gerçek metinler 003 §4.2 kataloğundan gelir). */
const LABELS = Object.fromEntries(
  CITATION_VIEW_KEYS.map((k) => [k, `Örnek etiket ${k}`]),
) as Record<CitationViewKey, string>;

function svgClass(markup: string): string {
  return /<svg[^>]*class="([^"]*)"/.exec(markup)?.[1] ?? '';
}

function render(status: CitationViewKey, compact = false): string {
  return renderToStaticMarkup(
    createElement(CitationStatusBadge, { status, labels: LABELS, compact }),
  );
}

describe('KK-P05-10: künye durum haritası (8 durum + unresolved)', () => {
  it('anahtarlar = KUNYE_STATUSES + unresolved (9)', () => {
    expect([...CITATION_VIEW_KEYS]).toEqual([...KUNYE_STATUSES, 'unresolved']);
    expect(Object.keys(CITATION_STATUS_VIEW).sort()).toEqual([...CITATION_VIEW_KEYS].sort());
  });

  it('her durumun simgesi ayrı ve kayıtlı', () => {
    const icons = CITATION_VIEW_KEYS.map((k) => CITATION_STATUS_VIEW[k].icon);
    expect(new Set(icons).size).toBe(9);
    for (const icon of icons) expect(ICON_NAMES).toContain(icon);
  });

  it('sınır biçimi 051 §4.3 tablosuna uyar ve sınıf dizesine yansır', () => {
    const expected: Record<CitationViewKey, string> = {
      pending: 'solid',
      verified: 'solid',
      verified_user_source: 'dashed',
      out_of_context: 'solid',
      out_of_coverage: 'solid',
      source_unavailable: 'dashed',
      not_found: 'thick',
      attested: 'filled',
      unresolved: 'solid',
    };
    for (const k of CITATION_VIEW_KEYS) {
      const view = CITATION_STATUS_VIEW[k];
      expect(view.frame, k).toBe(expected[k]);
      const classes = view.className.split(' ');
      expect(classes.includes('border-dashed'), k).toBe(view.frame === 'dashed');
      expect(classes.includes('border-2'), k).toBe(view.frame === 'thick');
      // Tek sınır kalınlığı sınıfı: `border` ve `border-2` birlikte verilmez (cn birleştirmez).
      expect(classes.includes('border') && classes.includes('border-2'), k).toBe(false);
      // Çip/rozet her zaman sınır taşır (forced-colors; 051 §13.3).
      expect(classes.includes('border') || classes.includes('border-2'), k).toBe(true);
    }
  });

  it('iki warning durumu simge ve sınır biçimiyle ayrışır', () => {
    const ooc = CITATION_STATUS_VIEW.out_of_context;
    const su = CITATION_STATUS_VIEW.source_unavailable;
    expect(ooc.tone).toBe('warning');
    expect(su.tone).toBe('warning');
    expect(ooc.frame).not.toBe(su.frame);
    expect(ooc.icon).not.toBe(su.icon);
  });

  it('dışa aktarım engeli: not_found sert, source_unavailable yumuşak, pending beklenir', () => {
    expect(CITATION_STATUS_VIEW.not_found.blocking).toBe('hard');
    expect(CITATION_STATUS_VIEW.source_unavailable.blocking).toBe('soft');
    expect(CITATION_STATUS_VIEW.pending.blocking).toBeNull();
    for (const k of [
      'verified',
      'verified_user_source',
      'out_of_context',
      'out_of_coverage',
      'attested',
    ] as const) {
      expect(CITATION_STATUS_VIEW[k].blocking, k).toBe('none');
    }
  });
});

describe('KK-P05-10: CitationStatusBadge çıktısı', () => {
  it('9 durum ayrı (simge, etiket, sınır) üretir; etiket görünür', () => {
    const seen = new Set<string>();
    for (const k of CITATION_VIEW_KEYS) {
      const markup = render(k);
      expect(markup).toContain(LABELS[k]);
      expect(markup).toContain(`data-status="${k}"`);
      expect(markup).toContain(`data-frame="${CITATION_STATUS_VIEW[k].frame}"`);
      seen.add(`${svgClass(markup)}|${CITATION_STATUS_VIEW[k].frame}`);
    }
    expect(seen.size).toBe(9);
  });

  it('compact: yalnız simge görünür, erişilebilir ad etiketi taşır', () => {
    for (const k of CITATION_VIEW_KEYS) {
      const markup = render(k, true);
      expect(markup).toContain('role="img"');
      expect(markup).toContain(`aria-label="${LABELS[k]}"`);
    }
  });

  it('contextLabel etiketi bağlama göre değiştirir', () => {
    const markup = renderToStaticMarkup(
      createElement(CitationStatusBadge, {
        status: 'out_of_context',
        labels: LABELS,
        contextLabel: 'Örnek bağlam etiketi',
      }),
    );
    expect(markup).toContain('Örnek bağlam etiketi');
    expect(markup).not.toContain(LABELS.out_of_context);
  });

  it('pending azaltılmış harekette statik simge de çizer (051 §10.2)', () => {
    const markup = render('pending');
    expect(markup).toContain('lucide-loader-circle');
    expect(markup).toContain('lucide-clock');
    expect(markup).toContain('motion-reduce:hidden');
  });

  it('SourceChip aynı tabloyu kullanır (sınır biçimi sınıfları)', () => {
    const markup = renderToStaticMarkup(
      createElement(SourceChip, { shortKunye: 'Örnek künye', status: 'source_unavailable' }),
    );
    expect(markup).toContain('border-dashed');
    expect(markup).toContain('lucide-cloud-off');
    const none = renderToStaticMarkup(createElement(SourceChip, { shortKunye: 'Örnek künye' }));
    expect(none).toContain('lucide-circle-dashed');
  });
});

describe('051 §4.4–§4.6: diğer durum haritaları kanonik anahtarları kapsar', () => {
  const cases: [string, readonly string[], object][] = [
    ['DATA_CLASS_VIEW', DATA_CLASSES, DATA_CLASS_VIEW],
    ['DOCUMENT_STATUS_VIEW', DOCUMENT_STATUSES, DOCUMENT_STATUS_VIEW],
    ['FILE_STATUS_VIEW', FILE_STATUSES, FILE_STATUS_VIEW],
    ['MESSAGE_STATUS_VIEW', MESSAGE_STATUSES, MESSAGE_STATUS_VIEW],
    ['PIPELINE_STATUS_VIEW', PIPELINE_STATUSES, PIPELINE_STATUS_VIEW],
    ['DEADLINE_CHECK_VIEW', DEADLINE_CHECK_STATUSES, DEADLINE_CHECK_VIEW],
    ['SUGGESTION_STATUS_VIEW', SUGGESTION_STATUSES, SUGGESTION_STATUS_VIEW],
    ['EXPORT_STATUS_VIEW', DOCUMENT_EXPORT_STATUSES, EXPORT_STATUS_VIEW],
    ['EVENT_TYPE_VIEW', CALENDAR_EVENT_TYPES, EVENT_TYPE_VIEW],
  ];
  for (const [name, keys, map] of cases) {
    it(name, () => {
      expect(Object.keys(map).sort()).toEqual([...keys].sort());
    });
  }

  it('etkinlik türleri simgeyle ayrışır (7 ayrı simge; renk tek başına değil)', () => {
    const icons = CALENDAR_EVENT_TYPES.map((t) => EVENT_TYPE_VIEW[t].icon);
    expect(new Set(icons).size).toBe(CALENDAR_EVENT_TYPES.length);
  });

  it('mesaj `complete` rozet taşımaz', () => {
    expect(MESSAGE_STATUS_VIEW.complete).toBeNull();
  });

  it('süre aciliyeti eşikleri çağırandan gelir', () => {
    const t = { urgentDays: 3, soonDays: 7 };
    expect(deadlineUrgency(-1, t)).toBe('overdue');
    expect(deadlineUrgency(0, t)).toBe('urgent');
    expect(deadlineUrgency(3, t)).toBe('urgent');
    expect(deadlineUrgency(4, t)).toBe('soon');
    expect(deadlineUrgency(8, t)).toBe('normal');
  });
});

describe('052 §5.4, §10, §11: veri sınıfı, sağlayıcı, evrak ve etkinlik rozetleri', () => {
  it('DataClassChip sınıfa göre simge ve token sınıfı taşır', () => {
    const markup = renderToStaticMarkup(
      createElement(DataClassChip, { dataClass: 'case', label: 'Örnek dosya' }),
    );
    expect(markup).toContain('lucide-folder-lock');
    expect(markup).toContain('bg-data-class-case-bg');
    expect(markup).toContain('Örnek dosya');
  });

  it('ProviderBadge bölge yoksa çizilmez; mock için kalıcı simülasyon rozeti', () => {
    const labels = { location: 'Örnek konum', simulation: 'Örnek simülasyon' };
    expect(
      renderToStaticMarkup(
        createElement(ProviderBadge, { region: null, providerId: 'deepseek', labels }),
      ),
    ).toBe('');
    const real = renderToStaticMarkup(
      createElement(ProviderBadge, { region: 'TR', providerId: 'deepseek', labels }),
    );
    expect(real).toContain('Örnek konum');
    expect(real).not.toContain('Örnek simülasyon');
    const mock = renderToStaticMarkup(
      createElement(ProviderBadge, { region: 'NONE', providerId: 'mock', labels }),
    );
    expect(mock).toContain('Örnek simülasyon');
    expect(mock).toContain('lucide-flask-conical');
  });

  it('FileStatusBadge işleme durumunda dönen + statik simge, karantinada shield-alert', () => {
    const labels = Object.fromEntries(FILE_STATUSES.map((s) => [s, `Örnek ${s}`])) as Record<
      (typeof FILE_STATUSES)[number],
      string
    >;
    const scanning = renderToStaticMarkup(
      createElement(FileStatusBadge, { status: 'scanning', labels }),
    );
    expect(scanning).toContain('motion-safe:animate-spin');
    expect(scanning).toContain('lucide-clock');
    const q = renderToStaticMarkup(
      createElement(FileStatusBadge, { status: 'quarantined', labels }),
    );
    expect(q).toContain('lucide-shield-alert');
    expect(q).toContain('data-tone="danger"');
  });

  it('EventChip erişilebilir adı kesilmemiş tam bilgiyi taşır', () => {
    const markup = renderToStaticMarkup(
      createElement(EventChip, {
        type: 'hearing',
        typeLabel: 'Örnek tür',
        title: 'Örnek başlık',
        accessibleLabel: 'Örnek tür, 09:30, Örnek başlık',
      }),
    );
    expect(markup).toContain('class="sr-only">Örnek tür, 09:30, Örnek başlık');
    expect(markup).toContain('lucide-gavel');
    expect(markup).toContain('border-l-4');
  });
});
