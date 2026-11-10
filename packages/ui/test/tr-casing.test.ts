// @tk TK-34
// KK-P05-13 (KK-051-13, Y-104): `packages/ui/src`, `apps/web/src`, `apps/admin/src` içinde düz
// büyük/küçük harf dönüşümü çağrısı yoktur; yerel duyarlı çağrı yalnız `tr`/`tr-TR` ile yapılır.
// Tarama sözdizim ağacı üzerindedir: yorum satırları ve dize içerikleri bulgu sayılmaz (satır
// tabanlı lint kapısı `check-ui-tokens` `tr-casing` kuralıdır). `@eda/ui` harf dönüşümünü yalnız
// Combobox arama karşılaştırmasında (görüntülenmeyen katlama) kullanır; görünen metin dönüştürülmez.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TARGETS = ['packages/ui/src', 'apps/web/src', 'apps/admin/src'] as const;
const SCANNED = /\.(ts|tsx|mts|mjs|js|jsx)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'generated', '.turbo', 'coverage']);

// Çağrı adları parçalardan kurulur: depoda düz çağrı metni bulunmasın (P05 doğrulama komutundaki
// `git grep` beklenen boş sonucu korunur).
const UPPER = ['to', 'Upper', 'Case'].join('');
const LOWER = ['to', 'Lower', 'Case'].join('');
const PLAIN = new Set([UPPER, LOWER]);
const LOCALE = new Set(['toLocaleUpperCase', 'toLocaleLowerCase']);
const TR_LOCALE = /^tr(-TR)?$/;

/** `@eda/ui` içinde yerel duyarlı dönüşüme izin verilen dosyalar (yalnız arama katlaması). */
const UI_LOCALE_ALLOWLIST = new Set(['packages/ui/src/components/combobox.tsx']);

type Finding = { file: string; line: number; call: string };

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? SKIP_DIRS.has(e.name)
        ? []
        : walk(join(dir, e.name))
      : SCANNED.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

/** Kaynak metindeki harf dönüşümü çağrıları; `kind` düz çağrı mı, yerel duyarlı mı. */
function casingCalls(
  file: string,
  source: string,
): (Finding & { kind: 'plain' | 'locale'; trLocale: boolean })[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: (Finding & { kind: 'plain' | 'locale'; trLocale: boolean })[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (PLAIN.has(name) || LOCALE.has(name)) {
        const first = node.arguments[0];
        const trLocale =
          first !== undefined &&
          (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) &&
          TR_LOCALE.test(first.text);
        out.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          call: name,
          kind: PLAIN.has(name) ? 'plain' : 'locale',
          trLocale,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Kural ihlalleri: düz çağrı veya `tr` dışı/yerelsiz `toLocale*Case`. */
function violations(file: string, source: string): Finding[] {
  return casingCalls(file, source)
    .filter((c) => c.kind === 'plain' || !c.trLocale)
    .map(({ file: f, line, call }) => ({ file: f, line, call }));
}

const FILES = TARGETS.flatMap((t) => walk(join(REPO, t))).map((abs) => ({
  rel: relative(REPO, abs),
  text: readFileSync(abs, 'utf8'),
}));

describe('KK-P05-13 (KK-051-13): Türkçe harf dönüşümü', () => {
  it('KK-P05-13: üç hedef dizin taranır ve boş değildir', () => {
    for (const t of TARGETS) {
      expect(
        FILES.some((f) => f.rel.startsWith(`${t}/`)),
        t,
      ).toBe(true);
    }
  });

  it('KK-P05-13: ui, web ve admin kaynaklarında düz çağrı ve tr dışı yerel çağrı 0', () => {
    expect(FILES.flatMap((f) => violations(f.rel, f.text))).toEqual([]);
  });

  it('KK-P05-13: @eda/ui yerel duyarlı dönüşümü yalnız izinli arama katlamasında kullanır', () => {
    const offenders = FILES.filter((f) => f.rel.startsWith('packages/ui/src/'))
      .flatMap((f) => casingCalls(f.rel, f.text))
      .filter((c) => !UI_LOCALE_ALLOWLIST.has(c.file));
    expect(offenders).toEqual([]);
  });

  it('KK-P05-13 negatif fixture: düz, yerelsiz ve tr dışı çağrılar yakalanır', () => {
    const sample = [
      `export const a = (s: string) => s.${UPPER}();`,
      `export const b = (s?: string) => s?.${LOWER}();`,
      'export const c = (s: string) => s.toLocaleUpperCase();',
      "export const d = (s: string) => s.toLocaleLowerCase('en-US');",
      `export const e = (xs: string[]) => xs.map((x) => x.trim().${LOWER}());`,
    ].join('\n');
    expect(violations('ornek.ts', sample)).toEqual([
      { file: 'ornek.ts', line: 1, call: UPPER },
      { file: 'ornek.ts', line: 2, call: LOWER },
      { file: 'ornek.ts', line: 3, call: 'toLocaleUpperCase' },
      { file: 'ornek.ts', line: 4, call: 'toLocaleLowerCase' },
      { file: 'ornek.ts', line: 5, call: LOWER },
    ]);
  });

  it('KK-P05-13 pozitif fixture: yorum, dize ve tr yerel çağrısı bulgu değildir', () => {
    const sample = [
      `// s.${UPPER}() yorum satırıdır`,
      `/* blok yorum: s.${LOWER}() */`,
      `export const a = 's.${UPPER}()';`,
      "export const b = (s: string) => s.toLocaleUpperCase('tr-TR');",
      'export const c = (s: string) => s.toLocaleLowerCase(`tr`);',
      `export const d = { ${UPPER}: 1 };`,
    ].join('\n');
    expect(violations('ornek.tsx', sample)).toEqual([]);
  });
});
