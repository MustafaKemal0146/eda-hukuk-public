// Migrasyon kaynağı (032 §3.3): çalıştırıcı sıralamayı yalnız `MigrationSource` arayüzünden alır.
// Bu dosya drizzle-kit 0.31 `meta/_journal.json` okuyucusudur; Drizzle 1.0 geçişinde yalnız bu değişir.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { EXIT, MigrateError } from './exit-codes.ts';

export interface MigrationEntry {
  /** Dosya adı uzantısız: `0002_schema_auth`. */
  readonly id: string;
  /** Journal `idx` (0'dan başlayan sıra). */
  readonly seq: number;
  /** Mutlak dosya yolu. */
  readonly file: string;
  /** Dosya baytlarının SHA-256 özeti; dosya yoksa null. */
  readonly sha256: Buffer | null;
}

export interface MigrationSource {
  list(): Promise<MigrationEntry[]>;
  read(entry: MigrationEntry): Promise<string>;
}

const Journal = z.object({
  version: z.string(),
  dialect: z.literal('postgresql'),
  entries: z.array(
    z.object({
      idx: z.number().int().nonnegative(),
      tag: z.string().regex(/^[0-9]{4}_[a-z0-9_]+$/),
      when: z.number(),
      breakpoints: z.boolean(),
      version: z.string(),
    }),
  ),
});

export function sha256(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest();
}

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** `<dir>/meta/_journal.json` + `<dir>/<tag>.sql`. Sıra boşluksuz ve artan olmalıdır (aksi çıkış 21). */
export function drizzleJournalSource(dir: string): MigrationSource {
  return {
    async list() {
      const text = await readOptional(join(dir, 'meta', '_journal.json'));
      if (text === null) throw new MigrateError(EXIT.order, 'migrasyon journal dosyası bulunamadı');
      const parsed = Journal.safeParse(JSON.parse(text.toString('utf8')));
      if (!parsed.success) throw new MigrateError(EXIT.order, 'migrasyon journal biçimi geçersiz');
      const out: MigrationEntry[] = [];
      for (const [i, e] of parsed.data.entries.entries()) {
        if (e.idx !== i || !e.tag.startsWith(String(i).padStart(4, '0'))) {
          throw new MigrateError(EXIT.order, `journal sırası bozuk: ${e.tag} (beklenen sıra ${i})`);
        }
        const file = join(dir, `${e.tag}.sql`);
        const data = await readOptional(file);
        out.push({ id: e.tag, seq: e.idx, file, sha256: data === null ? null : sha256(data) });
      }
      return out;
    },
    async read(entry) {
      return readFile(entry.file, 'utf8');
    },
  };
}
