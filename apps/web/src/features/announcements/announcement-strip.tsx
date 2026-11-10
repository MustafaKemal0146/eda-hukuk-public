'use client';
// Platform duyuru şeridi (053 kabuk; duyuru modülü): etkin duyuruları içerik yüzeyinin üstünde gösterir.
// Salt okur ve kapatılabilir (oturum içinde kalıcı: sessionStorage). Hata veya boş yanıtta hiçbir şey
// çizilmez (şerit bir yardımcıdır, sayfayı engellemez). Metin düz metindir; HTML işlenmez.
// Yenileme: açılışta ve pencere odağa dönünce (aralıklı yoklama yok).
import type { AnnouncementDtoValue } from '@eda/contracts/api/announcements';
import { IconButton, NoticeBanner } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { documentsApi } from '../studio/documents-api.ts';
import {
  readDismissed,
  roleFor,
  SEVERITY_TONE,
  visibleOf,
  writeDismissed,
} from './announcement-model.ts';

const store = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export function AnnouncementStrip() {
  const t = useTranslations('announcements');
  const [items, setItems] = useState<AnnouncementDtoValue[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await documentsApi.announcements.active();
      setItems(r.items);
      setDismissed(readDismissed(store()));
    } catch {
      // Duyuru alınamadı: şerit çizilmez.
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const shown = visibleOf(items, dismissed);
  if (shown.length === 0) return null;

  const dismiss = (id: string) => {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    writeDismissed(
      store(),
      next,
      items.map((a) => a.id),
    );
  };

  return (
    <section aria-label={t('region')} className="flex shrink-0 flex-col gap-2 px-3 pt-2 md:px-4">
      {shown.map((a) => (
        <NoticeBanner
          key={a.id}
          tone={SEVERITY_TONE[a.severity]}
          role={roleFor(a.severity)}
          title={a.title}
          action={
            <IconButton icon="action.close" label={t('dismiss')} onClick={() => dismiss(a.id)} />
          }
        >
          <span className="whitespace-pre-line">{a.body}</span>
        </NoticeBanner>
      ))}
    </section>
  );
}
