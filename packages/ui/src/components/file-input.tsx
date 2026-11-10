'use client';
// FileInput (052 §3): gizli `<input type="file">` + görünür düğme ("Dosya seç"). Sürükle-bırak
// olmadan tam işlevlidir; `capture` ile kamera varyantı ("Fotoğraf çek"). Devre dışıysa neden metni
// `aria-describedby` ile okunur ve düğme odak alabilir kalır.
import { type ComponentProps, useId, useRef } from 'react';
import { Button, type ButtonProps } from './button.tsx';

export type FileInputProps = {
  /** Düğme metni. */
  children: string;
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  /** Mobil kamera varyantı. */
  capture?: ComponentProps<'input'>['capture'];
  /** Devre dışı nedeni; verilirse düğme `aria-disabled` olur ve neden okunur. */
  disabledReason?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  name?: string;
  id?: string;
  'aria-describedby'?: string;
};

export function FileInput({
  children,
  onFilesSelected,
  accept,
  multiple = false,
  capture,
  disabledReason,
  variant = 'outline',
  size = 'md',
  name,
  id,
  'aria-describedby': describedBy,
}: FileInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const disabled = disabledReason !== undefined;
  const describedByIds = [describedBy, disabled ? reasonId : undefined].filter(Boolean).join(' ');
  return (
    <span className="inline-flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        {...(accept === undefined ? {} : { accept })}
        {...(capture === undefined ? {} : { capture })}
        {...(name === undefined ? {} : { name })}
        multiple={multiple}
        onChange={(event) => {
          const list = event.currentTarget.files;
          if (list && list.length > 0) onFilesSelected(Array.from(list));
          event.currentTarget.value = '';
        }}
      />
      <Button
        {...(id === undefined ? {} : { id })}
        variant={variant}
        size={size}
        leadingIcon={capture === undefined ? 'control.upload' : 'control.camera'}
        aria-disabled={disabled || undefined}
        aria-describedby={describedByIds || undefined}
        onClick={() => inputRef.current?.click()}
      >
        {children}
      </Button>
      {disabledReason && (
        <span id={reasonId} className="text-caption text-fg-subtle">
          {disabledReason}
        </span>
      )}
    </span>
  );
}
