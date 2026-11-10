'use client';
// Yargı kapsamı seçici (053/02 §4.3, 052 `ScopePicker`; KK-053-02-7): hap tetikleyici + Popover.
// Hazır ayarlar tek tıkla toplu seçer; kurum grupları onay kutusudur; kapsam dışı kurumlar pasiftir
// ve ipucu taşır. Hiç seçim kalmazsa Akıllı otomatik seçime döner. Uç nokta adları gösterilmez.
import {
  SCOPE_CATALOG,
  SCOPE_OUT_OF_COVERAGE,
  SCOPE_PRESET_IDS,
  SCOPE_PRESETS,
  type ScopeGroup,
  type ScopeItemId,
  type ScopePresetId,
} from '@eda/contracts/scope';
import { Button, Checkbox, cn, Icon, Popover } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { InstitutionMark } from './institution-mark.tsx';

/** İki sütun: adli yargı solda, diğer yargı kolları ve mevzuat sağda (yükseklik ekrana sığar). */
const GROUP_COLUMNS: readonly (readonly ScopeGroup[])[] = [
  ['adli'],
  ['idari', 'anayasa', 'yargi_yolu', 'mevzuat'],
];

const sameSet = (a: readonly ScopeItemId[], b: readonly ScopeItemId[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Seçime karşılık gelen hazır ayar; yoksa `null`. */
export function presetOf(value: readonly ScopeItemId[] | null): ScopePresetId | null {
  if (value === null) return 'auto';
  for (const id of SCOPE_PRESET_IDS) {
    const ids = SCOPE_PRESETS[id];
    if (ids !== null && sameSet(ids, value)) return id;
  }
  return null;
}

/** Onay kutusu değişimi: üst öğe kaldırılınca alt öğe de kalkar; boş seçim otomatiğe döner. */
export function toggleScope(
  value: readonly ScopeItemId[] | null,
  id: ScopeItemId,
  on: boolean,
): ScopeItemId[] | null {
  const base = value ?? SCOPE_CATALOG.map((i) => i.id);
  const children = SCOPE_CATALOG.filter((i) => i.parent === id).map((i) => i.id);
  const next = on
    ? [...new Set([...base, id])]
    : base.filter((x) => x !== id && !children.includes(x));
  if (next.length === 0 || next.length === SCOPE_CATALOG.length) return null;
  return SCOPE_CATALOG.map((i) => i.id).filter((x) => next.includes(x));
}

export function ScopePicker({
  value,
  onChange,
}: {
  value: readonly ScopeItemId[] | null;
  onChange: (next: ScopeItemId[] | null) => void;
}) {
  const t = useTranslations('scope');
  const outHintId = useId();
  const preset = presetOf(value);
  const selected = value ?? SCOPE_CATALOG.map((i) => i.id);
  const triggerLabel =
    preset !== null
      ? t(`presets.${preset}.short`)
      : selected.length <= 2
        ? selected.map((id) => t(`items.${id}.label`)).join(' + ')
        : t('trigger.count', { count: selected.length });
  const marks = value === null ? [] : value.slice(0, 3);

  return (
    <Popover
      size="lg"
      side="top"
      title={t('title')}
      description={t('description')}
      labels={{ close: t('close') }}
      trigger={
        <button
          type="button"
          className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-md px-2 text-body-sm text-fg-muted transition-colors duration-fast hover:bg-primary-soft hover:text-fg focus-visible:focus-ring pointer-coarse:min-h-11"
        >
          {marks.length === 0 ? (
            <Icon icon="nav.legislation" size="sm" className="text-fg-subtle" />
          ) : (
            <span className="flex gap-0.5">
              {marks.map((id) => (
                <InstitutionMark key={id} id={id} className="rounded-md bg-surface" />
              ))}
            </span>
          )}
          <span className="truncate">
            <span className="sr-only sm:not-sr-only">{t('trigger.label')}: </span>
            <span className="text-fg">{triggerLabel}</span>
          </span>
          <Icon icon="control.chevron-down" size="sm" className="text-fg-subtle" />
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-caption font-medium text-fg-subtle">
            {t('presetsTitle')}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {SCOPE_PRESET_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={preset === id}
                onClick={() =>
                  onChange(SCOPE_PRESETS[id] === null ? null : [...(SCOPE_PRESETS[id] ?? [])])
                }
                className={cn(
                  'inline-flex min-h-7 items-center rounded-full border px-2.5 text-caption transition-colors duration-fast focus-visible:focus-ring pointer-coarse:min-h-11',
                  preset === id
                    ? 'border-primary bg-primary-soft text-fg'
                    : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                {t(`presets.${id}.label`)}
              </button>
            ))}
          </div>
          {preset === 'auto' && (
            <p className="text-caption text-fg-subtle">{t('presets.auto.hint')}</p>
          )}
        </fieldset>

        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {GROUP_COLUMNS.map((column) => (
            <div key={column.join()} className="flex flex-col gap-4">
              {column.map((group) => (
                <fieldset key={group} className="flex flex-col gap-1">
                  <legend className="mb-1.5 text-caption font-medium text-fg-subtle">
                    {t(`groups.${group}`)}
                  </legend>
                  {SCOPE_CATALOG.filter((i) => i.group === group).map((item) => (
                    <div key={item.id} className={cn('flex', item.parent !== null && 'pl-6')}>
                      <Checkbox
                        checked={selected.includes(item.id)}
                        onCheckedChange={(on) => onChange(toggleScope(value, item.id, on))}
                        disabled={item.parent !== null && !selected.includes(item.parent)}
                        label={
                          <span className="inline-flex items-center gap-2 py-0.5">
                            <InstitutionMark id={item.id} size="md" />
                            <span className="flex flex-col leading-tight">
                              <span>{t(`items.${item.id}.label`)}</span>
                              <span className="text-caption text-fg-subtle">
                                {t(`items.${item.id}.hint`)}
                              </span>
                            </span>
                          </span>
                        }
                      />
                    </div>
                  ))}
                </fieldset>
              ))}
            </div>
          ))}
        </div>

        <fieldset className="flex flex-col gap-1.5" aria-describedby={outHintId}>
          <legend className="mb-1.5 text-caption font-medium text-fg-subtle">
            {t('outOfCoverage.title')}
          </legend>
          <p id={outHintId} className="text-caption text-fg-subtle">
            {t('outOfCoverage.hint')}
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
            {SCOPE_OUT_OF_COVERAGE.map((id) => (
              <li
                key={id}
                aria-disabled="true"
                className="inline-flex items-center gap-1.5 text-caption text-fg-subtle"
              >
                <InstitutionMark id={id} />
                {t(`outOfCoverage.items.${id}`)}
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="flex justify-end border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={value === null}
            onClick={() => onChange(null)}
          >
            {t('reset')}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
