// Pozitif fixture (KK-P05-3): izinli kalıplar bulgu üretmez.
export const classes = [
  'bg-surface text-fg border-border-strong rounded-md shadow-1',
  'bg-teal-soft text-violet-on-soft border-neutral-border',
  'data-[state=open]:bg-surface-raised aria-[selected=true]:text-primary',
  'p-4 -mt-2 gap-x-0.5 px-3 space-y-12 m-0',
  'focus-visible:focus-ring animate-spin z-dialog duration-fast',
  'h-control-md w-sidebar max-w-chat',
];
export const anchor = '#main';
export const upper = (s: string): string => s.toLocaleUpperCase('tr-TR');
