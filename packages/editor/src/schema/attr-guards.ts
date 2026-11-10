// Şema öznitelik doğrulayıcıları: ProseMirror `AttributeSpec.validate` olarak `Node.fromJSON` ve
// `check()` sırasında çalışır; geçersiz değerde `RangeError` atar (054 §2.6: hata -> `node_invalid`).

export function oneOf(name: string, allowed: readonly unknown[]): (value: unknown) => void {
  return (value) => {
    if (!allowed.includes(value)) throw new RangeError(`Geçersiz ${name} değeri.`);
  };
}

export function intMin(name: string, min: number): (value: unknown) => void {
  return (value) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
      throw new RangeError(`Geçersiz ${name} değeri.`);
    }
  };
}

export function stringOrNull(name: string, maxLength?: number): (value: unknown) => void {
  return (value) => {
    if (value === null) return;
    if (typeof value !== 'string' || (maxLength !== undefined && value.length > maxLength)) {
      throw new RangeError(`Geçersiz ${name} değeri.`);
    }
  };
}

export function matchesOrNull(name: string, pattern: RegExp): (value: unknown) => void {
  return (value) => {
    if (value === null) return;
    if (typeof value !== 'string' || !pattern.test(value)) {
      throw new RangeError(`Geçersiz ${name} değeri.`);
    }
  };
}
