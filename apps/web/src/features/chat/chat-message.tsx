'use client';
// Mesaj görünümleri (052 §5.1; 053-02 §5.1-§5.2). Kullanıcı: sağda nötr baloncuk, düz metin. Asistan:
// başlık (marka, saat, sağlayıcı rozeti) -> ajan hattı -> erişim uyarıları -> metin -> alt satır
// (kaynak sayısı, durum, eylemler). Akış sürerken eylemler çizilmez.
import { AI_PROVIDER_IDS, type AiProviderId } from '@eda/contracts/enums';
import type { NoticeData, SourceItem } from '@eda/contracts/stream';
import { Button, Icon, IconButton, NoticeBanner, ProviderBadge, Textarea } from '@eda/ui';
import { Message, MessageActions } from '@eda/ui/ai-elements';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { attachmentNamesOf } from './attachment-parts.ts';
import {
  type EdaUIMessage,
  maskedCountOf,
  messageNotices,
  messageText,
  splitMessageText,
} from './chat-types.ts';
import { DocumentCard } from './document-card.tsx';
import { splitDocuments } from './documents.ts';
import { type CitationContextValue, MessageContent } from './message-content.tsx';
import { PipelineBar, PipelineSummaryStatic } from './pipeline-bar.tsx';
import type { PipelineState } from './pipeline-store.ts';

const TIME = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

/** Kabukta (şerit) veya hiç gösterilmeyen bildirimler; diğerleri mesaj üstü uyarıdır. */
const NOT_INLINE: ReadonlySet<NoticeData['code']> = new Set([
  'simulation',
  'beta_synthetic',
  'masking_applied',
]);

/** "Kopyalandı" geri bildiriminin ekranda kalma süresi (kısa, sayfa akışını bozmaz). */
const COPIED_FEEDBACK_MS = 1500;

export type UserMessageProps = {
  message: EdaUIMessage;
  /** Mesaj metnini panoya kopyalar; `true` = başarılı (kısa "Kopyalandı" geri bildirimi çizilir). */
  onCopy?: () => Promise<boolean>;
  /**
   * Düzenlenen metni yeniden gönderir: bu mesaj ve sonrasındaki tüm mesajlar sohbetten kalkar, yanıt
   * yeniden üretilir. Akış sürerken çağıran taraf vermez (düzenleme kapalı).
   */
  onEdit?: (text: string) => void;
};

export function UserMessage({ message, onCopy, onEdit }: UserMessageProps) {
  const t = useTranslations('chat.message');
  const text = messageText(message);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [copied, setCopied] = useState(false);
  const editId = useId();
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copy = async (): Promise<void> => {
    if (!onCopy) return;
    const ok = await onCopy();
    if (!ok) return;
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };
  const startEdit = (): void => {
    setDraft(text);
    setEditing(true);
  };
  const cancelEdit = (): void => {
    setEditing(false);
    setDraft(text);
  };
  const empty = draft.trim() === '';
  const submitEdit = (): void => {
    if (!onEdit || empty) return;
    setEditing(false);
    onEdit(draft.trim());
  };

  if (editing && onEdit) {
    // Yerinde düzenleme: istem kutusuyla aynı kabuk (composer); Enter gönderir, Shift+Enter satır, Esc iptal.
    return (
      <form
        aria-label={t('editLabel')}
        onSubmit={(e) => {
          e.preventDefault();
          submitEdit();
        }}
        className="ml-auto w-full max-w-prose rounded-xl border border-border bg-surface shadow-2 transition-colors duration-fast focus-within:border-border-strong"
      >
        <label htmlFor={editId} className="sr-only">
          {t('editLabel')}
        </label>
        <Textarea
          id={editId}
          autoGrow
          autoFocus
          maxRows={10}
          rows={2}
          value={draft}
          aria-describedby={`${editId}-hint`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submitEdit();
            }
          }}
          bare
          className="min-h-16 px-4 pt-3.5 text-body"
        />
        <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5">
          <p id={`${editId}-hint`} className="text-caption text-fg-subtle">
            {t('editHint')}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
              {t('editCancel')}
            </Button>
            <IconButton
              type="submit"
              icon="action.send"
              label={t('editSend')}
              variant="primary"
              disabled={empty}
              aria-keyshortcuts="Enter"
              className="disabled:border-disabled-bg disabled:bg-disabled-bg disabled:shadow-none"
            />
          </div>
        </div>
      </form>
    );
  }

  const actions = onCopy || onEdit;
  // Ek adları yalnız kullanıcının kendi görünümünde (K4; log/başlık/analitiğe yazılmaz).
  const files = attachmentNamesOf(message.parts);
  return (
    <div className="group flex flex-col items-end gap-1">
      {files.length > 0 && (
        <ul
          aria-label={t('attachmentsLabel')}
          className="flex max-w-prose flex-wrap justify-end gap-1.5"
        >
          {files.map((name, i) => (
            <li
              key={`${i}:${name}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-caption text-fg-muted"
            >
              <Icon icon="action.attach" size="sm" />
              <span className="truncate" title={name}>
                {t('attachment', { name })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Message from="user" label={t('userLabel')}>
        <p className="whitespace-pre-wrap break-words">{text}</p>
      </Message>
      {actions && (
        // Eylemler üzerine gelince veya odaklanınca görünür; dokunmatikte (hover yok) hep görünür.
        <fieldset
          aria-label={t('userActions')}
          className="invisible m-0 flex items-center gap-0.5 border-0 p-0 group-hover:visible focus-within:visible pointer-coarse:visible"
        >
          {copied && (
            <span role="status" className="text-caption text-fg-muted">
              {t('copied')}
            </span>
          )}
          {onCopy && (
            <IconButton
              icon="action.copy"
              label={t('copy')}
              size="sm"
              onClick={() => void copy()}
            />
          )}
          {onEdit && (
            <IconButton icon="document.draft" label={t('edit')} size="sm" onClick={startEdit} />
          )}
        </fieldset>
      )}
    </div>
  );
}

function isProviderId(v: string): v is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(v);
}

function ProviderLine({ message }: { message: EdaUIMessage }) {
  const t = useTranslations('chat.provider');
  const meta = message.metadata;
  const providerId = meta?.providerId;
  if (!meta?.region || !providerId || !isProviderId(providerId)) return null;
  const providerName = t(`names.${providerId}`);
  // Takma ad varsa görünen metin yalnız "Hızlı/Derin model" olur; işlem yeri, sağlayıcı ve ayrıntılı
  // model adı silinmez, ikincil olur ve üzerine gelince (`title`) görünür (#10). Simülasyonda eski
  // davranış korunur (takma ad yok; SİMÜLASYON rozeti).
  const alias = providerId !== 'mock' && meta.alias ? t(`alias.${meta.alias}`) : null;
  return (
    <>
      <span
        title={[
          providerName,
          meta.modelLabel,
          t('location', { region: t(`regions.${meta.region}`), provider: providerName }),
        ]
          .filter(Boolean)
          .join(' · ')}
      >
        <ProviderBadge
          region={meta.region}
          providerId={providerId}
          {...(alias === null && meta.modelLabel && providerId !== 'mock'
            ? { modelLabel: meta.modelLabel }
            : {})}
          labels={{
            // Simülasyonda sağlayıcı adı bölgeyle aynıdır; yinelenmez.
            location:
              alias !== null
                ? t('locationAliasOnly', { alias })
                : providerId === 'mock'
                  ? t('locationOnly', { region: t(`regions.${meta.region}`) })
                  : t('location', {
                      region: t(`regions.${meta.region}`),
                      provider: providerName,
                    }),
            simulation: t('simulation'),
          }}
        />
      </span>
      {meta.keySource === 'platform' && (
        <span className="text-caption text-fg-subtle" title={t('keySource.platformHint')}>
          {t('keySource.platform')}
        </span>
      )}
    </>
  );
}

export type AssistantMessageProps = {
  /** `null`: istek açıldı, asistan mesajı henüz gelmedi (yer tutucu). */
  message: EdaUIMessage | null;
  streaming: boolean;
  stopped: boolean;
  pipeline: PipelineState | null;
  sources: readonly SourceItem[];
  citations: CitationContextValue;
  onShowSources?: () => void;
  onCopy?: () => void;
  /**
   * Son asistan yanıtını yeniden üretir (022 §2.1). Yalnız yeniden üretilebilir tek yanıt için
   * verilir; tur sürerken çağıran taraf vermez (eylem çubuğu çizilmez).
   */
  onRegenerate?: () => void;
  /** Yanıtı Word'e (.docx) aktarır; yoksa düğme çizilmez. */
  onExport?: () => void;
  /** Belge kartı tıklanınca (belge sırası); yoksa kartlar çizilmez, metin düz akar. */
  onOpenDocument?: (index: number) => void;
  /** Panelde açık belgenin sırası (bu mesajda); yoksa null. */
  activeDocument?: number | null;
};

export function AssistantMessage({
  message,
  streaming,
  stopped,
  pipeline,
  sources,
  citations,
  onShowSources,
  onCopy,
  onRegenerate,
  onExport,
  onOpenDocument,
  activeDocument = null,
}: AssistantMessageProps) {
  const t = useTranslations('chat');
  const startedAt = message?.metadata?.startedAt;
  const time = startedAt ? TIME.format(new Date(startedAt)) : null;
  const { notes, answer: text } = message ? splitMessageText(message) : { notes: [], answer: '' };
  const notices = message ? messageNotices(message).filter((n) => !NOT_INLINE.has(n.code)) : [];
  const label = time ? t('message.assistantLabelAt', { time }) : t('message.assistantLabel');
  const maskedCount = message ? maskedCountOf(message) : 0;
  const segments = splitDocuments(text);
  const lastIndex = segments.length - 1;

  return (
    <Message
      from="assistant"
      label={label}
      header={
        <>
          <span className="text-body-sm font-medium text-fg">{t('message.author')}</span>
          {time && startedAt && <time dateTime={new Date(startedAt).toISOString()}>{time}</time>}
          {message && <ProviderLine message={message} />}
        </>
      }
      footer={
        !streaming && message ? (
          <div className="flex flex-wrap items-center gap-2">
            {stopped && (
              <span className="inline-flex items-center gap-1.5 text-caption text-fg-muted">
                <Icon icon="message.stopped" size="sm" />
                {t('message.stopped')}
              </span>
            )}
            {maskedCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-caption text-fg-muted">
                {t('message.masked', { count: maskedCount })}
              </span>
            )}
            {sources.length > 0 && onShowSources && (
              <Button variant="ghost" size="sm" leadingIcon="nav.decisions" onClick={onShowSources}>
                {t('sources.showCount', { count: sources.length })}
              </Button>
            )}
            {(onCopy && text !== '') || onRegenerate || (onExport && text !== '') ? (
              <MessageActions
                className="ml-auto"
                {...(onCopy && text !== '' ? { onCopy } : {})}
                {...(onRegenerate ? { onRegenerate } : {})}
                {...(onExport && text !== '' ? { onExport } : {})}
                labels={{
                  group: t('message.actions'),
                  copy: t('message.copy'),
                  regenerate: t('message.regenerate'),
                  like: t('message.like'),
                  dislike: t('message.dislike'),
                  export: t('message.exportWord'),
                }}
              />
            ) : null}
          </div>
        ) : undefined
      }
    >
      {pipeline ? (
        <PipelineBar state={pipeline} />
      ) : (
        !streaming && <PipelineSummaryStatic sourceCount={sources.length} />
      )}
      {notes.length > 0 && (
        <ul
          aria-label={t('message.workNotes')}
          className="flex flex-col gap-1 border-l-2 border-border pl-3"
        >
          {notes.map((n, i) => (
            <li key={i} className="text-body-sm text-fg-muted">
              {n.replace(/\[(K\d+)\]/g, '$1')}
            </li>
          ))}
        </ul>
      )}
      {notices.map((n) => (
        <NoticeBanner
          key={n.code}
          tone={n.level === 'error' ? 'danger' : n.level === 'warning' ? 'warning' : 'info'}
          role={n.level === 'error' ? 'alert' : 'status'}
        >
          {n.message}
        </NoticeBanner>
      ))}
      {segments.map((seg, i) =>
        seg.type === 'document' && onOpenDocument ? (
          <DocumentCard
            key={`d${seg.index}`}
            block={seg}
            active={activeDocument === seg.index}
            onOpen={() => onOpenDocument(seg.index)}
          />
        ) : (seg.type === 'text' ? seg.value : seg.body).trim() !== '' ? (
          <MessageContent
            key={`t${i}`}
            text={seg.type === 'text' ? seg.value : seg.body}
            streaming={streaming && i === lastIndex}
            citations={citations}
          />
        ) : null,
      )}
    </Message>
  );
}
