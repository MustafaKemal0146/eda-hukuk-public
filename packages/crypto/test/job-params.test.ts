// @tk TK-06
// KK-P04a-11 (KK-045-5) önkoşulu: e-posta iş parametresi mühürleme. Bilinen-cevap vektörleri bağımsız
// node:crypto hesabıyla üretildi (test/vectors/job-params.json; sentetik anahtar ve belirteç).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  deriveJobParamsKey,
  type JobParamsContext,
  jobParamsAad,
  sealJobParams,
  unsealJobParams,
} from '../src/index.ts';
import { sealJobParamsWithNonce } from '../src/job-params.ts';
import { flipByte, hex } from './load-vectors.ts';

type Vec = {
  kek: string;
  nonce: string;
  key: string;
  cases: (JobParamsContext & { params: Record<string, string>; aad: string; sealed: string })[];
};
const v = JSON.parse(
  readFileSync(new URL('./vectors/job-params.json', import.meta.url), 'utf8'),
) as Vec;
const kek = hex(v.kek);

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof CryptoError ? e.code : 'other';
  }
  return undefined;
}

describe('KK-P04a-11: sealJobParams / unsealJobParams', () => {
  it('HKDF anahtarı, AAD ve mühür bilinen cevaplarla aynı', () => {
    expect(deriveJobParamsKey(kek).toString('hex')).toBe(v.key);
    for (const c of v.cases) {
      const ctx = { deliveryId: c.deliveryId, template: c.template, userId: c.userId };
      expect(jobParamsAad(ctx).toString('hex')).toBe(c.aad);
      expect(sealJobParamsWithNonce(kek, ctx, c.params, hex(v.nonce)).toString('hex')).toBe(
        c.sealed,
      );
      expect(unsealJobParams(kek, ctx, hex(c.sealed))).toEqual(c.params);
    }
  });

  it('gidiş-dönüş; her mühür farklı nonce kullanır', () => {
    const ctx = v.cases[0] as JobParamsContext;
    const a = sealJobParams(kek, ctx, { token: 'abc' });
    const b = sealJobParams(kek, ctx, { token: 'abc' });
    expect(a.equals(b)).toBe(false);
    expect(unsealJobParams(kek, ctx, a)).toEqual({ token: 'abc' });
    expect(a.toString('utf8')).not.toContain('abc');
  });

  it('AAD (teslimat, şablon, kullanıcı) değişince auth_failed', () => {
    const c = v.cases[0];
    if (c === undefined) throw new Error('vektör yok');
    const sealed = hex(c.sealed);
    const ctx = { deliveryId: c.deliveryId, template: c.template, userId: c.userId };
    expect(code(() => unsealJobParams(kek, { ...ctx, template: 'password_reset' }, sealed))).toBe(
      'auth_failed',
    );
    expect(
      code(() =>
        unsealJobParams(
          kek,
          { ...ctx, deliveryId: '00000000-0000-7000-8000-0000000000d9' },
          sealed,
        ),
      ),
    ).toBe('auth_failed');
    expect(code(() => unsealJobParams(kek, { ...ctx, userId: null }, sealed))).toBe('auth_failed');
  });

  it('bozuk bayt ve yanlış anahtar auth_failed; hata mesajında belirteç yok', () => {
    const c = v.cases[1];
    if (c === undefined) throw new Error('vektör yok');
    const ctx = { deliveryId: c.deliveryId, template: c.template, userId: c.userId };
    for (const i of [0, 20, hex(c.sealed).length - 1]) {
      expect(code(() => unsealJobParams(kek, ctx, flipByte(hex(c.sealed), i)))).toBe('auth_failed');
    }
    let msg = '';
    try {
      unsealJobParams(Buffer.alloc(32, 7), ctx, hex(c.sealed));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toContain('ornek-belirtec');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('geçersiz şablon kodu ve metin dışı parametre reddedilir', () => {
    const ctx = { deliveryId: v.cases[0]?.deliveryId ?? '', template: 'Kötü Ad', userId: null };
    expect(code(() => sealJobParams(kek, ctx, { token: 'x' }))).toBe('invalid_input');
    expect(
      code(() =>
        sealJobParams(kek, { ...ctx, template: 'verify_email' }, {
          token: 1,
        } as unknown as Record<string, string>),
      ),
    ).toBe('invalid_input');
  });
});
