'use client';
// Tooltip (052 §3): odak ve hover ile açılır, Esc ile kapanır, üzerine gelinebilir.
import { Tooltip as Base } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <Base.Provider delay={400}>{children}</Base.Provider>;
}

export function Tooltip({
  content,
  side = 'bottom',
  children,
}: {
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactElement;
}) {
  return (
    <Base.Root>
      <Base.Trigger render={children} />
      <Base.Portal>
        <Base.Positioner side={side} sideOffset={6} className="z-tooltip">
          <Base.Popup className="rounded-sm border border-inverse-bg bg-inverse-bg px-2 py-1 text-caption text-inverse-fg shadow-2">
            {content}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
