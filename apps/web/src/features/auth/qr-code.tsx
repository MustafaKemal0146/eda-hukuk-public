'use client';
// TOTP kurulum QR kodu: `otpauth://` adresi tarayıcıda çizilir (uqr, MIT, bağımlılıksız); üçüncü taraf
// servise gönderilmez; ham HTML basılmaz (modüller <rect> olarak çizilir).
import { useEffect, useState } from 'react';

export function QrCode({ value, label }: { value: string; label: string }) {
  const [matrix, setMatrix] = useState<boolean[][] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('uqr').then(({ encode }) => {
      if (!cancelled) setMatrix(encode(value, { ecc: 'M', border: 2 }).data);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!matrix) return <div className="size-48 rounded-md bg-surface-sunken" aria-hidden="true" />;
  const n = matrix.length;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      className="size-48 rounded-md border border-border bg-paper-bg"
    >
      <rect width={n} height={n} className="fill-paper-bg" />
      {matrix.flatMap((row, y) =>
        row.map((on, x) =>
          on ? (
            <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" className="fill-paper-ink" />
          ) : null,
        ),
      )}
    </svg>
  );
}
