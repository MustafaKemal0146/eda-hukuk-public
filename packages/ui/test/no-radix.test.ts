// @tk TK-33
// KK-P05-19 (KK-052-4): `@eda/ui` içinde `@radix-ui/*` içe aktarması ve `asChild` kalıbı yoktur;
// paket yalnız `@eda/contracts`'a (iş paketi olarak) bağımlıdır; `next/*`, `next-intl` ve
// `@eda/legal` içe aktarılmaz (bağlantı `render` ile, metin `labels` ile gelir).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const PKG_JSON = fileURLToPath(new URL('../package.json', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : /\.(ts|tsx|mjs|js)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

const FILES = walk(SRC).map((f) => ({ rel: relative(SRC, f), text: readFileSync(f, 'utf8') }));

/** Dosyadaki içe aktarma belirteçleri (statik, dinamik ve yeniden dışa aktarım). */
function specifiers(text: string): string[] {
  return [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map(
    (m) => m[1] ?? '',
  );
}

describe('KK-P05-19: Radix yok, asChild yok', () => {
  it('src altında @radix-ui içe aktarması 0', () => {
    const offenders = FILES.filter((f) =>
      specifiers(f.text).some((s) => s.startsWith('@radix-ui/')),
    );
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it('src altında `asChild` kullanımı 0 (Base UI `render` prop’u kullanılır)', () => {
    const offenders = FILES.filter((f) => /\basChild\b/.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it('package.json bağımlılıklarında @radix-ui yok', () => {
    const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8')) as Record<string, unknown>;
    const all = ['dependencies', 'peerDependencies', 'devDependencies'].flatMap((k) =>
      Object.keys((pkg[k] as Record<string, string> | undefined) ?? {}),
    );
    expect(all.filter((d) => d.startsWith('@radix-ui/'))).toEqual([]);
  });
});

describe('KK-P05-19: @eda/ui yalnız @eda/contracts’a bağımlı', () => {
  it('çalışma zamanı bağımlılıklarında @eda/contracts dışında @eda/* yok', () => {
    const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const eda = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith('@eda/'));
    expect(eda).toEqual(['@eda/contracts']);
  });

  it('src içe aktarmaları: @eda/* yalnız @eda/contracts; next/*, next-intl yok', () => {
    const offenders = FILES.flatMap((f) =>
      specifiers(f.text)
        .filter(
          (s) =>
            (s.startsWith('@eda/') && !s.startsWith('@eda/contracts')) ||
            s === 'next' ||
            s.startsWith('next/') ||
            s.startsWith('next-intl'),
        )
        .map((s) => `${f.rel}: ${s}`),
    );
    expect(offenders).toEqual([]);
  });
});
