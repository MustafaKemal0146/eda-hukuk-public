// @tk TK-17
// data-sources parçası (022 §5.4): `SourceItem.fetchedAt` kaynağın getirildiği an (ISO 8601, saat
// dilimli) ve isteğe bağlıdır; arayüz erişim tarihini buradan (Europe/Istanbul) türetir. Gün-only
// veya biçimsiz değer reddedilir; alan yoksa parça yine geçerlidir (eski kayıtlar). Veriler sentetiktir.
import { describe, expect, it } from 'vitest';
import { SourceItem, SourcesData } from '../src/stream/data-parts.ts';

const BASE = {
  ref: 'K1',
  kind: 'decision',
  sourceId: 'bedesten:990001',
  shortKunye: 'Örnek HD 2000/1 E.',
  title: 'Örnek karar',
  origin: 'live',
  portal: 'bedesten',
  retrievedAt: '2026-10-16',
  relevance: 'high',
} as const;

describe('SourceItem.fetchedAt (erişim anı)', () => {
  it('ISO 8601 saat dilimli an kabul edilir (Z ve ofset)', () => {
    expect(SourceItem.parse({ ...BASE, fetchedAt: '2026-10-16T22:30:00.000Z' }).fetchedAt).toBe(
      '2026-10-16T22:30:00.000Z',
    );
    expect(SourceItem.safeParse({ ...BASE, fetchedAt: '2026-10-17T01:30:00+03:00' }).success).toBe(
      true,
    );
  });

  it('alan isteğe bağlıdır; gün-only veya serbest metin reddedilir', () => {
    expect(SourceItem.safeParse(BASE).success).toBe(true);
    expect(SourceItem.safeParse({ ...BASE, fetchedAt: '2026-10-16' }).success).toBe(false);
    expect(SourceItem.safeParse({ ...BASE, fetchedAt: '17.10.2026' }).success).toBe(false);
    expect(SourceItem.safeParse({ ...BASE, fetchedAt: '' }).success).toBe(false);
  });

  it('data-sources parçası fetchedAt taşır', () => {
    const parsed = SourcesData.parse({
      sources: [
        { ...BASE, fetchedAt: '2026-10-16T22:30:00Z' },
        { ...BASE, ref: 'K2' },
      ],
    });
    expect(parsed.sources.map((s) => s.fetchedAt)).toEqual(['2026-10-16T22:30:00Z', undefined]);
  });
});
