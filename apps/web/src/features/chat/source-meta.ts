'use client';
// Kaynak künyesi yanındaki portal adı ve erişim tarihi (052 §6.3): hem kaynak panelinde hem `[K#]`
// çipinin görünür/erişilebilir metninde aynı veriden türer. Tarih `fetchedAt` (ISO an) varsa
// Europe/Istanbul gününe çevrilir; yoksa kaynağın bildirdiği `retrievedAt` günü yazılır. Tarih yoksa
// uydurulmaz, bölüm düşer. Portal adı yalnız `tr` kataloğundan gelir (iç kod anahtarı gösterilmez).
import type { SourceItem } from '@eda/contracts/stream';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { formatIsoDate } from '../../lib/research-ui.tsx';

const ISTANBUL_DATE = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Erişim tarihi `GG.AA.YYYY` (Europe/Istanbul); geçersiz/eksik ise null. */
export function accessDateOf(
  source: Pick<SourceItem, 'retrievedAt'> & { fetchedAt?: string | undefined },
): string | null {
  if (source.fetchedAt) {
    const t = new Date(source.fetchedAt);
    if (!Number.isNaN(t.getTime())) return ISTANBUL_DATE.format(t);
  }
  return formatIsoDate(source.retrievedAt || null);
}

export type SourceMeta = { portal: string; date: string | null };

/** Portal adı (katalog) + erişim tarihi; bilinmeyen portal "Resmî kaynak". */
export function useSourceMeta(): (
  source: Pick<SourceItem, 'portal' | 'retrievedAt'> & {
    fetchedAt?: string | undefined;
    kind?: SourceItem['kind'];
  },
) => SourceMeta {
  const t = useTranslations('chat.sources');
  return useCallback(
    (source) => {
      // Sohbete eklenen evrak resmî kaynak değildir (P21 ilk dilimi).
      if (source.kind === 'case_file') {
        return { portal: t('portals.caseFile'), date: accessDateOf(source) };
      }
      const key = `portals.${source.portal ?? 'other'}`;
      const portal = t.has(key as Parameters<typeof t.has>[0])
        ? t(key as Parameters<typeof t>[0])
        : t('portals.other');
      return { portal, date: accessDateOf(source) };
    },
    [t],
  );
}
