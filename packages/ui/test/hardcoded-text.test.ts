// @tk TK-33
// KK-P05-19 (KK-052-4): `packages/ui/src` içinde sabit arayüz metni yoktur. TSX sözdizim ağacı
// taranır: harf içeren JSX metin düğümü, JSX çocuğu olarak dize sabiti ve erişilebilir ad/ipucu
// özniteliklerinde (`aria-label`, `title`, `placeholder`, `alt`, `label` …) harf içeren dize sabiti
// bulgu sayılır. Harf içermeyen tek simge karakterleri (BrandMark `§`, ayraç `:`) serbesttir.
// Metinler yalnız `labels`/`children` prop'larıyla gelir.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Metin taşıyan öznitelikler: erişilebilir ad, ipucu ve bileşen etiket prop'ları. */
const TEXT_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
  'loadingLabel',
  'emptyLabel',
  'cancelLabel',
  'destructiveLabel',
]);

/** Bilinçli istisnalar (dosya -> izinli metin). Şu an boş: BrandMark `§` harf değildir. */
const ALLOWLIST: Record<string, readonly string[]> = {};

const LETTER = /\p{L}/u;

/** Örnek metinli vitrin (yalnız geliştirme ve tarayıcı testi; @eda/ui/showcase) taranmaz. */
const SKIP_DIRS = new Set(['showcase']);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? SKIP_DIRS.has(e.name)
        ? []
        : walk(join(dir, e.name))
      : e.name.endsWith('.tsx')
        ? [join(dir, e.name)]
        : [],
  );
}

type Finding = { file: string; line: number; kind: string; text: string };

function literalText(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literalText(node.expression);
  if (ts.isParenthesizedExpression(node)) return literalText(node.expression);
  return null;
}

function scanSource(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];
  const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text !== '' && LETTER.test(text)) {
        findings.push({ file, line: at(node), kind: 'jsx-text', text });
      }
    } else if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const text = literalText(node.expression);
      if (text !== null && LETTER.test(text)) {
        findings.push({ file, line: at(node), kind: 'jsx-child-literal', text });
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      const text = literalText(node.initializer);
      if (TEXT_ATTRIBUTES.has(name) && text !== null && LETTER.test(text)) {
        findings.push({ file, line: at(node), kind: `attr:${name}`, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings.filter((f) => !(ALLOWLIST[f.file] ?? []).includes(f.text));
}

describe('KK-P05-19: @eda/ui içinde sabit arayüz metni yok', () => {
  it('src/**/*.tsx: JSX metni ve metin özniteliği literal’i 0', () => {
    const findings = walk(SRC).flatMap((f) =>
      scanSource(relative(SRC, f), readFileSync(f, 'utf8')),
    );
    expect(findings).toEqual([]);
  });

  it('negatif örnek: tarayıcı her biçimi yakalar', () => {
    const sample = [
      'export const A = () => <button aria-label="Kapat">Kaydet</button>;',
      "export const B = () => <input placeholder={'Ara'} title={`İpucu`} />;",
      "export const C = () => <p>{'Sabit metin'}</p>;",
      'export const D = () => <IconButton label="Close" icon="action.close" />;',
    ].join('\n');
    const kinds = scanSource('ornek.tsx', sample).map((f) => f.kind);
    expect(kinds).toEqual([
      'attr:aria-label',
      'jsx-text',
      'attr:placeholder',
      'attr:title',
      'jsx-child-literal',
      'attr:label',
    ]);
  });

  it('pozitif örnek: prop’tan gelen metin ve harfsiz simge serbest', () => {
    const sample = [
      'export const A = ({ l }: { l: string }) => <button aria-label={l}>{l}</button>;',
      'export const B = () => <span aria-hidden="true">§</span>;',
      'export const C = ({ c }: { c: string }) => <span>{c}: </span>;',
    ].join('\n');
    expect(scanSource('ornek.tsx', sample)).toEqual([]);
  });
});
