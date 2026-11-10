// @tk TK-16
// Kanonik JSON (RFC 8785) ve belge özeti (054 §8.2).
import { describe, expect, it } from 'vitest';
import { blockDigest, canonicalJson, docHash, stripRev } from '../../src/hash/canonical.ts';
import { fixture, type Json } from '../helpers.ts';

/** IEEE 754 onaltılık gösterimden sayı (RFC 8785 Ek B). */
function fromHex(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

describe('KK-P17a-7 KK-054-22: canonicalJson RFC 8785 test vektörleri', () => {
  it('RFC 8785 §3.2.3 örneği', () => {
    const input = JSON.parse(
      '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001], "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/", "literals": [null, true, false]}',
    );
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('RFC 8785 §3.2.3 anahtar sıralaması (UTF-16 kod birimi)', () => {
    const input = JSON.parse(
      '{"\\u20ac": "Euro Sign", "\\r": "Carriage Return", "\\ufb33": "Hebrew Letter Dalet With Dagesh", "1": "One", "\\ud83d\\ude00": "Emoji: Grinning Face", "\\u0080": "Control", "\\u00f6": "Latin Small Letter O With Diaeresis"}',
    );
    const values = Object.values(JSON.parse(canonicalJson(input)) as Record<string, string>);
    // JSON.parse tamsayı benzeri "1" anahtarını öne alır; sıra metin üzerinden doğrulanır.
    const order = [...canonicalJson(input).matchAll(/:"([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([
      'Carriage Return',
      'One',
      'Control',
      'Latin Small Letter O With Diaeresis',
      'Euro Sign',
      'Emoji: Grinning Face',
      'Hebrew Letter Dalet With Dagesh',
    ]);
    expect(values).toHaveLength(7);
  });

  it.each([
    ['0000000000000000', '0'],
    ['8000000000000000', '0'],
    ['0000000000000001', '5e-324'],
    ['8000000000000001', '-5e-324'],
    ['7fefffffffffffff', '1.7976931348623157e+308'],
    ['ffefffffffffffff', '-1.7976931348623157e+308'],
    ['4340000000000000', '9007199254740992'],
    ['c340000000000000', '-9007199254740992'],
    ['4430000000000000', '295147905179352830000'],
    ['44b52d02c7e14af5', '9.999999999999997e+22'],
    ['44b52d02c7e14af6', '1e+23'],
    ['44b52d02c7e14af7', '1.0000000000000001e+23'],
    ['444b1ae4d6e2ef4e', '999999999999999700000'],
    ['444b1ae4d6e2ef4f', '999999999999999900000'],
    ['444b1ae4d6e2ef50', '1e+21'],
    ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
    ['3eb0c6f7a0b5ed8d', '0.000001'],
    ['41b3de4355555553', '333333333.3333332'],
    ['41b3de4355555554', '333333333.33333325'],
    ['41b3de4355555555', '333333333.3333333'],
    ['41b3de4355555556', '333333333.3333334'],
    ['41b3de4355555557', '333333333.33333343'],
    ['becbf647612f3696', '-0.0000033333333333333333'],
    ['43143ff3c1cb0959', '1424953923781206.2'],
  ])('RFC 8785 Ek B sayı %s -> %s', (hex, expected) => {
    expect(canonicalJson(fromHex(hex))).toBe(expected);
  });

  it('NaN ve sonsuz reddedilir; undefined nesne alanı atlanır', () => {
    expect(() => canonicalJson(fromHex('7fffffffffffffff'))).toThrow();
    expect(() => canonicalJson(fromHex('7ff0000000000000'))).toThrow();
    expect(canonicalJson({ b: 1, a: undefined, c: [undefined] })).toBe('{"b":1,"c":[null]}');
  });
});

describe('KK-P17a-7: docHash ve blockDigest', () => {
  const base = (): Json => fixture('petition-full.json');

  it('docHash rev değerlerinden bağımsızdır, SHA-256 onaltılık', async () => {
    const a = base();
    const b = JSON.parse(JSON.stringify(a).replaceAll('"rev":1', '"rev":7')) as Json;
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
    const ha = await docHash(a);
    expect(ha).toMatch(/^[0-9a-f]{64}$/);
    expect(await docHash(b)).toBe(ha);
  });

  it('docHash içerik, rol veya blockId değişince değişir; anahtar sırası etkilemez', async () => {
    const a = base();
    const h = await docHash(a);
    const text = JSON.stringify(a);
    expect(await docHash(JSON.parse(text.replace('Örnek Kişi A', 'Örnek Kişi C')))).not.toBe(h);
    expect(
      await docHash(JSON.parse(text.replace('"role":"generic"', '"role":"freeSection"'))),
    ).not.toBe(h);
    expect(await docHash(JSON.parse(text.replace('b-PF0001', 'b-PF000Z')))).not.toBe(h);
    const reordered = JSON.parse(text, (_k, v: unknown) =>
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Json).reverse())
        : v,
    ) as Json;
    expect(await docHash(reordered)).toBe(h);
  });

  it('stripRev yalnız attrs.rev çıkarır; blockDigest blok başına değişir', async () => {
    const s = { type: 'section', attrs: { blockId: 'b-7Q2K9D', rev: 3, role: 'generic' }, rev: 1 };
    expect(stripRev(s)).toEqual({
      type: 'section',
      attrs: { blockId: 'b-7Q2K9D', role: 'generic' },
      rev: 1,
    });
    const d = base() as { content: Json[] };
    const [first, second] = d.content;
    expect(await blockDigest(first)).not.toBe(await blockDigest(second));
    expect(await blockDigest({ ...first, attrs: { ...(first?.attrs as Json), rev: 9 } })).toBe(
      await blockDigest(first),
    );
  });
});
