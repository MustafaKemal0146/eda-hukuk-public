// Maket ve bölüm simgeleri: yalnız @eda/ui Icon/registry (Lucide). `i` sınıfı maket stillerindeki
// 16 px çizgi ölçüsünü verir; `ic` sınıfı sayfa düğmelerindeki ölçüyü.
import { Icon, type IconName } from '@eda/ui';
import type { ReactNode } from 'react';

export function Ic({ name, className = '' }: { name: IconName; className?: string }) {
  return <Icon icon={name} size="sm" className={`i ${className}`.trim()} />;
}

export function PageIc({ name, className = '' }: { name: IconName; className?: string }) {
  return <Icon icon={name} size="sm" className={`ic ${className}`.trim()} />;
}

/** `*sözcük*` işaretli metni tek `<em>` vurgusuyla çizer (ham HTML yok). */
export function Emph({ text }: { text: string }): ReactNode {
  return text.split('*').map((part, i) => (i % 2 === 1 ? <em key={part}>{part}</em> : part));
}
