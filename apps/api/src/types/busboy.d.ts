// `busboy` 1.6.0 tip bildirimi (yeni `@types/busboy` bağımlılığı eklenmedi; kullanılan yüzey kadar).
declare module 'busboy' {
  import type { Readable, Writable } from 'node:stream';

  export interface BusboyConfig {
    headers: Record<string, string | undefined>;
    /** Dosya adı/alan adı karakter kümesi; varsayılan `latin1` Türkçe adları bozar. */
    defParamCharset?: string;
    preservePath?: boolean;
    limits?: {
      fieldNameSize?: number;
      fieldSize?: number;
      fields?: number;
      fileSize?: number;
      files?: number;
      parts?: number;
      headerPairs?: number;
    };
  }

  export interface FileInfo {
    filename: string;
    encoding: string;
    mimeType: string;
  }

  export interface FieldInfo {
    nameTruncated: boolean;
    valueTruncated: boolean;
    encoding: string;
    mimeType: string;
  }

  export interface Busboy extends Writable {
    on(
      event: 'file',
      listener: (name: string, stream: Readable & { truncated?: boolean }, info: FileInfo) => void,
    ): this;
    on(event: 'field', listener: (name: string, value: string, info: FieldInfo) => void): this;
    on(
      event: 'close' | 'finish' | 'partsLimit' | 'filesLimit' | 'fieldsLimit',
      listener: () => void,
    ): this;
    on(event: 'error', listener: (err: Error) => void): this;
  }

  export default function busboy(config: BusboyConfig): Busboy;
}
