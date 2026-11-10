// Sır dosyası okuyucusu (040 §13.2). Değerler yalnız Secrets nesnesinde tutulur; process.env'e yazılmaz,
// günlüğe, hata mesajına veya JSON'a düşmez. Hata çıktısı yalnız değişken/dosya adını içerir.
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';

export class SecretFileError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`sır dosyası okunamadı veya boş: ${variable}`);
    this.name = 'SecretFileError';
    this.variable = variable;
  }
}

export class Secrets {
  readonly #values: ReadonlyMap<string, string>;

  private constructor(values: Map<string, string>) {
    this.#values = values;
  }

  /** `*_FILE` değişkenlerinin gösterdiği dosyaları okur; sondaki satır sonu kırpılır, boş sır hatadır. */
  static fromFiles(env: Readonly<Record<string, unknown>>, required: readonly string[]): Secrets {
    const values = new Map<string, string>();
    for (const variable of required) {
      const path = env[variable];
      if (typeof path !== 'string' || path === '') throw new SecretFileError(variable);
      let value: string;
      try {
        value = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
      } catch {
        throw new SecretFileError(variable);
      }
      if (value === '') throw new SecretFileError(variable);
      values.set(variable, value);
    }
    return new Secrets(values);
  }

  get(variable: string): string {
    const value = this.#values.get(variable);
    if (value === undefined) throw new SecretFileError(variable);
    return value;
  }

  get size(): number {
    return this.#values.size;
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  [inspect.custom](): string {
    return '[REDACTED]';
  }
}
