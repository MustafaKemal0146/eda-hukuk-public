// @tk TK-08
// KK-P08-4 (KK-026-4, KK-026-5): mask() determinizm, idempotans, çakışma çözümü, köken politikası.
// KK-P08-6 (KK-026-9, KK-026-10): verifyMasked mutasyon testi, fail-closed (kısmi çıktı yok).
// KK-P08-10 (KK-026-8): token taklidi kaçışı. KK-026-18: girdi sınırları ve pencereleme.
// KK-026-22: serileştirme kilidi.
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { compileDictionary, type DictionaryInternal } from '../src/dictionary/compile.ts';
import { KvkkMaskingError } from '../src/errors.ts';
import { mask } from '../src/mask.ts';
import type { CryptoPort } from '../src/ports.ts';
import {
  type CompiledDictionary,
  DICTIONARY_INTERNAL,
  type MaskInput,
  type MaskResult,
  type OriginKind,
} from '../src/types.ts';
import { unmaskText } from '../src/unmask/stream.ts';
import { verifyMasked } from '../src/verify.ts';
import { AHMET, dictOf, K_CONV, maskedText, maskOne, maskSegments } from './support/helpers.ts';
import { nodeCryptoPort } from './support/node-crypto-port.ts';

const SAMPLE =
  "Müvekkil Ahmet Yılmaz (TC 10000000146) Mavi Yapı A.Ş.'ye karşı; Sayın Yurdagül Perşembe tanık. " +
  'Tel 0532 123 45 67, e-posta ahmet@example.com, IBAN TR33 0006 1005 1978 6457 8413 26. ' +
  'Adres: Gültepe Mahallesi Lale Sokak No: 5 Çankaya/Ankara. Doğum tarihi: 12.03.1985. Diyabet tanısı var.';

function texts(r: MaskResult): string[] {
  return r.segments.map((s) => s.text);
}

function expectCode(fn: () => unknown, code: string): KvkkMaskingError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(KvkkMaskingError);
    const err = e as KvkkMaskingError;
    expect(err.code).toBe(code);
    // Mesaj içerik taşımaz (026 §7.6.4).
    expect(err.message).not.toMatch(/Ahmet|Yılmaz|10000000146|example/u);
    return err;
  }
  throw new Error('hata bekleniyordu');
}

describe('KK-P08-4: determinizm, idempotans, önbellek (KK-026-4)', () => {
  it('KK-P08-4 iki koşu bayt eşit', () => {
    const d = dictOf(AHMET);
    const a = maskOne(SAMPLE, d);
    const b = maskOne(SAMPLE, dictOf(AHMET));
    expect(texts(a)).toEqual(texts(b));
    expect(a.table.tokens()).toEqual(b.table.tokens());
    expect(a.stats.byTip).toEqual(b.stats.byTip);
  });

  it('KK-P08-4 idempotan: mask(mask(x)) yeni span üretmez', () => {
    const d = dictOf(AHMET);
    const once = maskOne(SAMPLE, d);
    const twice = maskOne(once.segments[0]?.text ?? '', d);
    expect(twice.segments[0]?.spans).toEqual([]);
  });

  it('KK-P08-4 önbellekli = önbelleksiz (026 §11.3)', () => {
    const d = dictOf(AHMET);
    const cache = new Map<string, unknown>();
    const segs = [
      { id: 'a', text: SAMPLE, origin: 'user_text' as const },
      { id: 'b', text: 'Yurdagül Perşembe ikinci turda.', origin: 'user_text' as const },
    ];
    const plain = maskSegments(segs, d);
    const input = (): MaskInput => ({
      segments: segs,
      convKey: K_CONV,
      dictionary: d,
      options: { tokenHashChars: 4, maskOwnCaseNumber: true },
      crypto: nodeCryptoPort,
      cache: { get: (k) => cache.get(k), set: (k, v) => cache.set(k, v) },
    });
    const first = mask(input());
    const second = mask(input());
    expect(cache.size).toBe(2);
    expect(texts(first)).toEqual(texts(plain));
    expect(texts(second)).toEqual(texts(plain));
  });

  it('KK-P08-4 gidiş-dönüş: unmaskText(mask(x)) özgün metni verir', () => {
    const d = dictOf(AHMET);
    const r = maskOne(SAMPLE, d);
    expect(unmaskText(r.segments[0]?.text ?? '', r.table)).toBe(SAMPLE);
  });

  it('KK-P08-4 her kimlik aynı tokenı alır (çok segment)', () => {
    const r = maskSegments(
      [
        { id: 'a', text: 'TC 10000000146', origin: 'user_text' },
        { id: 'b', text: 'Tekrar: 10000000146.', origin: 'case_tool_result' },
      ],
      null,
    );
    expect(texts(r)).toEqual(['TC [TCKN_RQWA]', 'Tekrar: [TCKN_RQWA].']);
  });
});

/** HMAC çıktısını kimliğe göre sabitleyen sahte port (çakışma senaryosu). */
function fakeCrypto(table: Record<string, number[]>): CryptoPort {
  return {
    hkdfSha256: nodeCryptoPort.hkdfSha256,
    hmacSha256: (_key, data) => {
      const s = new TextDecoder().decode(data);
      for (const [needle, bytes] of Object.entries(table)) {
        if (s.endsWith(needle)) {
          const out = new Uint8Array(32);
          out.set(bytes);
          return out;
        }
      }
      return nodeCryptoPort.hmacSha256(new Uint8Array(32), data);
    },
  };
}

function maskWith(crypto: CryptoPort, text: string): MaskResult {
  return mask({
    segments: [{ id: 's', text, origin: 'user_text' }],
    convKey: K_CONV,
    dictionary: null,
    options: { tokenHashChars: 4, maskOwnCaseNumber: true },
    crypto,
  });
}

describe('KK-P08-4: çakışma çözümü (026 §4.5)', () => {
  const A = '10000000146';
  const B = '10000000214';
  it('KK-P08-4 ilk 4 eşit -> her ikisi 6 karakter', () => {
    // İlk 20 bit eşit, 21-24. bitler farklı: base32 ilk 4 aynı, 5. farklı.
    const r = maskWith(fakeCrypto({ [A]: [0, 0, 0], [B]: [0, 0, 0x08] }), `${A} ve ${B}`);
    expect(r.segments[0]?.text).toBe('[TCKN_AAAAAA] ve [TCKN_AAAAQA]');
  });

  it('KK-P08-4 6 karakterde de eşit -> TOKEN_COLLISION, kısmi çıktı yok', () => {
    const crypto = fakeCrypto({ [A]: [0, 0, 0, 0], [B]: [0, 0, 0, 0x02] });
    expectCode(() => maskWith(crypto, `${A} ve ${B}`), 'TOKEN_COLLISION');
  });

  it('KK-P08-4 tokenHashChars=6 seçeneği tüm tokenları 6 karakter yazar', () => {
    const r = maskSegments([{ id: 's', text: 'TC 10000000146', origin: 'user_text' }], null, {
      tokenHashChars: 6,
    });
    expect(r.segments[0]?.text).toBe('TC [TCKN_RQWAYG]');
  });
});

const CASE_DICT = (): CompiledDictionary =>
  dictOf({
    ...AHMET,
    cases: [{ id: 'k1', esasNo: '2024/118' }],
  });

function maskedIn(origin: OriginKind, text: string, dict: CompiledDictionary | null = CASE_DICT()) {
  return maskedText(text, dict, origin);
}

const USER_LIKE: OriginKind[] = [
  'user_text',
  'attachment',
  'file_mention',
  'case_binding',
  'case_tool_result',
];
const PUBLIC: OriginKind[] = ['corpus', 'live_source'];

describe('KK-P08-4: köken politikası tablosu satır satır (026 §5, KK-026-5)', () => {
  it('KK-P08-4 satır 1: sözlük tüm kökenlerde', () => {
    for (const o of [...USER_LIKE, ...PUBLIC, 'system' as const]) {
      expect(maskedIn(o, 'Ahmet Yılmaz geldi.')).toMatch(/^\[KISI_[A-Z2-7]{4}\] geldi\.$/u);
    }
  });

  it('KK-P08-4 satır 2: öğrenilen yüzey tüm kökenlerde (kullanıcıdan öğrenilir)', () => {
    for (const o of [...USER_LIKE, ...PUBLIC, 'system' as const]) {
      const r = maskSegments([
        { id: 'u', text: 'Sayın Yurdagül Perşembe başvurdu.', origin: 'user_text' },
        { id: 'x', text: 'Yurdagül Perşembe hakkında not.', origin: o },
      ]);
      expect(r.segments[1]?.text).toMatch(/^\[KISI_[A-Z2-7]{4}\] hakkında not\.$/u);
    }
  });

  it('KK-P08-4 satır 3: IBAN, EPOSTA, TCKN, TEL, PLAKA, TARIH_DOGUM tüm kökenlerde', () => {
    const t =
      'TR33 0006 1005 1978 6457 8413 26 x@example.com 10000000146 0532 123 45 67 34 ABC 123 doğum tarihi 12.03.1985';
    for (const o of [...USER_LIKE, ...PUBLIC, 'system' as const]) {
      const r = maskOne(t, null, o);
      const tips = r.segments[0]?.spans.map((s) => s.tip);
      expect(tips).toEqual(['IBAN', 'EPOSTA', 'TCKN', 'TEL', 'PLAKA', 'TARIH_DOGUM']);
    }
  });

  it('KK-P08-4 satır 4: VKN bağlamsız yalnız kullanıcı kökenlerinde; bağlamlı her yerde', () => {
    for (const o of USER_LIKE) {
      expect(maskedIn(o, 'Numara 1234567890 kayıtlı.', null)).toMatch(/\[VKN_/u);
    }
    for (const o of [...PUBLIC, 'system' as const]) {
      expect(maskedIn(o, 'Numara 1234567890 kayıtlı.', null)).toBe('Numara 1234567890 kayıtlı.');
      expect(maskedIn(o, 'Vergi no: 1234567890 kayıtlı.', null)).toMatch(/\[VKN_/u);
    }
  });

  it('KK-P08-4 satır 5: DOSYA sözlük girdisi kullanıcı ve sistemde maskelenir, korpusta maskelenmez', () => {
    for (const o of [...USER_LIKE, 'system' as const]) {
      expect(maskedIn(o, 'Dosya 2024/118 E. sayılı.')).toMatch(
        /^Dosya \[DOSYA_[A-Z2-7]{4}\] sayılı\.$/u,
      );
    }
    for (const o of PUBLIC) {
      expect(maskedIn(o, 'Dosya 2024/118 E. sayılı.')).toBe('Dosya 2024/118 E. sayılı.');
    }
    // maskOwnCaseNumber=false: DOSYA kaynağı üretilmez.
    const off = dictOf({ cases: [{ id: 'k1', esasNo: '2024/118' }] }, false);
    expect(maskedIn('user_text', 'Dosya 2024/118 E.', off)).toBe('Dosya 2024/118 E.');
  });

  it('KK-P08-4 satır 6: SAGLIK yalnız kullanıcı kökenlerinde', () => {
    for (const o of USER_LIKE) expect(maskedIn(o, 'Kemoterapi aldı.', null)).toMatch(/\[SAGLIK_/u);
    for (const o of [...PUBLIC, 'system' as const]) {
      expect(maskedIn(o, 'Kemoterapi aldı.', null)).toBe('Kemoterapi aldı.');
    }
  });

  it('KK-P08-4 satır 7: SIRKET, ADRES, KISI sezgileri yalnız kullanıcı kökenlerinde', () => {
    const t = 'Sayın Mehmet Kaya ile Ege Gıda A.Ş. Gültepe Mahallesi Lale Sokak No: 7 adresinde.';
    for (const o of USER_LIKE) {
      const tips = maskOne(t, null, o).segments[0]?.spans.map((s) => s.tip);
      expect(tips).toEqual(['KISI', 'SIRKET', 'ADRES']);
    }
    for (const o of [...PUBLIC, 'system' as const]) expect(maskedIn(o, t, null)).toBe(t);
  });

  it('KK-P08-4 serbest "2024/118 E." hiçbir kökende maskelenmez', () => {
    for (const o of [...USER_LIKE, ...PUBLIC, 'system' as const]) {
      const t = 'Emsal: Yargıtay 3. HD 2023/4567 E., 2022/99 K.';
      expect(maskedIn(o, t)).toBe(t);
    }
  });
});

describe('KK-P08-6: verifyMasked mutasyon testi (KK-026-9)', () => {
  it('KK-P08-6 doğru maskelenmiş sonuç ok', () => {
    const d = dictOf(AHMET);
    expect(verifyMasked(maskOne(SAMPLE, d), d)).toEqual({ ok: true, hits: [] });
  });

  it('KK-P08-6 bilerek maskeleme dışı bırakılan yüzey yakalanır (mutasyon)', () => {
    const d = dictOf(AHMET);
    const r = maskOne(SAMPLE, d);
    const seg = r.segments[0];
    if (!seg) throw new Error('segment yok');
    const span = seg.spans.find((s) => s.tip === 'KISI' && s.source === 'dict');
    if (!span) throw new Error('KISI yok');
    seg.text = `${seg.text.slice(0, span.maskedStart)}Ahmet Yılmaz${seg.text.slice(span.maskedEnd)}`;
    const v = verifyMasked(r, d);
    expect(v.ok).toBe(false);
    expect(v.hits.some((h) => h.tip === 'KISI' && h.kind === 'surface')).toBe(true);
    // Rapor içerik taşımaz.
    expect(JSON.stringify(v)).not.toMatch(/Ahmet|Yılmaz/u);
  });

  it('KK-P08-6 tablosuz token yakalanır; yapısal kaçak yakalanır', () => {
    const r = maskOne('TC 10000000146', null);
    const seg = r.segments[0];
    if (!seg) throw new Error('segment yok');
    seg.text = 'TC [TCKN_ZZZZ] ve 10000000146';
    const v = verifyMasked(r, null);
    expect(v.hits.map((h) => h.kind).sort()).toEqual(['surface', 'unknown_token']);
  });
});

describe('KK-P08-6: fail-closed, kısmi çıktı yok (026 §12, KK-026-10)', () => {
  const base = (over: Partial<MaskInput>): MaskInput => ({
    segments: [{ id: 's', text: SAMPLE, origin: 'user_text' }],
    convKey: K_CONV,
    dictionary: null,
    options: { tokenHashChars: 4, maskOwnCaseNumber: true },
    crypto: nodeCryptoPort,
    ...over,
  });

  it('KK-P08-6 algılayıcı istisnası -> DETECTOR_FAILED', () => {
    const d = dictOf(AHMET);
    const internal = d[DICTIONARY_INTERNAL] as DictionaryInternal;
    internal.core.automaton.scan = () => {
      throw new Error('enjekte edilen algılayıcı hatası Ahmet Yılmaz');
    };
    const err = expectCode(() => mask(base({ dictionary: d })), 'DETECTOR_FAILED');
    expect(err.segmentId).toBe('s');
  });

  it('KK-P08-6 bozuk sözlük -> DICTIONARY_UNAVAILABLE', () => {
    const fake = {
      version: 'x',
      entries: 0,
      surfaces: 0,
      canonMap: new Map(),
      ambiguous: new Set(),
    };
    expectCode(
      () => mask(base({ dictionary: fake as unknown as CompiledDictionary })),
      'DICTIONARY_UNAVAILABLE',
    );
    expectCode(
      () =>
        compileDictionary(
          [{ ownerId: 'o', tip: 'KISI', identity: 'o', display: 'A B', surfaces: ['A B', 'B A'] }],
          {
            crypto: nodeCryptoPort,
            limits: { dictionaryMaxSurfaces: 1 },
          },
        ),
      'DICTIONARY_UNAVAILABLE',
    );
  });

  it('KK-P08-6 CryptoPort hatası -> INTERNAL', () => {
    const broken: CryptoPort = {
      hkdfSha256: nodeCryptoPort.hkdfSha256,
      hmacSha256: () => {
        throw new Error('kripto');
      },
    };
    expectCode(() => mask(base({ crypto: broken })), 'INTERNAL');
  });

  it('KK-P08-6 bütçe aşımı -> BUDGET_EXCEEDED; girdi sınırı -> INPUT_TOO_LARGE', () => {
    expectCode(() => mask(base({ limits: { windowBudgetFactor: 0.01 } })), 'BUDGET_EXCEEDED');
    expectCode(() => mask(base({ limits: { maskInputMaxChars: 10 } })), 'INPUT_TOO_LARGE');
    expectCode(() => mask(base({ limits: { learnedMaxSurfaces: 1 } })), 'BUDGET_EXCEEDED');
  });
});

describe('KK-P08-10: token taklidi kaçışı (026 §7.6.2, KK-026-8)', () => {
  it('KK-P08-10 "[KISI_ABCD]" -> "［KISI_ABCD]"; geri çözmede dokunulmaz; [K3] değişmez', () => {
    const r = maskOne('Model [KISI_ABCD] ve [kisi_abcdef] yazdı, kaynak [K3].', null);
    const out = r.segments[0]?.text ?? '';
    expect(out).toBe('Model ［KISI_ABCD] ve ［kisi_abcdef] yazdı, kaynak [K3].');
    expect(r.stats.escaped).toBe(2);
    expect(unmaskText(out, r.table)).toBe(out);
  });

  it('KK-P08-10 gerçek bir kişinin tokenı taklit edilse bile çözülmez', () => {
    const d = dictOf(AHMET);
    const real = maskOne('Ahmet Yılmaz', d);
    const token = real.table.tokens()[0] ?? '';
    const forged = maskOne(`Kullanıcı ${token} yazdı ve Ahmet Yılmaz geldi.`, d);
    const out = forged.segments[0]?.text ?? '';
    expect(out.startsWith(`Kullanıcı ［${token.slice(1)}`)).toBe(true);
    expect(unmaskText(out, forged.table)).toBe(
      `Kullanıcı ［${token.slice(1)} yazdı ve Ahmet Yılmaz geldi.`,
    );
  });

  it('KK-P08-10 preMasked segmentte tokenlar korunur, kaçışlanmaz', () => {
    const r = maskSegments([
      {
        id: 'r',
        text: 'Düşünce: [KISI_ABCD] ile 10000000146.',
        origin: 'user_text',
        preMasked: true,
      },
    ]);
    expect(r.segments[0]?.text).toBe('Düşünce: [KISI_ABCD] ile [TCKN_RQWA].');
  });
});

describe('KK-026-18: girdi sınırları ve pencereleme', () => {
  it('KK-026-18 100.000 karakteri aşan segment = parçalanmış segmentler (bayt eşit)', () => {
    const para = `${SAMPLE}\n`;
    const half = para.repeat(Math.ceil(60_000 / para.length));
    const d = dictOf(AHMET);
    const whole = maskSegments([{ id: 'w', text: half + half, origin: 'user_text' }], d);
    const split = maskSegments(
      [
        { id: 'a', text: half, origin: 'user_text' },
        { id: 'b', text: half, origin: 'user_text' },
      ],
      d,
    );
    expect((half + half).length).toBeGreaterThan(100_000);
    expect(whole.segments[0]?.text).toBe(split.segments.map((s) => s.text).join(''));
  });
});

describe('KK-026-22: serileştirme kilidi', () => {
  it('KK-026-22 MaskResult, tablo ve sözlük içerik sızdırmaz', () => {
    const d = dictOf(AHMET);
    const r = maskOne(SAMPLE, d);
    expect(JSON.stringify(r)).toBe('"[REDACTED]"');
    expect(JSON.stringify(r.table)).toBe('"[REDACTED]"');
    expect(JSON.stringify(d)).toBe('"[REDACTED]"');
    expect(inspect(r.table)).toBe('[REDACTED]');
    expect(inspect(r)).not.toMatch(/Ahmet/u);
  });
});
