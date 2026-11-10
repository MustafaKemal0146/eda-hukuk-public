'use client';
// Kenar çubuğu (053 kabuk): marka, yeni sohbet + arama, gruplu gezinme, son sohbetler, hesap satırı.
import { AlertDialog, Button, Icon, Kbd, NavItem } from '@eda/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { errorInfoOf } from '../../lib/api-error.ts';
import {
  type ConversationSummary,
  deleteConversation,
  refreshRecentConversations,
  useRecentConversations,
} from '../../lib/conversations.ts';
import { AccountBlock } from './account-block.tsx';
import { isActive, NAV_GROUPS, SECONDARY_NAV } from './nav.ts';

/** Kenar çubuğunda gösterilen son sohbet sayısı (053-02 §2.2 `ui.conversationListPageSize` başlangıç
 * varsayılanı 20; sayfalama P09a ile gelir). */
const RECENT_LIMIT = 20;
const CHAT_HREF = '/sohbet';

export function Brand({ href = '/sohbet' }: { href?: string }) {
  const t = useTranslations('common');
  return (
    <Link
      href={href}
      className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:focus-ring"
    >
      <span className="truncate font-display text-title font-semibold tracking-tight text-fg">
        {t('brand')}
      </span>
    </Link>
  );
}

export function Sidebar({
  onNavigate,
  onOpenPalette,
}: {
  onNavigate?: () => void;
  onOpenPalette?: () => void;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const recent = useRecentConversations();
  const [toDelete, setToDelete] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<'blocked' | 'streaming' | 'failed' | null>(null);

  async function confirmDelete() {
    if (!toDelete) return;
    const target = toDelete;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteConversation(target.id);
      setToDelete(null);
      // Açık olan sohbet silindiyse boş bir sohbet ekranına dönülür.
      if (pathname === `${CHAT_HREF}/${target.id}`) router.push(CHAT_HREF);
    } catch (error) {
      setToDelete(null);
      const code = errorInfoOf(error).code;
      if (code === 'CHAT_DELETE_BLOCKED') {
        setDeleteError('blocked');
      } else if (code === 'CHAT_STREAM_IN_PROGRESS') {
        setDeleteError('streaming');
      } else if (code === 'CHAT_CONVERSATION_NOT_FOUND') {
        // Başka yerden zaten silinmiş: listeyi sunucuyla eşitle.
        void refreshRecentConversations();
      } else {
        setDeleteError('failed');
      }
    } finally {
      setDeleting(false);
    }
  }
  const items = recent.items.slice(0, RECENT_LIMIT);
  // Aynı anda tek `aria-current`: açık sohbet listede ise "Sohbetler" öğesi etkin sayılmaz.
  const conversationActive = items.some((c) => pathname === `${CHAT_HREF}/${c.id}`);
  return (
    <nav aria-label={t('nav.label')} id="ana-gezinme" className="flex h-full flex-col">
      <div className="flex h-topbar shrink-0 items-center px-3">
        <Brand />
      </div>

      <div className="flex flex-col gap-1 px-2 pb-2">
        <Link
          href="/sohbet"
          onClick={onNavigate}
          className="flex min-h-control-md items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-body-sm font-medium text-fg shadow-1 transition-colors duration-fast hover:bg-surface-sunken focus-visible:focus-ring"
        >
          <Icon icon="nav.new-chat" size="sm" className="text-fg-muted" />
          <span className="flex-1">{t('nav.newChat')}</span>
        </Link>
        {onOpenPalette && (
          <button
            type="button"
            onClick={onOpenPalette}
            aria-keyshortcuts="Control+K Meta+K"
            className="flex min-h-sidebar-item items-center gap-2.5 rounded-md px-2 text-left text-body-sm text-fg-muted transition-colors duration-fast hover:bg-primary-soft hover:text-fg focus-visible:focus-ring-inset"
          >
            <Icon icon="nav.search" size="sm" className="text-fg-subtle" />
            <span className="flex-1">{t('nav.search')}</span>
            <Kbd>{t('topbar.searchShortcut')}</Kbd>
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-2">
        {NAV_GROUPS.map((group) => (
          <section key={group.key} aria-labelledby={`nav-${group.key}`}>
            <h2 id={`nav-${group.key}`} className="px-2 pb-1 text-caption text-fg-subtle">
              {t(`nav.groups.${group.key}`)}
            </h2>
            <ul className="flex flex-col gap-px">
              {group.items.map((n) => (
                <li key={n.href}>
                  <NavItem
                    icon={n.icon}
                    label={t(`nav.${n.labelKey}`)}
                    active={
                      isActive(pathname, n.href) && !(n.href === CHAT_HREF && conversationActive)
                    }
                    render={<Link href={n.href} onClick={onNavigate} />}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section aria-labelledby="son-sohbetler">
          <h2 id="son-sohbetler" className="px-2 pb-1 text-caption text-fg-subtle">
            {t('nav.recent')}
          </h2>
          {deleteError !== null && (
            <p role="alert" className="px-2 pb-1 text-caption text-danger">
              {t(`nav.deleteError.${deleteError}`)}
            </p>
          )}
          {recent.state === 'error' && (
            <div role="status" className="flex flex-col items-start gap-1 px-2 pb-1">
              <p className="text-caption text-fg-subtle">{t('nav.recentError')}</p>
              <Button
                variant="ghost"
                size="sm"
                leadingIcon="action.retry"
                onClick={() => void refreshRecentConversations()}
              >
                {t('nav.recentRetry')}
              </Button>
            </div>
          )}
          {items.length === 0 ? (
            recent.state !== 'error' && (
              <p className="px-2 text-caption text-fg-subtle">{t('nav.recentEmpty')}</p>
            )
          ) : (
            <ul className="flex flex-col gap-px">
              {items.map((c) => {
                const href = `${CHAT_HREF}/${c.id}`;
                const active = pathname === href;
                return (
                  <li key={c.id} className="group relative">
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={
                        active
                          ? 'flex min-h-sidebar-item items-center rounded-md bg-primary-soft py-0 pr-10 pl-2 text-body-sm font-medium text-fg focus-visible:focus-ring-inset pointer-coarse:min-h-11'
                          : 'flex min-h-sidebar-item items-center rounded-md py-0 pr-10 pl-2 text-body-sm text-fg-muted transition-colors duration-fast hover:bg-primary-soft hover:text-fg focus-visible:focus-ring-inset pointer-coarse:min-h-11'
                      }
                    >
                      <span className="truncate">{c.title ?? t('nav.untitledChat')}</span>
                    </Link>
                    <button
                      type="button"
                      aria-label={`${t('nav.deleteChat')}: ${c.title ?? t('nav.untitledChat')}`}
                      onClick={() => {
                        setDeleteError(null);
                        setToDelete(c);
                      }}
                      className="absolute top-1/2 right-1 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-danger invisible hover:bg-danger-soft focus-visible:focus-ring group-focus-within:visible group-hover:visible pointer-coarse:visible pointer-coarse:size-9"
                    >
                      <Icon icon="action.delete" size="sm" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-px border-t border-border px-2 py-2">
        <ul className="flex flex-col gap-px">
          {SECONDARY_NAV.map((n) => (
            <li key={n.href}>
              <NavItem
                icon={n.icon}
                label={t(`nav.${n.labelKey}`)}
                active={isActive(pathname, n.href)}
                render={<Link href={n.href} onClick={onNavigate} />}
              />
            </li>
          ))}
          <li>
            <NavItem
              icon="nav.support"
              label={t('nav.support')}
              render={<a href="mailto:destek@eda.localhost" />}
            />
          </li>
        </ul>
        <AccountBlock onNavigate={onNavigate} />
      </div>
      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setToDelete(null);
        }}
        title={t('nav.deleteDialog.title')}
        description={t('nav.deleteDialog.description', {
          title: toDelete?.title ?? t('nav.untitledChat'),
        })}
        impact={t('nav.deleteDialog.impact')}
        cancelLabel={t('nav.deleteDialog.cancel')}
        destructiveLabel={t('nav.deleteDialog.confirm')}
        confirmLoading={deleting}
        confirmLoadingLabel={t('nav.deleteDialog.confirm')}
        onConfirm={() => void confirmDelete()}
      />
    </nav>
  );
}
