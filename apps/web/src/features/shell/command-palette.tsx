'use client';
// Komut paleti (Ctrl/Cmd+K): sayfalar ve eylemler arasında klavyeyle gezinme. Seçim listbox kalıbıyla
// (aria-activedescendant); odak giriş alanında kalır.
import { Dialog, Icon, type IconName, Kbd } from '@eda/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { PRIMARY_NAV, SECONDARY_NAV } from './nav.ts';
import { applyUiPrefs, readUiPrefs } from './ui-prefs.ts';

type Command = {
  id: string;
  label: string;
  icon: IconName;
  group: 'pages' | 'actions';
  run: () => void;
};

function fold(text: string): string {
  return text.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '');
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const go = useCallback(
    (href: string) => () => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  const commands = useMemo<Command[]>(() => {
    const pages = [...PRIMARY_NAV, ...SECONDARY_NAV].map((n) => ({
      id: n.href,
      label: t(`nav.${n.labelKey}`),
      icon: n.icon,
      group: 'pages' as const,
      run: go(n.href),
    }));
    const theme = (value: 'light' | 'dark' | 'system'): Command => ({
      id: `theme-${value}`,
      label: `${t('theme.label', { current: t(`theme.${value}`) })}`,
      icon: `theme.${value}`,
      group: 'actions',
      run: () => {
        applyUiPrefs({ ...readUiPrefs(), theme: value });
        onOpenChange(false);
      },
    });
    return [
      {
        id: 'new-chat',
        label: t('nav.newChat'),
        icon: 'nav.new-chat',
        group: 'actions',
        run: go('/sohbet'),
      },
      ...pages,
      theme('light'),
      theme('dark'),
      theme('system'),
    ];
  }, [go, onOpenChange, t]);

  const results = useMemo(() => {
    const q = fold(query.trim());
    return q === '' ? commands : commands.filter((c) => fold(c.label).includes(q));
  }, [commands, query]);

  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      results[active]?.run();
    }
  };

  const groups = (['actions', 'pages'] as const)
    .map((g) => ({ g, items: results.filter((r) => r.group === g) }))
    .filter((x) => x.items.length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('palette.title')}
      hideTitle
      placement="top"
      size="md"
      labels={{ close: t('common.close') }}
    >
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Icon icon="nav.search" size="md" className="text-fg-muted" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
          aria-label={t('palette.placeholder')}
          placeholder={t('palette.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-control-lg flex-1 bg-transparent pr-12 text-body text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={t('palette.title')}
        className="max-h-96 overflow-y-auto p-2"
      >
        {results.length === 0 && (
          <p className="px-3 py-6 text-center text-body-sm text-fg-muted">{t('palette.empty')}</p>
        )}
        {groups.map(({ g, items }) => (
          // biome-ignore lint/a11y/useSemanticElements: ARIA listbox içindeki seçenek grubu; fieldset form denetimi içindir.
          <div
            key={g}
            role="group"
            aria-label={t(g === 'pages' ? 'palette.groupPages' : 'palette.groupActions')}
          >
            <p className="px-3 pt-3 pb-1 text-caption font-semibold tracking-wide text-fg-muted uppercase">
              {t(g === 'pages' ? 'palette.groupPages' : 'palette.groupActions')}
            </p>
            {items.map((c) => {
              const index = results.indexOf(c);
              const selected = index === active;
              return (
                <div
                  key={c.id}
                  id={`${listId}-${c.id}`}
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  onMouseMove={() => setActive(index)}
                  onClick={c.run}
                  onKeyDown={undefined}
                  className={`flex min-h-control-md cursor-pointer items-center gap-3 rounded-md px-3 text-label ${
                    selected ? 'bg-primary-soft text-primary-soft-fg' : 'text-fg'
                  }`}
                >
                  <Icon icon={c.icon} size="sm" />
                  <span className="flex-1">{c.label}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2 text-caption text-fg-muted">
        <Kbd>Enter</Kbd>
        <span>{t('palette.hint')}</span>
      </div>
    </Dialog>
  );
}
