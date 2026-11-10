// @tk TK-17
// P14a.5 künye temel modülleri: KK-P14a-10 (KK-034-9, KK-025-6) numara kanonikleştirme, künye hash
// girdisi (034 §8.3), KK-P14a-11 (KK-081-1/2/5/9) biçimleyici, KK-P14a-12 (KK-081-6) kanun sözlüğü ve
// kayıt defteri, KK-P14a-13 (KK-034-10 alt kümesi) madde atfı anahtarları. Numaralar biçim örneğidir.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEARCH_COURT_TYPES } from '@eda/contracts/enums';
import { describe, expect, it } from 'vitest';
import {
  type ArticleCitationExtractor,
  CITED_ARTICLES_MAX,
  canonicalizeCaseNo,
  courtClassOf,
  extractArticleRefs,
  formatArticleRef,
  formatDateTr,
  formatKunye,
  formatSourceLine,
  isPlausibleDecisionDate,
  type KunyeRecord,
  kunyeHashInput,
  LAW_ALIASES,
  LAW_REGISTRY,
  lawByAbbr,
  lawTypeToDb,
  parseCaseNoText,
  parseDateTr,
  registryEntry,
} from '../src/kunye/index.ts';
import { tr_fold, tr_normalize } from '../src/text/index.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

function tsFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    if (n === 'node_modules' || n === 'dist' || n === '.next') return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? tsFiles(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('KK-P14a-10 / KK-034-9 / KK-025-6: canonicalizeCaseNo ve parseCaseNoText (034 §8.2)', () => {
  const esas = (raw: string) => parseCaseNoText(raw).esas?.canon ?? null;

  it('ayırıcı ve etiketler: 2024/1234, 2024 / 1234, 2024-1234, E. 2024/1234, 2024/1234 E.', () => {
    for (const raw of ['2024/1234', '2024 / 1234', '2024-1234', 'E. 2024/1234', '2024/1234 E.']) {
      expect(esas(raw), raw).toBe('2024/1234');
    }
    expect(esas('Esas No: 2024/77')).toBe('2024/77');
  });

  it('baştaki sıfır atılır; genel kurul grubu korunur', () => {
    expect(esas('2024/0123')).toBe('2024/123');
    expect(esas('2023/3-451')).toBe('2023/3-451');
    expect(parseCaseNoText('K. 2025/0005').karar?.canon).toBe('2025/5');
  });

  it('iki haneli yıl dönüştürülmez: esas_year_2digit uyarısı, numara yok', () => {
    expect(parseCaseNoText('99/123')).toEqual({
      esas: null,
      karar: null,
      basvuru: false,
      warnings: ['esas_year_2digit'],
    });
  });

  it('AYM bireysel B. No esas kolonuna; AYM norm E./K. ayrı alanlara', () => {
    const b = parseCaseNoText('B. No: 2019/19126');
    expect(b.esas?.canon).toBe('2019/19126');
    expect(b.karar).toBeNull();
    expect(b.basvuru).toBe(true);
    const n = parseCaseNoText('E.2020/45, K.2021/12');
    expect(n.esas?.canon).toBe('2020/45');
    expect(n.karar?.canon).toBe('2021/12');
  });

  it('etiketsiz numara istenen role yazılır; numarasız metin unparsed', () => {
    expect(parseCaseNoText('2025/5678', 'karar').karar?.canon).toBe('2025/5678');
    expect(parseCaseNoText('numara yok').warnings).toEqual(['unparsed']);
  });

  it('kanonik biçimi tek işlev üretir; ikinci numara kanonikleştirici yok (statik denetim)', () => {
    expect(canonicalizeCaseNo(2024, 123).canon).toBe('2024/123');
    expect(canonicalizeCaseNo(2023, 451, 3).canon).toBe('2023/3-451');
    const defs: string[] = [];
    for (const root of ['packages', 'apps', 'services']) {
      for (const f of tsFiles(join(REPO, root))) {
        if (f.includes('/test/')) continue;
        const code = readFileSync(f, 'utf8');
        if (/canonEsasKarar/.test(code)) defs.push(`${f}: canonEsasKarar`);
        if (/function canonicalizeCaseNo\b/.test(code)) defs.push(f);
      }
    }
    expect(defs.map((d) => d.slice(REPO.length))).toEqual([
      'packages/legal/src/kunye/canonical.ts',
    ]);
  });

  it('tarih: GG.AA.YYYY ↔ ISO, takvim geçerliliği, [1920-01-01, bugün+1] aralığı', () => {
    expect(parseDateTr('12.03.2025')).toBe('2025-03-12');
    expect(parseDateTr('1.3.2025')).toBe('2025-03-01');
    expect(parseDateTr('31.02.2025')).toBeNull();
    expect(formatDateTr(parseDateTr('29.02.2024') ?? '')).toBe('29.02.2024');
    const today = '2026-10-11';
    expect(isPlausibleDecisionDate('1919-12-31', today)).toBe(false);
    expect(isPlausibleDecisionDate('1920-01-01', today)).toBe(true);
    expect(isPlausibleDecisionDate('2026-10-12', today)).toBe(true);
    expect(isPlausibleDecisionDate('2026-10-13', today)).toBe(false);
    expect(isPlausibleDecisionDate('2025-02-30', today)).toBe(false);
    expect(isPlausibleDecisionDate('2027-01-01', '2026-12-31')).toBe(true);
  });
});

describe('P14a.5 b / KK-034-8 (girdi yarısı): künye hash girdisi (034 §8.3)', () => {
  const base = {
    courtType: 'yargitay' as const,
    chamberCode: 'H9',
    chamberRaw: '9. Hukuk Dairesi',
    courtName: 'Yargıtay',
    esasCanon: '2021/1234',
    kararCanon: '2022/5',
  };

  it('court_type|unit_key|esas|karar; daire hash e dahil (9. HD ≠ 10. HD)', () => {
    expect(kunyeHashInput(base)).toBe('yargitay|H9|2021/1234|2022/5');
    expect(kunyeHashInput({ ...base, chamberCode: 'H10' })).not.toBe(kunyeHashInput(base));
  });

  it('daire kodu yoksa tr_fold(chamber_raw ?? court_name); eksik alan boş dize', () => {
    const local = {
      ...base,
      courtType: 'ilk_derece_hukuk' as const,
      chamberCode: null,
      chamberRaw: null,
      courtName: 'İstanbul 5. Asliye Ticaret Mahkemesi',
      kararCanon: null,
    };
    expect(kunyeHashInput(local)).toBe(
      `ilk_derece_hukuk|${tr_fold('İstanbul 5. Asliye Ticaret Mahkemesi')}|2021/1234|`,
    );
  });

  it('esas ve karar ikisi de yoksa null', () => {
    expect(kunyeHashInput({ ...base, esasCanon: null, kararCanon: null })).toBeNull();
  });
});

type GoldenRow = { record: KunyeRecord; full: string; short: string; index: string };
const GOLDEN = (
  JSON.parse(readFileSync(new URL('./golden/kunye/format.json', import.meta.url), 'utf8')) as {
    rows: GoldenRow[];
  }
).rows;

describe('KK-P14a-11 / KK-081-1 / KK-081-2 / KK-081-5 / KK-081-9: biçimleyici', () => {
  it('altın dosya üç stili de birebir üretir', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(12);
    for (const row of GOLDEN) {
      expect(formatKunye(row.record, 'full').text).toBe(row.full);
      expect(formatKunye(row.record, 'short').text).toBe(row.short);
      expect(formatKunye(row.record, 'index').text).toBe(row.index);
    }
  });

  it('index stili 030 kunye_norm örneğiyle uyumlu; short ile farklı (yalnız esas / esas+karar)', () => {
    const first = GOLDEN[0] as GoldenRow;
    expect(tr_normalize(formatKunye(first.record, 'index').text)).toBe(
      'y. 9. hd 2024/1234 e. 2025/5678 k.',
    );
    for (const row of GOLDEN) {
      if (row.record.kararNo && row.record.courtClass !== 'aym_bireysel') {
        expect(row.index).not.toBe(row.short);
      }
    }
  });

  it('çekim eki yok (KK-081-5) ve kesinleşme ibaresi yok (KK-081-12)', () => {
    const outputs = [
      ...GOLDEN.flatMap((r) => [r.full, r.short, r.index]),
      formatArticleRef({ lawNo: '6098', articles: [{ key: '49', paragraph: 1, sub: null }] }),
      formatArticleRef({ lawNo: '5510', articles: [{ key: 'G5', paragraph: null, sub: null }] }),
      formatSourceLine({ kunye: GOLDEN[0]?.full ?? '', sourceLabel: 'Örnek', retrievedAt: null }),
    ];
    for (const o of outputs) {
      expect(o).not.toMatch(/'(nin|nın|nun|nün|in|ın)(?!\p{L})/u);
      expect(o).not.toMatch(/kesinleşmiş|kesinleşmiştir|onaylı/u);
    }
  });

  it('formatDateTr ve biçimleyici Intl / toLocale* kullanmaz (statik tarama)', () => {
    for (const f of ['format.ts', 'canonical.ts', 'hash.ts']) {
      const code = readFileSync(new URL(`../src/kunye/${f}`, import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
        .join('\n');
      expect(code, f).not.toMatch(/\bIntl\b|toLocale\w*\(/);
    }
  });

  it('formatSourceLine: erişim tarihi yoksa kısım tümüyle çıkar (081 §5.3, KK-081-7)', () => {
    const kunye = 'Yargıtay 9. Hukuk Dairesi, E. 2024/1234, K. 2025/5678, T. 12.03.2025';
    expect(
      formatSourceLine({ kunye, sourceLabel: 'Örnek Kaynak', retrievedAt: '2026-10-01' }),
    ).toBe(`${kunye} — Kaynak: Örnek Kaynak, erişim tarihi: 01.10.2026`);
    expect(formatSourceLine({ kunye, sourceLabel: 'Örnek Kaynak', retrievedAt: null })).toBe(
      `${kunye} — Kaynak: Örnek Kaynak`,
    );
  });

  it('court_type → courtClass eşlemesi tüm SEARCH_COURT_TYPES değerlerini kapsar (K3)', () => {
    for (const t of SEARCH_COURT_TYPES) expect(courtClassOf(t)).toBeTruthy();
    expect(courtClassOf('ilk_derece_hukuk')).toBe('yerel');
    expect(SEARCH_COURT_TYPES as readonly string[]).not.toContain('yerel_hukuk');
  });
});

describe('KK-P14a-12 / KK-081-6: kanun sözlüğü ve kayıt defteri', () => {
  it('aynı kısaltma iki farklı kanun numarasına eşlenmez', () => {
    const owner = new Map<string, string | null>();
    const conflicts: string[] = [];
    for (const a of LAW_ALIASES) {
      for (const name of [a.display, ...a.aliases]) {
        if (name === null) continue;
        const key = tr_normalize(name);
        if (owner.has(key) && owner.get(key) !== a.lawNo) conflicts.push(key);
        owner.set(key, a.lawNo);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it('BK → 818 (bankacılık kanununa eşlenmez); strict kümesi 081 §6.1', () => {
    expect(lawByAbbr('BK')?.lawNo).toBe('818');
    expect(lawByAbbr('Bankacılık K.')?.lawNo).toBe('5411');
    const strict = LAW_ALIASES.filter((a) => a.strict)
      .map((a) => tr_fold(a.display ?? ''))
      .sort();
    expect(strict).toEqual(['cmk', 'hmk', 'iik', 'iyuk', 'tbk', 'tck', 'tmk', 'ttk', 'vuk']);
  });

  it('081 §6.2 satırları unverified; §6.1 satırları değil', () => {
    expect(lawByAbbr('TBK')?.unverified).toBe(false);
    expect(LAW_ALIASES.find((a) => a.lawNo === '5510')?.unverified).toBe(true);
    expect(LAW_ALIASES.find((a) => a.lawNo === '6331')?.unverified).toBe(true);
  });

  it('kayıt defteri: 1447 yok, numaralar tekil, anayasa constitution, tümü snapshot', () => {
    const nos = LAW_REGISTRY.map((e) => e.lawNo);
    expect(new Set(nos).size).toBe(nos.length);
    expect(nos).not.toContain('1447');
    expect(registryEntry('2709')?.lawType).toBe('constitution');
    expect(registryEntry('6098')).toMatchObject({ lawType: 'law', abbr: 'TBK', snapshot: true });
    expect(registryEntry('4734')?.abbr).toBeNull();
    for (const e of LAW_REGISTRY) expect(e.snapshot).toBe(true);
  });

  it('lawTypeToDb: kanun→law/constitution, khk, cbk, yonetmelik; tuzuk/teblig/diger desteklenmez', () => {
    expect(lawTypeToDb('kanun', '6098')).toEqual({ ok: true, lawType: 'law' });
    expect(lawTypeToDb('kanun', '2709')).toEqual({ ok: true, lawType: 'constitution' });
    expect(lawTypeToDb('khk', '600')).toEqual({ ok: true, lawType: 'decree_law' });
    expect(lawTypeToDb('cbk', '1')).toEqual({ ok: true, lawType: 'presidential_decree' });
    expect(lawTypeToDb('yonetmelik', '1')).toEqual({ ok: true, lawType: 'regulation' });
    for (const t of ['tuzuk', 'teblig', 'diger'] as const) {
      expect(lawTypeToDb(t, '1')).toEqual({ ok: false, reason: 'unsupported_law_type' });
    }
  });
});

describe('KK-P14a-13 / KK-034-10 (alt küme): madde atfı anahtarları', () => {
  const text = [
    'Örnek metin: TBK m. 49 ve TBK m. 49/A uyarınca;',
    '6098 sayılı Kanun’un 50. maddesi; 4857 sayılı Kanun m. 18;',
    'TBK geçici m. 5; TTK ek m. 3; VUK mükerrer m. 18; İYUK m. 7/a; XYZ m. 12; AİHS m. 6;',
    'tekrar TBK m. 49.',
  ].join(' ');

  it('49, 49/A, G5, E3, M18 anahtarları; bent harfi anahtara girmez; bilinmeyen kısaltma atıf değil', () => {
    const extractor: ArticleCitationExtractor = extractArticleRefs;
    expect(extractor(text).map((r) => `${r.lawNo}|${r.articleNo}`)).toEqual([
      '6098|49',
      '6098|49/A',
      '6098|50',
      '4857|18',
      '6098|G5',
      '6102|E3',
      '213|M18',
      '2577|7',
    ]);
  });

  it('anayasa atfı constitution türünde', () => {
    expect(extractArticleRefs('Anayasa m. 36 uyarınca')).toEqual([
      { lawNo: '2709', lawType: 'constitution', articleNo: '36' },
    ]);
  });

  it(`çıktı tekilleştirilmiş ve en çok ${CITED_ARTICLES_MAX} öğe`, () => {
    const many = Array.from({ length: 250 }, (_, i) => `TBK m. ${i + 1};`).join(' ');
    const refs = extractArticleRefs(`${many} ${many}`);
    expect(refs).toHaveLength(CITED_ARTICLES_MAX);
    expect(new Set(refs.map((r) => r.articleNo)).size).toBe(CITED_ARTICLES_MAX);
  });
});
