// @tk TK-12
// Alıntı denetimi (025 §6): tırnak çıkarma, `[K#]` atfetme ve normalize alt dize eşleşmesi. Kaynak
// metinler kurgusal biçim örnekleridir (025 §6.6), gerçek karar değildir.
import { describe, expect, it } from 'vitest';
import {
  extractAttributedQuotes,
  extractQuotes,
  matchQuote,
  quoteCmpNorm,
} from '../src/kunye/index.ts';

const OPTS = { minChars: 20, windowChars: 160 };
const FRAG = { fragmentMinChars: 12 };
const SOURCE =
  'Somut olayda, işçinin fazla çalışma ücretine hak kazanması için fazla çalışmanın yazılı delille ' +
  'ispatı gerekir. Mahkemece bu yön gözetilmeden eksik inceleme ile hüküm kurulması İSABETSİZDİR.';

describe('extractQuotes: tırnak türleri ve dengesiz tırnak', () => {
  it('düz ve tipografik tırnak çiftleri çıkarılır', () => {
    const text =
      'Karar "fazla çalışmanın yazılı delille ispatı gerekir" der; ayrıca “eksik inceleme ile hüküm kurulması” denir.';
    expect(extractQuotes(text, OPTS).map((q) => q.quote)).toEqual([
      'fazla çalışmanın yazılı delille ispatı gerekir',
      'eksik inceleme ile hüküm kurulması',
    ]);
  });

  it('„…“ ve «…» çiftleri de alıntıdır', () => {
    const text =
      'Bir „eksik inceleme ile hüküm kurulması“ ve «fazla çalışmanın yazılı delille» ifadesi.';
    expect(extractQuotes(text, OPTS)).toHaveLength(2);
  });

  it('kısa tırnak (terim) denetlenmez', () => {
    expect(extractQuotes('Bu "kıdem tazminatı" meselesidir.', OPTS)).toEqual([]);
  });

  it('dengesiz tırnak yoksayılır; paragraf sınırını aşan çift kurulmaz', () => {
    expect(extractQuotes('Kararda "fazla çalışmanın yazılı delille ispatı', OPTS)).toEqual([]);
    expect(
      extractQuotes('İlk "fazla çalışmanın yazılı\n\ndelille ispatı gerekir" ikinci.', OPTS),
    ).toEqual([]);
  });

  it('tek satır sonu alıntıyı bölmez', () => {
    const qs = extractQuotes(
      'Kararda "fazla çalışmanın yazılı\ndelille ispatı gerekir" denir.',
      OPTS,
    );
    expect(qs).toHaveLength(1);
  });
});

describe('extractAttributedQuotes: atfetme', () => {
  it('alıntıdan sonraki ilk etikete atfedilir', () => {
    const qs = extractAttributedQuotes(
      'Kararda "fazla çalışmanın yazılı delille ispatı gerekir" denilmiştir [K2].',
      OPTS,
    );
    expect(qs.map((q) => q.ref)).toEqual(['K2']);
  });

  it('sonra etiket yoksa önceki etikete atfedilir', () => {
    const qs = extractAttributedQuotes(
      '[K3] kararında "fazla çalışmanın yazılı delille ispatı gerekir" denilmiştir.',
      OPTS,
    );
    expect(qs.map((q) => q.ref)).toEqual(['K3']);
  });

  it('cümle sonu ötesindeki etiket atıf sayılmaz; etiketsiz alıntı dönmez', () => {
    expect(
      extractAttributedQuotes(
        'Kanun "fazla çalışmanın yazılı delille ispatı gerekir" der. Başka bir kararda da [K1].',
        OPTS,
      ),
    ).toEqual([]);
  });

  it('"9. Hukuk" gibi sıra sayısı cümle sonu sayılmaz', () => {
    const qs = extractAttributedQuotes(
      '"fazla çalışmanın yazılı delille ispatı gerekir" (Yargıtay 9. Hukuk Dairesi) [K1].',
      OPTS,
    );
    expect(qs.map((q) => q.ref)).toEqual(['K1']);
  });

  it('başka paragraftaki ya da pencere dışındaki etiket atıf sayılmaz', () => {
    expect(
      extractAttributedQuotes('"fazla çalışmanın yazılı delille ispatı gerekir"\n\n[K1]', OPTS),
    ).toEqual([]);
    const far = `"fazla çalışmanın yazılı delille ispatı gerekir" ${'x'.repeat(200)} [K1]`;
    expect(extractAttributedQuotes(far, OPTS)).toEqual([]);
  });

  it('çoklu etiket grubu ve yan yana etiketler belirsizdir: atıf yapılmaz', () => {
    expect(
      extractAttributedQuotes('"fazla çalışmanın yazılı delille ispatı gerekir" [K1, K2].', OPTS),
    ).toEqual([]);
    expect(
      extractAttributedQuotes('"fazla çalışmanın yazılı delille ispatı gerekir" [K1][K2].', OPTS),
    ).toEqual([]);
    expect(
      extractAttributedQuotes(
        '[K1][K2] şöyle der: "fazla çalışmanın yazılı delille ispatı".',
        OPTS,
      ),
    ).toEqual([]);
  });

  it('her alıntı kendi etiketine atfedilir', () => {
    const qs = extractAttributedQuotes(
      '"fazla çalışmanın yazılı delille ispatı" [K1] ve "eksik inceleme ile hüküm kurulması" [K2].',
      OPTS,
    );
    expect(qs.map((q) => q.ref)).toEqual(['K1', 'K2']);
  });
});

describe('matchQuote: normalize alt dize (025 §6.6)', () => {
  it('birebir ve kısmi alıntı eşleşir', () => {
    expect(
      matchQuote('fazla çalışmanın yazılı delille ispatı gerekir', [SOURCE], FRAG).status,
    ).toBe('matched');
    expect(matchQuote('yazılı delille ispatı', [SOURCE], FRAG).status).toBe('matched');
  });

  it('kaynakta olmayan ifade uyuşmazlıktır', () => {
    expect(matchQuote('fazla çalışmanın tanık ile ispatı gerekir', [SOURCE], FRAG).status).toBe(
      'mismatch',
    );
  });

  it('satır kırılması, boşluk, noktalama ve satır sonu tiresi eşleşmeyi bozmaz', () => {
    const broken = 'işçinin fazla çalışma ücretine hak ka-\nzanması için,   fazla\nçalışmanın';
    expect(
      matchQuote(
        'işçinin fazla çalışma ücretine hak kazanması için fazla çalışmanın',
        [broken],
        FRAG,
      ).status,
    ).toBe('matched');
    expect(
      matchQuote('fazla çalışmanın  yazılı\ndelille — ispatı gerekir!', [SOURCE], FRAG).status,
    ).toBe('matched');
  });

  it('Türkçe İ/ı ve büyük-küçük harf farkı eşleşmeyi bozmaz', () => {
    expect(matchQuote('hüküm kurulması isabetsizdir', [SOURCE], FRAG).status).toBe('matched');
    expect(matchQuote('FAZLA ÇALIŞMANIN YAZILI DELİLLE', [SOURCE], FRAG).status).toBe('matched');
    expect(quoteCmpNorm('İSABETSİZDİR')).toBe(quoteCmpNorm('isabetsizdir'));
    expect(quoteCmpNorm('ISLAH')).toBe(quoteCmpNorm('ıslah'));
  });

  it('üç nokta ile kısaltılmış alıntı: parçalar sırayla geçmelidir', () => {
    for (const mark of ['...', '…', '[…]', '[...]', '(...)']) {
      expect(
        matchQuote(`fazla çalışma ücretine ${mark} yazılı delille ispatı gerekir`, [SOURCE], FRAG)
          .status,
      ).toBe('matched');
    }
    // Sıra bozuk: ikinci parça birinciden önce geçiyor.
    expect(
      matchQuote('yazılı delille ispatı gerekir … fazla çalışma ücretine', [SOURCE], FRAG).status,
    ).toBe('mismatch');
    // Parçalardan biri kaynakta yok.
    expect(
      matchQuote('fazla çalışma ücretine … tanık beyanıyla ispat edilebilir', [SOURCE], FRAG)
        .status,
    ).toBe('mismatch');
  });

  it('kısa parçalar yok sayılır; hiç uzun parça yoksa too_short', () => {
    expect(matchQuote('işçi … delil … ispat', [SOURCE], FRAG).status).toBe('too_short');
    expect(matchQuote('kısa … yazılı delille ispatı gerekir', [SOURCE], FRAG).status).toBe(
      'matched',
    );
  });

  it('birden çok kaynak metni birlikte aranır', () => {
    expect(
      matchQuote('eksik inceleme ile hüküm kurulması', ['ilgisiz bir bölüm metni', SOURCE], FRAG)
        .status,
    ).toBe('matched');
    expect(matchQuote('eksik inceleme ile hüküm kurulması', [], FRAG).status).toBe('mismatch');
  });
});
