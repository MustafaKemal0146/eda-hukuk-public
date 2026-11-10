// Kurum işareti: kapsam seçicide ve kaynak listelerinde küçük, süsleyici monogram (yanında her zaman
// kurum adı yazılıdır; `aria-hidden`). Kurum amblemleri kullanılmaz: resmî bağlantı izlenimi vermemek
// için (Y-70..Y-78) işaretler E.D.A.'nın kendi semantik tonlarından üretilir.
import type { ScopeItemId, ScopeOutOfCoverageId } from '@eda/contracts/scope';
import { cn } from '@eda/ui';

export type InstitutionId = ScopeItemId | ScopeOutOfCoverageId;

/**
 * Semantik yumuşak tonlar (051 §4.11: alfa ve opacity sınıfı yasak). Tailwind sınıfları birebir yazılır
 * (dinamik birleştirme üretimde sınıfı düşürür).
 */
const TONES = {
  c1: {
    soft: 'fill-primary-soft',
    line: 'stroke-primary-soft-border',
    fill: 'fill-primary-soft-fg',
  },
  c2: {
    soft: 'fill-data-class-client-bg',
    line: 'stroke-data-class-client-border',
    fill: 'fill-data-class-client-fg',
  },
  c3: {
    soft: 'fill-data-class-public-bg',
    line: 'stroke-data-class-public-border',
    fill: 'fill-data-class-public-fg',
  },
  c4: { soft: 'fill-info-soft', line: 'stroke-info-border', fill: 'fill-info-on-soft' },
  c5: {
    soft: 'fill-data-class-case-bg',
    line: 'stroke-data-class-case-border',
    fill: 'fill-data-class-case-fg',
  },
  c6: { soft: 'fill-success-soft', line: 'stroke-success-border', fill: 'fill-success-on-soft' },
  c7: { soft: 'fill-neutral-soft', line: 'stroke-neutral-border', fill: 'fill-neutral-on-soft' },
  muted: { soft: 'fill-disabled-bg', line: 'stroke-neutral-border', fill: 'fill-disabled-fg' },
} as const;

const MARKS: Record<InstitutionId, { text: string; tone: keyof typeof TONES }> = {
  yargitay: { text: 'Y', tone: 'c1' },
  kyb: { text: 'KYB', tone: 'c1' },
  istinaf: { text: 'BAM', tone: 'c2' },
  ilk_derece: { text: 'İD', tone: 'c3' },
  danistay: { text: 'D', tone: 'c4' },
  aym: { text: 'AYM', tone: 'c5' },
  uyusmazlik: { text: 'UM', tone: 'c6' },
  mevzuat: { text: '§', tone: 'c7' },
  sayistay: { text: 'S', tone: 'muted' },
  kik: { text: 'KİK', tone: 'muted' },
  rekabet: { text: 'R', tone: 'muted' },
  gib: { text: 'GİB', tone: 'muted' },
  kvkk_kurulu: { text: 'KVK', tone: 'muted' },
  bddk: { text: 'BD', tone: 'muted' },
  sigorta_tahkim: { text: 'ST', tone: 'muted' },
};

const FONT_BY_LENGTH = [0, 11, 8.5, 6.6] as const;

export function InstitutionMark({
  id,
  size = 'sm',
  className,
}: {
  id: InstitutionId;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const mark = MARKS[id];
  const tone = TONES[mark.tone];
  const len = [...mark.text].length;
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', size === 'sm' ? 'size-4' : 'size-5', className)}
    >
      <rect x="0.5" y="0.5" width="19" height="19" rx="5" className={tone.soft} />
      <rect
        x="0.5"
        y="0.5"
        width="19"
        height="19"
        rx="5"
        fill="none"
        strokeWidth="1"
        className={tone.line}
      />
      <text
        x="10"
        y="10.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={FONT_BY_LENGTH[Math.min(len, 3)]}
        fontWeight={700}
        letterSpacing={len > 2 ? -0.2 : 0}
        className={cn(tone.fill, 'font-sans')}
      >
        {mark.text}
      </text>
    </svg>
  );
}
