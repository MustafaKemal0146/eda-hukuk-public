// KK-023-1/2 (normalize altın), KK-081-1 (biçim tablosu), KK-081-2 (tarih), KK-081-3 (gidiş-dönüş),
// KK-025-1 (ofset haritası), 025 §5.4/§5.6/§8.1. Tüm numara ve adlar biçim örneğidir, gerçek karar değildir.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type ArticleRef,
  extractAll,
  formatArticleRef,
  formatDateTr,
  formatKunye,
  type KunyeRecord,
  normalizeArticleKey,
  parseCaseNo,
} from '../src/kunye/index.ts';
import { normalizeWithMap, tr_fold, tr_normalize } from '../src/text/index.ts';

const TODAY = '2026-10-10';

describe('KK-P11-18 / KK-023-1/2: tr_normalize ve tr_fold altın tablosu', () => {
  const rows: [string, string, string][] = [
    ['YARGITAY 9. HUKUK DAİRESİ', 'yargıtay 9. hukuk dairesi', 'yargitay 9. hukuk dairesi'],
    ['IĞDIR', 'ığdır', 'igdir'],
    ['İSTANBUL', 'istanbul', 'istanbul'],
    ['İçtihat', 'içtihat', 'ictihat'],
    ['4857 S.K. md.18', '4857 sayılı kanun m. 18', '4857 sayili kanun m. 18'],
    ['“kıdem” – tazminatı', '"kıdem" - tazminatı', '"kidem" - tazminati'],
    ['2021 / 1234 E.', '2021/1234 e.', '2021/1234 e.'],
  ];
  for (const [input, norm, fold] of rows) {
    it(input, () => {
      expect(tr_normalize(input)).toBe(norm);
      expect(tr_fold(input)).toBe(fold);
      expect(tr_normalize(norm)).toBe(norm);
    });
  }

  it('hâkim/hakim, satır sonu tirelemesi, sıfır genişlikli karakter', () => {
    expect(tr_normalize('Hâkim')).toBe('hakim');
    expect(tr_normalize('hü-\nküm')).toBe('hüküm');
    expect(tr_normalize('a​b­c')).toBe('abc');
  });

  it('KK-025-1: ofset haritası her normalize karakteri özgün metne bağlar', () => {
    const text = 'Önce  YARGITAY 9. HD, 2024 / 1234 E.';
    const { norm, map } = normalizeWithMap(text);
    expect(norm).toBe(tr_normalize(text));
    expect(map).toHaveLength(norm.length);
    const at = norm.indexOf('2024/1234');
    expect(text.slice(map[at], (map[at + 8] ?? 0) + 1)).toBe('2024 / 1234');
  });
});

const rec = (r: Partial<KunyeRecord> & Pick<KunyeRecord, 'courtClass'>): KunyeRecord => ({
  courtName: null,
  chamberCode: null,
  chamberName: null,
  chamberShort: null,
  esasNo: null,
  kararNo: null,
  decisionDate: null,
  unitLabel: null,
  rgText: null,
  ...r,
});

type GoldenRow = { record: KunyeRecord; full: string; short: string; index: string };
// 081 §4.2 altın tablosu `golden/kunye/format.json`'dadır (P14a.5 e).
const TABLE = (
  JSON.parse(readFileSync(new URL('./golden/kunye/format.json', import.meta.url), 'utf8')) as {
    rows: GoldenRow[];
  }
).rows.map((r) => ({ rec: rec(r.record), full: r.full, short: r.short, index: r.index }));

describe('KK-081-1: formatKunye altın tablosu', () => {
  for (const row of TABLE) {
    it(row.full, () => {
      expect(formatKunye(row.rec, 'full')).toMatchObject({ text: row.full, complete: true });
      expect(formatKunye(row.rec, 'short').text).toBe(row.short);
    });
  }

  it('esas yoksa kısa stil karar numarasını yazar; ikisi de yoksa eksik', () => {
    const noEsas = rec({ courtClass: 'yargitay', chamberCode: 'H9', kararNo: '2025/5678' });
    expect(formatKunye(noEsas, 'short').text).toBe('Y. 9. HD 2025/5678 K.');
    const none = rec({ courtClass: 'yargitay', chamberCode: 'H9' });
    expect(formatKunye(none, 'full').complete).toBe(false);
    expect(formatKunye(none, 'full').missing).toEqual(['esas', 'karar', 'date']);
  });

  it('indeks stili esas ve kararı birlikte yazar', () => {
    expect(formatKunye(TABLE[0]?.rec as KunyeRecord, 'index').text).toBe(
      'Y. 9. HD 2024/1234 E. 2025/5678 K.',
    );
  });
});

describe('KK-081-2: formatDateTr', () => {
  it('ISO → GG.AA.YYYY; geçersiz ISO hata', () => {
    expect(formatDateTr('2025-03-12')).toBe('12.03.2025');
    expect(() => formatDateTr('2025-02-30')).toThrow();
    expect(() => formatDateTr('12.03.2025')).toThrow();
  });

  it('kanonik numara baştaki sıfırı atar, genel kurul grubunu korur', () => {
    expect(parseCaseNo('2024/0123')?.canon).toBe('2024/123');
    expect(parseCaseNo('2018/(13)-1076')?.canon).toBe('2018/13-1076');
    expect(parseCaseNo('99/123')).toBeNull();
  });
});

describe('KK-081-3: gidiş-dönüş (biçimleyici çıktısı aynı bileşenlere ayrışır)', () => {
  const classes = new Map([
    ['istinaf_hukuk', 'istinaf_hukuk'],
    ['yerel', 'yerel'],
  ]);
  for (const row of TABLE) {
    it(`tam: ${row.full}`, () => {
      const { citations } = extractAll(`Bkz. ${row.full}.`, { today: TODAY });
      const decisions = citations.filter((c) => c.kind === 'decision_free');
      expect(decisions).toHaveLength(1);
      const k = decisions[0]?.kunye;
      expect(k?.courtClass).toBe(classes.get(row.rec.courtClass) ?? row.rec.courtClass);
      if (row.rec.courtClass === 'aym_bireysel') {
        expect(k?.basvuruNo?.canon).toBe(row.rec.esasNo);
      } else {
        expect(k?.esas?.canon).toBe(row.rec.esasNo);
        expect(k?.karar?.canon).toBe(row.rec.kararNo);
      }
      expect(k?.date).toBe(row.rec.decisionDate);
      if (row.rec.chamberCode) expect(k?.chamberCode).toBe(row.rec.chamberCode);
    });
    // Yerel ve BAM kısa stili yalnız esas taşır: 025 §5.3 dosya numarası sayar (file_only_lower).
    if (row.rec.courtClass === 'yerel' || row.rec.courtClass === 'istinaf_hukuk') continue;
    it(`kısa: ${row.short}`, () => {
      const { citations } = extractAll(`Bkz. ${row.short}`, { today: TODAY });
      const k = citations.find((c) => c.kind === 'decision_free')?.kunye;
      expect(k?.courtClass).toBe(row.rec.courtClass);
      const no = row.rec.courtClass === 'aym_bireysel' ? k?.basvuruNo : k?.esas;
      expect(no?.canon).toBe(row.rec.esasNo);
      if (row.rec.chamberCode && row.rec.courtClass !== 'uyusmazlik') {
        expect(k?.chamberCode).toBe(row.rec.chamberCode);
      }
    });
  }

  it('madde atfı gidiş-dönüşü', () => {
    const refs = [
      { lawNo: '6098', articles: [{ key: '352', paragraph: null, sub: null }] },
      { lawNo: '6098', articles: [{ key: 'G5', paragraph: null, sub: null }] },
      { lawNo: '6100', articles: [{ key: '104', paragraph: 1, sub: null }] },
      { lawNo: '6098', articles: [{ key: '344', paragraph: 1, sub: 'a' }] },
      {
        lawNo: '6098',
        articles: [
          { key: '344', paragraph: null, sub: null },
          { key: '345', paragraph: null, sub: null },
        ],
      },
      { lawNo: '5510', articles: [{ key: '18', paragraph: null, sub: null }] },
    ];
    for (const ref of refs) {
      const text = formatArticleRef(ref);
      const art = extractAll(`Bkz. ${text}.`, { today: TODAY }).citations.find(
        (c) => c.kind === 'article',
      )?.article;
      expect(art?.lawNo, text).toBe(ref.lawNo);
      expect(art?.articles, text).toEqual(ref.articles);
    }
    expect(
      formatArticleRef({
        lawNo: '6098',
        articles: [{ key: '344', paragraph: null, sub: null }],
        open: true,
      }),
    ).toBe('TBK m. 344 vd.');
  });

  it('KK-081-3: "m. 18 (mükerrer)" gösterimi M18 anahtarına döner', () => {
    const mukerrer = formatArticleRef({
      lawNo: '6098',
      articles: [{ key: 'M18', paragraph: null, sub: null }],
    });
    expect(mukerrer).toBe('TBK m. 18 (mükerrer)');
    const articles = (t: string): ArticleRef[] =>
      extractAll(`Bkz. ${t}.`, { today: TODAY }).citations.find((c) => c.kind === 'article')
        ?.article?.articles ?? [];
    // Harf `sub` alanında taşınır (025 §8.1); kanonik anahtar 034 §9.3 biçimidir.
    const keys = (t: string): (string | null)[] =>
      articles(t).map((a) => normalizeArticleKey(a.sub ? `${a.key}/${a.sub}` : a.key));
    // Gidiş-dönüş: biçimleyici çıktısı aynı anahtara döner.
    expect(keys(mukerrer)).toEqual(['M18']);
    // Bozulmadı: önek biçimi, düz madde ve harfli madde.
    expect(keys('TBK mükerrer m. 18')).toEqual(['M18']);
    expect(keys('TBK m. 18')).toEqual(['18']);
    expect(articles('TBK m. 352/A')).toEqual([{ key: '352', paragraph: null, sub: 'a' }]);
    expect(keys('TBK m. 352/A')).toEqual(['352/A']);
    // Yanlış pozitif yok: parantez içi başka sözcük mükerrer sayılmaz.
    expect(keys('TBK m. 18 (mükerrer olmayan)')).toEqual(['18']);
    // #46: "vd." kuyruğu mükerrer gösterimini bölmez; eşleşme "vd." ile bitse de anahtar M18 kalır.
    const mukerrerOpen = formatArticleRef({
      lawNo: '6098',
      articles: [{ key: 'M18', paragraph: null, sub: null }],
      open: true,
    });
    expect(mukerrerOpen).toBe('TBK m. 18 (mükerrer) vd.');
    expect(keys(mukerrerOpen)).toEqual(['M18']);
    expect(keys('TBK m. 18 (mükerrer) vd')).toEqual(['M18']);
    // Yanlış pozitif yok: "vd." kuyruklu başka parantez mükerrer sayılmaz.
    expect(keys('TBK m. 18 (mükerrer olmayan) vd.')).toEqual(['18']);
  });
});

describe('025 §5.2-§5.7 ve §8.1: serbest metin çıkarımı', () => {
  it('çekimli başlık, tarih önde ve sıra tahmini', () => {
    const t = "Yargıtay 9. HD'nin 12.03.2025 tarih ve 2024/1234 E., 2025/5678 K. sayılı kararı";
    const k = extractAll(t, { today: TODAY }).citations[0]?.kunye;
    expect(k).toMatchObject({ chamberCode: 'H9', date: '2025-03-12' });
    expect(k?.esas?.canon).toBe('2024/1234');
    expect(k?.karar?.canon).toBe('2025/5678');

    const inferred = extractAll('Danıştay 5. Daire, 2019/1234 - 2020/567', { today: TODAY })
      .citations[0]?.kunye;
    expect(inferred).toMatchObject({ inferred: true, chamberCode: 'D5' });
  });

  it('önceki künyenin tarihi sonraki başlığa bağlanmaz; "tarihli" ipucu bağlanır', () => {
    const t =
      'Yargıtay 8. Hukuk Dairesi, E. 2017/1615, K. 2017/4518, T. 28.03.2017). Ayrıca Yargıtay 12. HD 2023/9521 E.';
    const [a, b] = extractAll(t, { today: TODAY }).citations;
    expect(a?.kunye?.date).toBe('2017-03-28');
    expect(b?.raw).toBe('Yargıtay 12. HD 2023/9521 E.');
    expect(b?.kunye?.date).toBeNull();
    const c = extractAll('12.03.2025 tarihli Yargıtay 9. HD 2024/1 E. kararı', { today: TODAY })
      .citations[0];
    expect(c?.kunye?.date).toBe('2025-03-12');
  });

  it('imkânsız künyeler hızlı reddedilir', () => {
    const r = extractAll('Yargıtay 31. Hukuk Dairesi, E. 2025/1, K. 2024/0, T. 01.01.2030', {
      today: TODAY,
    }).citations[0];
    expect(r?.impossible.sort()).toEqual(
      ['future_date', 'karar_before_esas', 'unknown_chamber', 'zero_seq'].sort(),
    );
  });

  it('kendi dosya numarası ve yalnız esaslı ilk derece künye sayılmaz', () => {
    const own = extractAll('Mahkemenizin 2024/55 E. sayılı dosyası, Yargıtay 9. HD 2024/56 E.', {
      today: TODAY,
    });
    expect(own.citations.filter((c) => c.kind === 'decision_free')).toHaveLength(1);
    const lower = extractAll('İstanbul 5. Asliye Ticaret Mahkemesi 2023/118 E.', { today: TODAY });
    expect(lower.citations).toHaveLength(0);
    expect(lower.excluded[0]?.reason).toBe('file_only_lower');
    const masked = extractAll('[DOSYA_ABCD] Yargıtay 9. HD 2024/56 E.', { today: TODAY });
    expect(masked.citations.filter((c) => c.kind === 'decision_free')).toHaveLength(1);
  });

  it('başlıksız AYM başvuru numarası ve kapsam dışı kurumlar', () => {
    const r = extractAll('B. No: 2019/12345, 10/6/2021 ve RG 12.03.2024/32487', { today: TODAY });
    expect(r.citations[0]?.kunye).toMatchObject({ courtClass: 'aym_bireysel', date: '2021-06-10' });
    expect(r.citations[1]?.kunye).toMatchObject({
      courtClass: 'resmi_gazete',
      authorityNo: '12.03.2024/32487',
    });
  });

  it('madde atfı biçimleri (A1-A7)', () => {
    const r = extractAll(
      "TBK m. 344, 345; HMK md.104/1; iik 68/1; 4857 sayılı Kanun'un 18. maddesi; AY m. 36; TBK'nın 49. maddesi; TTK geçici m. 5; TBK m. 344-346; TBK m. 344 vd.",
      { today: TODAY },
    ).citations.map((c) => [
      c.article?.lawNo,
      c.article?.articles.map((a) => a.key),
      c.article?.open,
    ]);
    expect(r).toEqual([
      ['6098', ['344', '345'], false],
      ['6100', ['104'], false],
      ['2004', ['68'], false],
      ['4857', ['18'], false],
      ['2709', ['36'], false],
      ['6098', ['49'], false],
      ['6102', ['G5'], false],
      ['6098', ['344', '345', '346'], false],
      ['6098', ['344'], true],
    ]);
  });

  it('sözlükte olmayan kısaltma madde atfı sayılmaz; raw özgün dilimdir', () => {
    expect(extractAll('XYZ m. 12', { today: TODAY }).citations).toHaveLength(0);
    const text = 'Bkz. YARGITAY 9. HUKUK DAİRESİ, E. 2024/1234, K. 2025/5678';
    const c = extractAll(text, { today: TODAY }).citations[0];
    expect(c?.raw).toBe('YARGITAY 9. HUKUK DAİRESİ, E. 2024/1234, K. 2025/5678');
  });
});
