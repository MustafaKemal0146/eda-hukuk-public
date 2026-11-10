'use client';
// Künye çipi erişilebilir adı (052 §6.1; 025 §12.2): "Kaynak: {künye} ({portal}, erişim {tarih}).
// Durum: {etiket}." Durum gelmeden (akış sürerken) "Durum" kısmı yok; kaynak verisi verilmezse portal
// ve tarih kısmı yok. Etiketler 003 §4.2 katalog metinleridir. `out_of_context` durumunda neden
// `quote_mismatch` ise etiket "Alıntı kaynakta bulunamadı" olur (052 §6.2; kaynak bu sohbette getirildi).
import type { KunyeStatus } from '@eda/contracts/enums';
import type { CitationItem, SourceItem } from '@eda/contracts/stream';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useSourceMeta } from './source-meta.ts';

export type ChipSourceInfo = Pick<SourceItem, 'portal' | 'retrievedAt' | 'fetchedAt'>;

export type CitationReason = NonNullable<CitationItem['reason']>;

export type ChipLabel = (
  shortKunye: string,
  status: KunyeStatus | undefined,
  source?: ChipSourceInfo,
  reason?: CitationReason,
) => string;

/** Çipte görünen portal + erişim metni ("UYAP, erişim 17.10.2026"); tarih yoksa yalnız portal. */
export function useChipMeta(): (source: ChipSourceInfo) => string {
  const t = useTranslations('chat');
  const sourceMeta = useSourceMeta();
  return useCallback(
    (source) => {
      const m = sourceMeta(source);
      return m.date ? t('chip.meta', { portal: m.portal, date: m.date }) : m.portal;
    },
    [t, sourceMeta],
  );
}

export function useChipLabel(): ChipLabel {
  const t = useTranslations('chat');
  const chipMeta = useChipMeta();
  return useCallback(
    (shortKunye, status, source, reason) => {
      // "2000/1 E." gibi noktayla biten künyede cümle noktası yinelenmez.
      const kunye = shortKunye.endsWith('.') ? shortKunye.slice(0, -1) : shortKunye;
      const meta = source ? chipMeta(source) : null;
      if (status) {
        const statusText =
          status === 'out_of_context' && reason === 'quote_mismatch'
            ? t('citationReason.quote_mismatch')
            : t(`citationStatus.${status}`);
        return meta
          ? t('chip.labelMeta', { kunye, meta, status: statusText })
          : t('chip.label', { kunye, status: statusText });
      }
      return meta
        ? t('chip.labelMetaNoStatus', { kunye: shortKunye, meta })
        : t('chip.labelNoStatus', { kunye: shortKunye });
    },
    [t, chipMeta],
  );
}
