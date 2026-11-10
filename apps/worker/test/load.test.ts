// @tk TK-28
// KK-P01b-2: zorunlu sır dosyası okunamıyorsa veya boşsa servis başlamaz; mesajda yalnız ad.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSecretFilesReadable } from '../src/config/load.ts';

describe('KK-P01b-2: sır dosyası okunabilirliği', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eda-sir-'));
  const full = join(dir, 'dolu');
  const empty = join(dir, 'bos');
  writeFileSync(full, 'gizli-deger');
  writeFileSync(empty, '');

  it('dolu dosya kabul edilir', () => {
    expect(() => assertSecretFilesReadable({ A_FILE: full }, ['A_FILE'])).not.toThrow();
  });

  it('boş veya olmayan dosya adla reddedilir; değer mesajda yok', () => {
    const run = () =>
      assertSecretFilesReadable({ A_FILE: empty, B_FILE: join(dir, 'yok') }, ['A_FILE', 'B_FILE']);
    expect(run).toThrow(/A_FILE, B_FILE/);
    expect(run).not.toThrow(/gizli-deger/);
  });
});
