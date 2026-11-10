// Küçük SVG grafikler (bağımlılıksız): renk `currentColor` (semantik metin sınıfından), eksen metni
// yok; değerler "Tablo olarak göster" ile erişilebilir tabloda da verilir. Yalnız sayı çizer.
import type { ReactNode } from 'react';

export function BarSeries({
  values,
  height = 64,
  className = 'text-primary',
}: {
  values: readonly number[];
  height?: number;
  className?: string;
}): ReactNode {
  const max = Math.max(1, ...values);
  const n = Math.max(1, values.length);
  const w = 100 / n;
  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-hidden="true"
      className={`h-16 w-full ${className}`}
    >
      {values.map((v, i) => {
        const h = (v / max) * (height - 2);
        return (
          <rect
            key={i}
            x={i * w + w * 0.15}
            y={height - h}
            width={w * 0.7}
            height={Math.max(h, v > 0 ? 1 : 0)}
            rx={0.6}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}

/** Çizgi serisi: değerler eşit aralıklı noktalardır; renk `currentColor`. Yalnız sayı çizer. */
export function LineSeries({
  values,
  height = 64,
  className = 'text-primary',
}: {
  values: readonly number[];
  height?: number;
  className?: string;
}): ReactNode {
  const max = Math.max(1, ...values);
  const n = values.length;
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => height - 2 - (v / max) * (height - 4);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-hidden="true"
      className={`h-16 w-full ${className}`}
    >
      {n > 1 && (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {n === 1 && <circle cx={50} cy={y(values[0] ?? 0)} r={2} fill="currentColor" />}
    </svg>
  );
}

/** Yatay çubuk listesi: etiket, çubuk ve değer metni; çubuk uzunluğu en büyük değere göre. */
export function HBarList({
  rows,
  className = 'text-primary',
}: {
  rows: readonly {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly text: string;
  }[];
  className?: string;
}): ReactNode {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3">
          <span className="w-1/3 shrink-0 truncate text-body-sm text-fg" title={r.label}>
            {r.label}
          </span>
          <svg
            viewBox="0 0 100 8"
            preserveAspectRatio="none"
            aria-hidden="true"
            className={`h-2 min-w-0 flex-1 ${className}`}
          >
            <rect x={0} y={0} width={100} height={8} rx={1} fill="currentColor" opacity={0.12} />
            <rect
              x={0}
              y={0}
              width={Math.max((r.value / max) * 100, r.value > 0 ? 1 : 0)}
              height={8}
              rx={1}
              fill="currentColor"
            />
          </svg>
          <span className="shrink-0 text-body-sm tabular-nums text-fg-muted">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
