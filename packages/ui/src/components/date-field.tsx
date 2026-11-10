// DateField / TimeField (052 §3, Açık Soru 12): MVP'de yerel `<input type="date|time">`; takvim
// açılır penceresi yok. Biçim ipucu ("GG.AA.YYYY") `Field` açıklamasıyla görünür verilir.
import { cn } from './cn.ts';
import { Input, type InputProps } from './input.tsx';

export type DateFieldProps = Omit<InputProps, 'type'>;

export function DateField({ className, ...rest }: DateFieldProps) {
  return <Input {...rest} type="date" className={cn('tabular-nums', className)} />;
}

export function TimeField({ className, ...rest }: DateFieldProps) {
  return <Input {...rest} type="time" className={cn('tabular-nums', className)} />;
}
