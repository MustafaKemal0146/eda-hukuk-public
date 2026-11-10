'use client';
// Sayfa düzeni denetimleri: yazı tipi, punto ve satır aralığı seçicileri (araç çubuğu).
import {
  DOC_FONT_SIZES,
  DOC_FONTS,
  DOC_LINE_HEIGHTS,
  type DocFont,
  type DocFontSize,
  type DocLayout,
  type DocLineHeight,
} from '@eda/editor/schema';
import { Select } from '@eda/ui';
import { useTranslations } from 'next-intl';

const NUMBER = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

export function LayoutControls({
  layout,
  disabled,
  onChange,
}: {
  layout: DocLayout;
  disabled: boolean;
  onChange: (patch: Partial<DocLayout>) => void;
}) {
  const t = useTranslations('studio.layout');
  return (
    <>
      <Select
        aria-label={t('font')}
        size="sm"
        className="w-44"
        disabled={disabled}
        value={layout.fontFamily}
        onChange={(e) => onChange({ fontFamily: e.target.value as DocFont })}
        options={DOC_FONTS.map((f) => ({ value: f, label: t(`fonts.${f}`) }))}
      />
      <Select
        aria-label={t('size')}
        size="sm"
        className="w-20"
        disabled={disabled}
        value={String(layout.fontSizePt)}
        onChange={(e) => onChange({ fontSizePt: Number(e.target.value) as DocFontSize })}
        options={DOC_FONT_SIZES.map((s) => ({ value: String(s), label: `${s} pt` }))}
      />
      <Select
        aria-label={t('spacing')}
        size="sm"
        className="w-20"
        disabled={disabled}
        value={String(layout.lineHeight)}
        onChange={(e) => onChange({ lineHeight: Number(e.target.value) as DocLineHeight })}
        options={DOC_LINE_HEIGHTS.map((l) => ({ value: String(l), label: NUMBER.format(l) }))}
      />
    </>
  );
}
