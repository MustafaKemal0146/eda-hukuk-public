'use client';
// Seçim balonu: metin seçilince seçimin altında küçük, kayan bir düğme ("Bu kısmı düzenle").
// Konum CSS değişkeniyle verilir (CSSOM; CSP ile uyumlu). Düğme basımı seçimi bozmaz (mousedown
// engellenir); klavyeyle de erişilir (sayfa akışında sonraki odak hedefidir).
import { Button } from '@eda/ui';
import { useRef } from 'react';
import { useCssVar } from '../../lib/use-css-var.ts';

export type BalloonPosition = { x: number; y: number };

export function SelectionBalloon({
  position,
  label,
  onClick,
}: {
  position: BalloonPosition;
  label: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVar(ref, '--eda-balloon-x', `${Math.max(0, Math.round(position.x))}px`);
  useCssVar(ref, '--eda-balloon-y', `${Math.max(0, Math.round(position.y))}px`);
  return (
    <div
      ref={ref}
      className="absolute left-(--eda-balloon-x) top-(--eda-balloon-y) z-sticky"
      data-selection-balloon=""
    >
      <Button
        size="sm"
        variant="outline"
        className="shadow-2"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
      >
        {label}
      </Button>
    </div>
  );
}
