// @tk TK-06
// KK-P20-18 (KK-033-24): nesne deposuna yalnız api üzerinden erişilir. Presigned URL üreticileri ve
// nesne listeleme uygulama kaynaklarında yoktur; `ListObjectsV2` yalnız `orphans.sweep` içindir
// (henüz yazılmadı: bu dilimde HİÇBİR kaynakta geçmemelidir).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.next') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const FORBIDDEN = [
  /\bgetSignedUrl\b/,
  /\bcreatePresignedPost\b/,
  /\bListObjectsV2(Command)?\b/,
  /s3-request-presigner/,
  /s3-presigned-post/,
];

describe('KK-P20-18: presigned URL ve nesne listeleme yasağı', () => {
  it('apps/*/src ve packages/*/src kaynaklarında yasaklı çağrı yok', () => {
    const files = ['apps', 'packages'].flatMap((top) =>
      readdirSync(join(ROOT, top)).flatMap((pkg) => {
        try {
          return sources(join(ROOT, top, pkg, 'src'));
        } catch {
          return [];
        }
      }),
    );
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((f) => {
      const text = readFileSync(f, 'utf8');
      return FORBIDDEN.filter((re) => re.test(text)).map((re) => `${relative(ROOT, f)}: ${re}`);
    });
    expect(hits).toEqual([]);
  });

  it('nesne deposu portu presign ve listeleme yüzeyi taşımaz', async () => {
    const port = await import('../../src/s3/port.ts');
    const mem = (await import('../../src/s3/memory.ts')).createMemoryObjectStore();
    expect(Object.keys(mem).sort()).toEqual(
      [
        'copy',
        'delete',
        'failPutAfterBytes',
        'get',
        'head',
        'objects',
        'put',
        'unavailable',
      ].sort(),
    );
    expect(port.OBJECT_STORE_ERROR_KINDS).toEqual(['not_found', 'unavailable']);
  });
});
