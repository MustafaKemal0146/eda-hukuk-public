// @tk TK-08
// KK-P08-13 (KK-026-22, KK-026-3, KK-026-17): paket saflığı — src içinde node:*, ağ, DB, dosya, saat ve
// rastgelelik yok; yalnız @eda/contracts bağımlılığı; Y-104 (toLowerCase ailesi) ve RegExp `i` bayrağı
// yok; regex-audit (iç içe sınırsız niceleyici, geri başvuru); Y-124 taraması.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG = fileURLToPath(new URL('..', import.meta.url));

function files(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'report') walk(full);
      } else if (/\.(ts|json)$/u.test(e.name)) {
        out.push({ path: relative(PKG, full), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(dir);
  return out;
}

const SRC = files(join(PKG, 'src')).filter((f) => f.path.endsWith('.ts'));
const ALL = [...SRC, ...files(join(PKG, 'test')), ...files(join(PKG, 'scripts'))];

/** Kod satırları (yorumlar atılır). */
function code(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/u.test(l))
    .join('\n');
}

describe('KK-P08-13: paket saflığı (013 kural 7, 026 §1.1)', () => {
  it('KK-P08-13 src içinde node:*, fs, ağ, DB, kripto modülü ve iç paket (contracts dışı) importu yok', () => {
    const bad: string[] = [];
    for (const f of SRC) {
      for (const m of f.text.matchAll(/from\s+'([^']+)'/gu)) {
        const spec = m[1] ?? '';
        if (spec.startsWith('.')) continue;
        if (spec.startsWith('@eda/contracts/')) continue;
        bad.push(`${f.path}: ${spec}`);
      }
      if (/\brequire\(|\bimport\(/u.test(code(f.text))) bad.push(`${f.path}: dinamik import`);
    }
    expect(bad).toEqual([]);
  });

  it('KK-P08-13 src içinde saat ve rastgelelik yok (determinizm)', () => {
    const bad = SRC.filter((f) =>
      /Date\.now|new Date\(|Math\.random|performance\.now/u.test(code(f.text)),
    );
    expect(bad.map((f) => f.path)).toEqual([]);
  });

  it('KK-P08-13 Y-104: toLowerCase/toUpperCase/toLocale* kullanımı 0 (src, test, scripts)', () => {
    const rx = /\.(toLowerCase|toUpperCase|toLocaleLowerCase|toLocaleUpperCase)\(/u;
    expect(ALL.filter((f) => rx.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it('KK-P08-13 Y-124: maskelemeyi hukuken yanlış niteleyen ifade yok', () => {
    // Desen parçalı kurulur: bu dosyanın kendisi taramada eşleşmesin (tam liste check-banned-phrases).
    const rx = new RegExp(
      `${['anonim', 'leştir'].join('')}|${['anonim', 'veri'].join('\\s+')}`,
      'u',
    );
    expect(ALL.filter((f) => rx.test(f.text)).map((f) => f.path)).toEqual([]);
  });
});

/** Regex literal ve `new RegExp(..., 'bayrak')` kaynaklarını çıkarır (yaklaşık, kaynak metinden). */
function regexes(text: string): { source: string; flags: string }[] {
  const out: { source: string; flags: string }[] = [];
  const lit =
    /(?<=[=(,:!&|?{};[]\s{0,4})\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+)\/([dgimsuvy]{0,6})/gu;
  for (const m of code(text).matchAll(lit)) out.push({ source: m[1] ?? '', flags: m[2] ?? '' });
  for (const m of code(text).matchAll(/new RegExp\([\s\S]{0,400}?,\s*'([a-z]{0,6})',?\s*\)/gu)) {
    out.push({ source: '', flags: m[1] ?? '' });
  }
  return out;
}

describe('KK-P08-13 KK-026-17: regex-audit (026 §10.3)', () => {
  const all = SRC.flatMap((f) => regexes(f.text).map((r) => ({ ...r, path: f.path })));

  it('KK-P08-13 src regexleri bulunur (denetim boş değil)', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it('KK-P08-13 `i` bayrağı yok; her regex `u` bayraklı', () => {
    expect(all.filter((r) => r.flags.includes('i')).map((r) => r.path)).toEqual([]);
    expect(
      all
        .filter((r) => !r.flags.includes('u') && !r.flags.includes('v'))
        .map((r) => `${r.path} /${r.source}/${r.flags}`),
    ).toEqual([]);
  });

  it('KK-P08-13 geri başvuru ve iç içe sınırsız niceleyici yok', () => {
    const backref = /\\[1-9]/u;
    // Sınırsız niceleyici içeren grup + ardından niceleyici: (...+)+ , (...*){n,} vb.
    const nested = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,?\d*\})/u;
    expect(all.filter((r) => backref.test(r.source)).map((r) => r.path)).toEqual([]);
    expect(all.filter((r) => nested.test(r.source)).map((r) => `${r.path} /${r.source}/`)).toEqual(
      [],
    );
  });
});
