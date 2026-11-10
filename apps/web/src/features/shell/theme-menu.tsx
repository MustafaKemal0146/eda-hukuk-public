'use client';
// Tema seçici (051 §14): küçük menü, üç radyo öğesi; düğme adı geçerli durumu içerir.
import { DropdownMenu, DropdownMenuRadioGroup, IconButton } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { applyUiPrefs, readUiPrefs, subscribeUiPrefs, type Theme } from './ui-prefs.ts';

const ICON = { light: 'theme.light', dark: 'theme.dark', system: 'theme.system' } as const;

export function ThemeMenu() {
  const t = useTranslations('theme');
  const [theme, setTheme] = useState<Theme>('system');
  // Durumun tek kaynağı kök özniteliğidir; başka bir denetimden (ayarlar, palet) yapılan
  // değişiklik de menüye yansır.
  useEffect(() => {
    setTheme(readUiPrefs().theme);
    return subscribeUiPrefs((prefs) => setTheme(prefs.theme));
  }, []);
  const change = (next: Theme): void => {
    setTheme(next);
    applyUiPrefs({ ...readUiPrefs(), theme: next });
  };
  return (
    <DropdownMenu
      trigger={<IconButton icon={ICON[theme]} label={t('label', { current: t(theme) })} />}
    >
      <DropdownMenuRadioGroup
        value={theme}
        onValueChange={change}
        options={[
          { value: 'light', label: t('light'), icon: 'theme.light' },
          { value: 'dark', label: t('dark'), icon: 'theme.dark' },
          { value: 'system', label: t('system'), icon: 'theme.system' },
        ]}
      />
    </DropdownMenu>
  );
}
