// @tk TK-08
// KK-P08-7 (KK-022-4, KK-026-11, KK-026-12): akış geri çözücü fuzz — >= 10.000 rastgele metin/token
// karışımı rastgele ve tüm bölme noktalarında parçalanır; akışlı çıktı akışsız `unmaskText` ile bayt
// eşit. [K#] değişmez; kod/bağlantı/URL içi çözülmez; bilinmeyen token aynen; tampon <= 33 karakter.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/testing.ts';
import { TurnMaskTable } from '../../src/tokens/table.ts';
import { createUnmasker, unmaskText } from '../../src/unmask/stream.ts';
import { stripTokens } from '../../src/unmask/strip.ts';

function table(): TurnMaskTable {
  const t = new TurnMaskTable();
  t.set('[KISI_ABCD]', { tip: 'KISI', display: 'Ahmet Yılmaz', identity: 'c1' });
  t.set('[KISI_WXYZ23]', { tip: 'KISI', display: 'AYŞE KARA', identity: 'c2' });
  t.set('[SIRKET_MZFD]', { tip: 'SIRKET', display: 'Mavi Yapı A.Ş.', identity: 'c3' });
  t.set('[TCKN_RQWA]', { tip: 'TCKN', display: '10000000146', identity: 'c1:tckn' });
  t.set('[TARIH_DOGUM_ABCDEF]', { tip: 'TARIH_DOGUM', display: '12.03.1985', identity: 'd' });
  t.set('[EPOSTA_6J45]', { tip: 'EPOSTA', display: 'ahmet@example.com', identity: 'e' });
  return t;
}

const PIECES = [
  '[KISI_ABCD]',
  '[KISI_WXYZ23]',
  '[SIRKET_MZFD]',
  '[TCKN_RQWA]',
  '[TARIH_DOGUM_ABCDEF]',
  '[EPOSTA_6J45]',
  '[kisi_abcd]',
  '[KISI_ZZZZ]',
  '[KISI_ABC',
  '[K3]',
  '[K12]',
  '［KISI_ABCD]',
  "'in",
  "'ın",
  '’e',
  "'abcdefghijklmno",
  "'",
  'in',
  ' ',
  '\n',
  '```',
  '```\n',
  '`',
  '](',
  ')',
  '[metin]',
  'http://',
  'https://ornek.example.com/',
  '>',
  'ğüşıöç',
  'İstanbul',
  '😀',
  'Yargıtay',
  ' ve ',
  '.',
  'h',
  'ht',
  ']',
  '[',
];

function sample(rnd: () => number): string {
  const n = 1 + Math.floor(rnd() * 14);
  let s = '';
  for (let i = 0; i < n; i += 1) s += PIECES[Math.floor(rnd() * PIECES.length)];
  return s;
}

function chunkRandom(s: string, rnd: () => number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const len = 1 + Math.floor(rnd() * 7);
    out.push(s.slice(i, i + len));
    i += len;
  }
  return out;
}

function streamOut(chunks: readonly string[], t: TurnMaskTable): { text: string } {
  const u = createUnmasker(t);
  let out = '';
  for (const c of chunks) out += u.push('p', c);
  out += u.end('p');
  return { text: out };
}

describe('KK-P08-7: akış = akışsız (KK-022-4)', () => {
  it('KK-P08-7 10.000 rastgele karışım, rastgele parçalama', () => {
    const t = table();
    const rnd = mulberry32(22);
    let checked = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const s = sample(rnd);
      const expected = unmaskText(s, t);
      const got = streamOut(chunkRandom(s, rnd), t).text;
      if (got !== expected) {
        expect({ s, got }).toEqual({ s, got: expected });
      }
      checked += 1;
    }
    expect(checked).toBe(10_000);
  });

  it('KK-P08-7 her olası tek ve çift bölme noktası (çok baytlı ve token ortası dahil)', () => {
    const t = table();
    const rnd = mulberry32(44);
    let splits = 0;
    for (let i = 0; i < 300; i += 1) {
      const s = sample(rnd);
      const expected = unmaskText(s, t);
      for (let a = 0; a <= s.length; a += 1) {
        const got = streamOut([s.slice(0, a), s.slice(a)], t).text;
        if (got !== expected) expect({ s, a, got }).toEqual({ s, a, got: expected });
        splits += 1;
        const b = a + Math.floor(rnd() * (s.length - a + 1));
        const got3 = streamOut([s.slice(0, a), s.slice(a, b), s.slice(b)], t).text;
        if (got3 !== expected) expect({ s, a, b, got3 }).toEqual({ s, a, b, got3: expected });
      }
    }
    expect(splits).toBeGreaterThan(5000);
  });

  it('KK-P08-7 tek karakterlik parçalama (en uzun token + 12 harfli ek sınırı)', () => {
    const t = table();
    const s = "Ön [TARIH_DOGUM_ABCDEF]'abcdefghijkl son [KISI_WXYZ23]'nın ve [KISI_ABCD]'in.";
    const chars = [...s];
    expect(streamOut(chars, t).text).toBe(unmaskText(s, t));
  });
});

describe('KK-P08-7: davranış (026 §9.2-§9.5)', () => {
  const t = table();
  it('KK-P08-7 ek uyumlanır; kesmesiz harfler ek sayılmaz', () => {
    expect(unmaskText("[KISI_ABCD]'in dosyası", t)).toBe("Ahmet Yılmaz'ın dosyası");
    expect(unmaskText("[KISI_WXYZ23]'in", t)).toBe("AYŞE KARA'NIN");
    expect(unmaskText("[SIRKET_MZFD]'e", t)).toBe("Mavi Yapı A.Ş.'ye");
    expect(unmaskText('[KISI_ABCD]in', t)).toBe('Ahmet Yılmazin');
  });

  it('KK-P08-7 [K#] değişmez; bilinmeyen token aynen kalır ve sayaç artar', () => {
    const u = createUnmasker(t);
    const out = u.push('a', 'Kaynak [K3] ve [KISI_ZZZZ] ile [KISI_ABCD].') + u.end('a');
    expect(out).toBe('Kaynak [K3] ve [KISI_ZZZZ] ile Ahmet Yılmaz.');
    expect(u.stats).toEqual({ unmasked: 1, unknown: 1, suffixUnparsed: 0 });
  });

  it('KK-P08-7 kod bloğu, satır içi kod, bağlantı hedefi ve çıplak URL içinde çözme yok', () => {
    const s = [
      '[KISI_ABCD]',
      '```',
      '[KISI_ABCD]',
      '```',
      'satır `[KISI_ABCD]` içi',
      '[bağlantı](https://ornek.example.com/[KISI_ABCD]) ve [KISI_ABCD]',
      'çıplak https://ornek.example.com/x[KISI_ABCD] sonra [KISI_ABCD]',
    ].join('\n');
    expect(unmaskText(s, t)).toBe(
      [
        'Ahmet Yılmaz',
        '```',
        '[KISI_ABCD]',
        '```',
        'satır `[KISI_ABCD]` içi',
        '[bağlantı](https://ornek.example.com/[KISI_ABCD]) ve Ahmet Yılmaz',
        'çıplak https://ornek.example.com/x[KISI_ABCD] sonra Ahmet Yılmaz',
      ].join('\n'),
    );
  });

  it('KK-P08-7 kapanmamış kod bloğu end() ile boşalır (çözülmeden)', () => {
    const u = createUnmasker(t);
    const a = u.push('x', '```\nkod [KISI_AB');
    const b = u.end('x');
    expect(a + b).toBe('```\nkod [KISI_AB');
  });

  it('KK-P08-7 parça kimliği başına ayrı tampon; endAll yarım tokenı ham bırakır', () => {
    const u = createUnmasker(t);
    expect(u.push('a', 'A: [KISI_AB')).toBe('A: ');
    expect(u.push('b', 'B: [TCKN_RQ')).toBe('B: ');
    expect(u.push('a', "CD]'e")).toBe('');
    expect(u.endAll()).toEqual({ a: "Ahmet Yılmaz'a", b: '[TCKN_RQ' });
  });

  it('KK-P08-7 tampon üst sınırı 33 karakter (20 + kesme + 12)', () => {
    const u = createUnmasker(t);
    const head = u.push('p', "x [TARIH_DOGUM_ABCDEF]'abcdefghijk");
    // 33 karakterden fazlası beklemez: yalnız "[...]'abcdefghijk" (32) beklemede.
    expect(head).toBe('x ');
    const rest = u.push('p', 'l') + u.end('p');
    expect(head + rest).toBe(unmaskText("x [TARIH_DOGUM_ABCDEF]'abcdefghijkl", t));
    // [ içermeyen metin gecikmesiz akar.
    expect(createUnmasker(t).push('q', 'düz metin')).toBe('düz metin');
  });

  it('KK-P08-7 Unmasker serileştirmesi içerik sızdırmaz', () => {
    expect(JSON.stringify(createUnmasker(t))).toBe('"[REDACTED]"');
  });
});

describe('KK-026-14: stripTokens (026 §9.5)', () => {
  it('KK-026-14 token ve kesmeli eki siler, boşlukları daraltır', () => {
    expect(stripTokens("[KISI_ABCD]'nin kira [TCKN_RQWA] tahliye")).toEqual({
      text: 'kira tahliye',
      removed: 2,
    });
    expect(stripTokens('[K3] kaynak')).toEqual({ text: '[K3] kaynak', removed: 0 });
    expect(stripTokens('［KISI_ABCD] kaçışlı')).toEqual({
      text: '［KISI_ABCD] kaçışlı',
      removed: 0,
    });
  });
});
