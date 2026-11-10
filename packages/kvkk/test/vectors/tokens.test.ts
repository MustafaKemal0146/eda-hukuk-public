// @tk TK-08
// KK-P08-1 (KK-026-1): token test vektörleri birebir; KK-P08-2: token grameri.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mask } from '../../src/mask.ts';
import { base32, deriveConvKey, formatToken, tokenHash } from '../../src/tokens/derive.ts';
import { matchTokenAt, TOKEN_MAX_LEN, tokenRegex } from '../../src/tokens/grammar.ts';
import type { Tip } from '../../src/types.ts';
import { nodeCryptoPort as C } from '../support/node-crypto-port.ts';

const V = JSON.parse(readFileSync(new URL('./token-vectors.json', import.meta.url), 'utf8')) as {
  hmacPseudonymKeyHex: string;
  scopeId: string;
  kConvHex: string;
  tokens: { tip: Tip; identity: string; token4: string; hash6: string }[];
};
const KEY = Uint8Array.from(Buffer.from(V.hmacPseudonymKeyHex, 'hex'));

describe('KK-P08-1: token vektörleri (026 §4.6, KK-026-1)', () => {
  it('KK-P08-1 anahtar 00..1f', () => {
    expect([...KEY]).toEqual(Array.from({ length: 32 }, (_, i) => i));
  });

  it('KK-P08-1 K_conv hex birebir', () => {
    expect(Buffer.from(deriveConvKey(C, KEY, V.scopeId)).toString('hex')).toBe(V.kConvHex);
  });

  it('KK-P08-1 scopeId ASCII küçük harfe getirilir (kanonik UUID)', () => {
    const upper = '01900000-0000-7000-8000-00000000000A';
    const lower = '01900000-0000-7000-8000-00000000000a';
    expect(deriveConvKey(C, KEY, upper)).toEqual(deriveConvKey(C, KEY, lower));
  });

  for (const t of V.tokens) {
    it(`KK-P08-1 ${t.tip} -> ${t.token4} (6: ${t.hash6})`, () => {
      const k = deriveConvKey(C, KEY, V.scopeId);
      const h = tokenHash(C, k, t.tip, t.identity);
      expect(formatToken(t.tip, h, 4)).toBe(t.token4);
      expect(h.slice(0, 6)).toBe(t.hash6);
      expect(formatToken(t.tip, h, 6)).toBe(`[${t.tip}_${t.hash6}]`);
    });
  }

  it('KK-P08-1 serbest TCKN ve e-posta mask() içinde vektör tokenını alır', () => {
    const k = deriveConvKey(C, KEY, V.scopeId);
    const r = mask({
      segments: [{ id: 's', text: 'TC 10000000146, ahmet@example.com', origin: 'user_text' }],
      convKey: k,
      dictionary: null,
      options: { tokenHashChars: 4, maskOwnCaseNumber: true },
      crypto: C,
    });
    expect(r.segments[0]?.text).toBe('TC [TCKN_RQWA], [EPOSTA_6J45]');
  });

  it('KK-P08-1 base32 RFC 4648 (dolgusuz) bilinen vektörler', () => {
    const enc = (s: string) => base32(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('MY');
    expect(enc('fo')).toBe('MZXQ');
    expect(enc('foo')).toBe('MZXW6');
    expect(enc('foob')).toBe('MZXW6YQ');
    expect(enc('fooba')).toBe('MZXW6YTB');
    expect(enc('foobar')).toBe('MZXW6YTBOI');
  });
});

describe('KK-P08-2: token grameri (026 §4.1)', () => {
  it('KK-P08-2 en uzun token 20 karakter', () => {
    expect(TOKEN_MAX_LEN).toBe(20);
    expect('[TARIH_DOGUM_ABCDEF]'.length).toBe(20);
  });

  it('KK-P08-2 tam, yarım ve uyumsuz', () => {
    expect(matchTokenAt('[KISI_ABCD]', 0, true)).toMatchObject({ kind: 'complete', end: 11 });
    expect(matchTokenAt('[KISI_ABCDEF]', 0, true)).toMatchObject({ kind: 'complete', end: 13 });
    expect(matchTokenAt('[KISI_AB', 0, false)).toEqual({ kind: 'partial' });
    expect(matchTokenAt('[KISI_AB', 0, true)).toEqual({ kind: 'no' });
    expect(matchTokenAt('[KISI_ABCDE]', 0, true)).toEqual({ kind: 'no' });
    expect(matchTokenAt('[K3]', 0, false)).toEqual({ kind: 'no' });
    expect(matchTokenAt('[KISI_AB1D]', 0, true)).toEqual({ kind: 'no' });
    expect(matchTokenAt('[TARIH_DOGUM_ABCD]', 0, true)).toMatchObject({ tip: 'TARIH_DOGUM' });
  });

  it('KK-P08-2 ASCII büyük/küçük harf toleransı; kanonik yazım büyük harf', () => {
    const m = matchTokenAt('[kisi_abcd]', 0, true);
    expect(m).toMatchObject({ kind: 'complete', token: '[KISI_ABCD]' });
  });

  it('KK-P08-2 12 tip kodu ve gramer regex', () => {
    const rx = tokenRegex();
    expect('[SAGLIK_ABCD] [DOSYA_ABCDEF] [X_ABCD] [KISI_ABC1]'.match(rx)).toEqual([
      '[SAGLIK_ABCD]',
      '[DOSYA_ABCDEF]',
    ]);
  });
});
