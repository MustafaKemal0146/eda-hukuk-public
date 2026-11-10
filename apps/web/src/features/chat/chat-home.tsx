'use client';
// Sohbet karşılama ekranı (053-02 boş durum): selamlama, istem kutusu, hızlı başlangıçlar, yasal uyarı.
// Gönderimde sohbet oluşturulur, ilk mesaj bekletilir ve `/sohbet/[conversationId]`e geçilir; mesajı
// sohbet ekranı bir kez gönderir (053-02 §1.4). Oluşturma başarısızsa metin korunur, hata gösterilir.
import { Icon, type IconName, NoticeBanner } from '@eda/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { type ApiErrorInfo, errorInfoOf } from '../../lib/api-error.ts';
import { authTargetFor } from '../../lib/auth-redirect.ts';
import { createConversation } from '../../lib/conversations.ts';
import { stashDraft, takeDraft } from '../../lib/draft-stash.ts';
import { onSessionEnded } from '../../lib/session-guard.ts';
import { readyParts, useChatAttachments } from './attachments.ts';
import { ALIAS_BY_MODE } from './chat-request.ts';
import { Composer, type ComposerMode } from './composer.tsx';
import { greetingPeriod, greetingVariant } from './greeting.ts';
import { setPendingFirstMessage } from './pending-message.ts';

const STARTERS: readonly {
  key: 'petition' | 'precedent' | 'statute' | 'contract';
  icon: IconName;
}[] = [
  { key: 'petition', icon: 'nav.documents' },
  { key: 'precedent', icon: 'nav.decisions' },
  { key: 'statute', icon: 'nav.legislation' },
  { key: 'contract', icon: 'nav.kunye-check' },
];

const PILLARS = ['sources', 'deadlines', 'privacy'] as const;

export function ChatHome() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [greetingKey, setGreetingKey] = useState<string | null>(null);
  // Sohbet henüz yok: ekler bağsız yüklenir, sunucu ilk turda sohbete bağlar (K3).
  const attachments = useChatAttachments();
  // Oturum bitince yazılmış (veya gönderilirken yarıda kalan) metin sekmeye geçici saklanır; girişten
  // dönüşte geri gelir.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const startedText = useRef<string | null>(null);
  useEffect(() => {
    const restored = takeDraft('/sohbet');
    if (restored !== null) setDraft(restored);
    return onSessionEnded(() => stashDraft('/sohbet', startedText.current ?? draftRef.current));
  }, []);

  // Karşılama cümlesi yalnız istemcide, yerel saat dilimine göre seçilir. Sunucu ve ilk istemci
  // render'ında `chat.greeting` gösterilir; böylece hydration uyuşmazlığı olmaz (#56).
  useEffect(() => {
    const now = new Date();
    const period = greetingPeriod(now.getHours());
    const variant = greetingVariant(now.getFullYear(), now.getMonth() + 1, now.getDate());
    setGreetingKey(`chat.greetings.${period}.${variant}`);
  }, []);

  const start = async (text: string, mode: ComposerMode): Promise<void> => {
    if (creating) return;
    setCreating(true);
    setError(null);
    startedText.current = text;
    try {
      const id = await createConversation();
      startedText.current = null;
      const files = readyParts(attachments.items);
      setPendingFirstMessage(id, {
        text,
        alias: ALIAS_BY_MODE[mode],
        ...(files.length > 0 ? { files } : {}),
      });
      router.push(`/sohbet/${id}`);
    } catch (err) {
      const info = errorInfoOf(err);
      const to = authTargetFor(info, '/sohbet');
      if (to) router.replace(to);
      else setError(info);
      setCreating(false);
    }
  };
  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-chat flex-1 flex-col justify-center gap-6 px-4 py-10 md:py-16">
        <div className="flex flex-col gap-2">
          <p className="text-body-sm text-fg-subtle">{t('chat.eyebrow')}</p>
          <h1 className="font-display text-heading-lg text-fg md:text-display">
            {greetingKey ? t(greetingKey) : t('chat.greeting')}
          </h1>
        </div>

        <div className="flex flex-col gap-3">
          {error && (
            <NoticeBanner tone="danger" role="alert">
              {error.code === 'CLIENT_NETWORK'
                ? t('chat.error.network')
                : (error.message ?? t('chat.error.createFailed'))}
              {error.requestId && (
                <span className="block text-caption">
                  {t('chat.error.supportCode', { code: error.requestId })}
                </span>
              )}
            </NoticeBanner>
          )}
          <Composer
            autoFocus
            value={draft}
            onValueChange={setDraft}
            busy={creating}
            attachments={{
              items: attachments.items,
              onAdd: attachments.add,
              onRemove: attachments.remove,
            }}
            onSubmit={(text, mode) => void start(text, mode)}
          />
          <ul aria-label={t('chat.startersLabel')} className="flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => setDraft(t(`chat.suggestions.${s.key}.body`))}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-body-sm text-fg-muted transition-colors duration-fast hover:border-primary-soft-border hover:bg-surface-sunken hover:text-fg focus-visible:focus-ring"
                >
                  <Icon icon={s.icon} size="sm" className="text-fg-subtle" />
                  {t(`chat.suggestions.${s.key}.title`)}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <dl className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p} className="bg-surface p-4">
              <dt className="text-body-sm font-medium text-fg">{t(`chat.pillars.${p}.title`)}</dt>
              <dd className="mt-1 text-caption text-fg-muted">{t(`chat.pillars.${p}.body`)}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mx-auto max-w-chat px-4 pb-4 text-center text-caption text-fg-subtle">
        {t('legal.mandatory.y86')}
      </p>
    </div>
  );
}
