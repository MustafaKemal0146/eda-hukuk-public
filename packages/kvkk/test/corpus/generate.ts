// Sentetik maskeleme ölçüm kümesi üreticisi (026 §13.1-§13.3, 027 §3.3, §4.4). Tohumlu, deterministik;
// gerçek kişi/numara yok (TCKN öneki 1000000, IBAN banka kodu 99999, e-posta example.* / *.test, soyad
// hece birleşimi). Tam küme depoya girmez; yalnız duman alt kümesi (smoke.jsonl) commit'lenir.
import { HEALTH_LEXICON } from '../../src/data/health-lexicon.tr.ts';
import { trLower, trUpper } from '../../src/fold.ts';
import { SyntheticGen } from '../../src/testing.ts';
import type { DictionaryInput, OriginKind, Tip } from '../../src/types.ts';

export interface GoldSpan {
  start: number;
  end: number;
  tip: Tip | null;
  /** Sözlük kaydıysa kimlik (yakalama kimlik eşitliği ister); serbest algıda null. */
  identity: string | null;
  mustMask: boolean;
  suffix?: { start: number; end: number };
}

export interface MaskingRecord {
  v: 1;
  id: string;
  set: 'masking';
  group: string;
  split: 'gate';
  status: 'draft';
  provenance: { kind: 'synthetic_generated'; tool: string; seed: number };
  input: {
    origin: OriginKind;
    text: string;
    dictionary: DictionaryInput;
    options: { maskOwnCaseNumber: boolean; tokenHashChars: 4 };
  };
  expected: {
    spans: GoldSpan[];
    roundTrip?: { modelOutputTemplate: string; expectedUnmasked: string };
  };
}

export const CORPUS_TOOL = 'kvkk/corpus@1';
const EMPTY: DictionaryInput = { clients: [], parties: [], cases: [] };

/** Parçalardan metin ve gold aralıkları kurar (NFC ofsetleri). */
class Builder {
  text = '';
  spans: GoldSpan[] = [];

  lit(s: string): this {
    this.text += s;
    return this;
  }

  pii(value: string, tip: Tip | null, identity: string | null, mustMask = true, suffix = ''): this {
    const start = this.text.length;
    this.text += value;
    const span: GoldSpan = { start, end: this.text.length, tip, identity, mustMask };
    if (suffix) {
      span.suffix = { start: this.text.length, end: this.text.length + suffix.length };
      this.text += suffix;
    }
    this.spans.push(span);
    return this;
  }
}

export interface CorpusSizes {
  perTip: number;
  negativeHard: number;
  adversarial: number;
  corpusOrigin: number;
}

export const FULL_SIZES: CorpusSizes = {
  perTip: 200,
  negativeHard: 500,
  adversarial: 100,
  corpusOrigin: 100,
};

/** 026 §13.2 KISI dağılımı (başlangıç): plain 25, inflected 25, abbrev 15, surname_only 15,
 * lowercase 10, uppercase 5, nfd/spaced 5. */
export const KISI_FORMS: readonly [string, number][] = [
  ['plain', 0.25],
  ['inflected', 0.25],
  ['abbrev', 0.15],
  ['surname_only', 0.15],
  ['lowercase', 0.1],
  ['uppercase', 0.05],
  ['nfd_spaced', 0.05],
];

function counts(total: number, dist: readonly [string, number][]): [string, number][] {
  const out = dist.map(([k, p]) => [k, Math.floor(total * p)] as [string, number]);
  let rest = total - out.reduce((n, [, c]) => n + c, 0);
  for (let i = 0; rest > 0; i = (i + 1) % out.length, rest -= 1) {
    (out[i] as [string, number])[1] += 1;
  }
  return out;
}

function personDict(id: string, first: string, last: string): DictionaryInput {
  return {
    clients: [{ id, kind: 'person', firstName: first, lastName: last }],
    parties: [],
    cases: [],
  };
}

export function generateCorpus(seed: number, sizes: CorpusSizes = FULL_SIZES): MaskingRecord[] {
  const g = new SyntheticGen(seed);
  const out: MaskingRecord[] = [];
  let n = 0;
  const push = (
    group: string,
    b: Builder,
    dictionary: DictionaryInput = EMPTY,
    origin: OriginKind = 'user_text',
    roundTrip?: MaskingRecord['expected']['roundTrip'],
    nfd = false,
  ) => {
    n += 1;
    const expected: MaskingRecord['expected'] = { spans: b.spans };
    if (roundTrip) expected.roundTrip = roundTrip;
    out.push({
      v: 1,
      id: `mk-${group}-${String(n).padStart(5, '0')}`.replaceAll('.', '-'),
      set: 'masking',
      group,
      split: 'gate',
      status: 'draft',
      provenance: { kind: 'synthetic_generated', tool: CORPUS_TOOL, seed },
      input: {
        origin,
        text: nfd ? b.text.normalize('NFD') : b.text,
        dictionary,
        options: { maskOwnCaseNumber: true, tokenHashChars: 4 },
      },
      expected,
    });
  };

  // KISI (sözlük kayıtlı), ad biçimi grupları ayrı.
  for (const [form, count] of counts(sizes.perTip, KISI_FORMS)) {
    for (let i = 0; i < count; i += 1) {
      const id = `c-${n}`;
      const first = g.givenName();
      const last = g.surname();
      const full = `${first} ${last}`;
      const dict = personDict(id, first, last);
      const b = new Builder();
      let rt: MaskingRecord['expected']['roundTrip'] | undefined;
      switch (form) {
        case 'plain':
          b.lit('Müvekkil ').pii(full, 'KISI', id).lit(' ile görüşme yapıldı.');
          rt = {
            modelOutputTemplate: `{{T:${id}}} için dilekçe hazır.`,
            expectedUnmasked: `${full} için dilekçe hazır.`,
          };
          break;
        case 'inflected':
          if (g.next() < 0.5)
            b.pii(full, 'KISI', id, true, `'${g.pick(['ın', 'in', 'a', 'e', 'dan', 'den'])}`).lit(
              ' dosyası incelendi.',
            );
          else
            b.lit('Dosya ')
              .pii(last, 'KISI', id, true, `'${g.pick(['a', 'e', 'ya', 'ye'])}`)
              .lit(' teslim edildi.');
          break;
        case 'abbrev':
          if (g.next() < 0.5) b.pii(`${[...first][0]}. ${last}`, 'KISI', id).lit(' imzaladı.');
          else b.lit('Av. ').pii(last, 'KISI', id).lit(' duruşmaya katıldı.');
          break;
        case 'surname_only':
          b.pii(last, 'KISI', id).lit(' dilekçeyi verdi.');
          break;
        case 'lowercase':
          if (g.next() < 0.5) b.pii(trLower(full), 'KISI', id).lit(' geldi.');
          else b.lit('dosyayı ').pii(trLower(last), 'KISI', id).lit(' getirdi.');
          break;
        case 'uppercase':
          b.lit('DAVACI : ').pii(trUpper(full), 'KISI', id);
          break;
        default:
          if (g.next() < 0.5) {
            push(
              'KISI.nfd_spaced',
              b.pii(full, 'KISI', id).lit(' başvurdu.'),
              dict,
              'user_text',
              undefined,
              true,
            );
            continue;
          }
          b.pii(`${first}   ${last}`, 'KISI', id).lit(' başvurdu.');
      }
      push(`KISI.${form}`, b, dict, 'user_text', rt);
    }
  }

  // KISI serbest (sözlük dışı; sezgi katmanı 3).
  for (let i = 0; i < sizes.perTip; i += 1) {
    const first = g.next() < 0.5 ? g.givenName() : g.rareGivenName();
    const name = `${first} ${g.surname()}`;
    const hint = g.pick(['Sayın ', 'davacı ', 'tanık ', 'Av. ', '']);
    push('KISI.free', new Builder().lit(hint).pii(name, 'KISI', null).lit(' toplantıya katıldı.'));
  }

  // SIRKET (sözlük ve serbest).
  for (let i = 0; i < sizes.perTip; i += 1) {
    const { name, core } = g.company();
    const id = `e-${n}`;
    const dict: DictionaryInput = {
      clients: [{ id, kind: 'entity', entityName: name }],
      parties: [],
      cases: [],
    };
    const r = g.next();
    if (r < 0.4) {
      push(
        'SIRKET.plain',
        new Builder().lit('Karşı taraf ').pii(name, 'SIRKET', id).lit(' oldu.'),
        dict,
        'user_text',
        {
          modelOutputTemplate: `{{T:${id}}} ile görüşüldü.`,
          expectedUnmasked: `${name} ile görüşüldü.`,
        },
      );
    } else if (r < 0.7) {
      push(
        'SIRKET.inflected',
        new Builder()
          .pii(name, 'SIRKET', id, true, `'${g.pick(['ye', 'nin', 'den'])}`)
          .lit(' ihtar gönderildi.'),
        dict,
      );
    } else if (r < 0.85) {
      push('SIRKET.core', new Builder().pii(core, 'SIRKET', id).lit(' yetkilisi aradı.'), dict);
    } else {
      push(
        'SIRKET.free',
        new Builder().lit('Tedarikçi ').pii(name, 'SIRKET', null).lit(' sözleşmeyi feshetti.'),
      );
    }
  }

  // ADRES (sözlük tam eşleşme ve serbest anahtar sözcük).
  for (let i = 0; i < sizes.perTip; i += 1) {
    const addr = g.address();
    if (g.next() < 0.5) {
      const id = `a-${n}`;
      const dict: DictionaryInput = {
        clients: [
          { id, kind: 'person', firstName: g.givenName(), lastName: g.surname(), address: addr },
        ],
        parties: [],
        cases: [],
      };
      push(
        'ADRES.dict',
        new Builder().lit('Tebligat adresi: ').pii(addr, 'ADRES', `${id}:adres`),
        dict,
      );
    } else {
      push(
        'ADRES.free',
        new Builder().lit('Adres: ').pii(addr, 'ADRES', null).lit('\nBilgilerinize.'),
      );
    }
  }

  // Yapısal tipler.
  for (let i = 0; i < sizes.perTip; i += 1) {
    const tckn = g.tckn();
    const r = g.next();
    if (r < 0.3) {
      const id = `t-${n}`;
      const dict: DictionaryInput = {
        clients: [{ id, kind: 'person', firstName: g.givenName(), lastName: g.surname(), tckn }],
        parties: [],
        cases: [],
      };
      push(
        'TCKN.dict',
        new Builder().lit('T.C. Kimlik No: ').pii(tckn, 'TCKN', `${id}:tckn`).lit('.'),
        dict,
        'user_text',
        {
          modelOutputTemplate: `{{T:${id}:tckn}}'in kaydı`,
          expectedUnmasked: `${tckn}'${lastDigitGen(tckn)} kaydı`,
        },
      );
    } else if (r < 0.65) {
      push('TCKN.punct', new Builder().lit('Kimlik(').pii(tckn, 'TCKN', null).lit('),'));
    } else {
      push(
        'TCKN.newline',
        new Builder().lit('TC Kimlik:\n').pii(tckn, 'TCKN', null).lit('\nkayıtlı'),
      );
    }
  }
  for (let i = 0; i < sizes.perTip; i += 1) {
    const vkn = g.vkn();
    const ctx = g.pick(['Vergi No: ', 'VKN ', 'vergi kimlik numarası ', 'Vergi Dairesi Kadıköy, ']);
    push('VKN.context', new Builder().lit(ctx).pii(vkn, 'VKN', null).lit(' olarak kayıtlı.'));
  }
  for (let i = 0; i < sizes.perTip; i += 1) {
    const ph = g.phone(i % 7);
    push(
      `TEL.format${i % 7}`,
      new Builder().lit('Telefon: ').pii(ph.text, 'TEL', null).lit(' numarasından ulaşılabilir.'),
    );
  }
  for (let i = 0; i < sizes.perTip; i += 1) {
    push(
      'EPOSTA.plain',
      new Builder()
        .lit('E-posta adresi ')
        .pii(g.email(), 'EPOSTA', null)
        .lit(' olarak bildirildi.'),
    );
  }
  for (let i = 0; i < sizes.perTip; i += 1) {
    const style = (['plain', 'spaced', 'dashed'] as const)[i % 3] ?? 'plain';
    push(
      `IBAN.${style}`,
      new Builder()
        .lit('IBAN: ')
        .pii(g.ibanFormatted(style), 'IBAN', null)
        .lit(' hesabına ödendi.'),
    );
  }
  for (let i = 0; i < sizes.perTip; i += 1) {
    push(
      'PLAKA.plain',
      new Builder().pii(g.plate(), 'PLAKA', null).lit(' plakalı araç kazaya karıştı.'),
    );
  }
  for (let i = 0; i < sizes.perTip; i += 1) {
    const esas = g.esasNo();
    const caseId = `k-${n}`;
    const dict: DictionaryInput = {
      clients: [],
      parties: [],
      cases: [{ id: caseId, esasNo: esas }],
    };
    push(
      'DOSYA.own',
      new Builder()
        .lit('Müvekkilin ')
        .pii(`${esas} E.`, 'DOSYA', `${caseId}:esas`)
        .lit(' sayılı dosyası.'),
      dict,
    );
  }
  for (let i = 0; i < sizes.perTip; i += 1) {
    const d = g.birthDate(g.next() < 0.5);
    if (g.next() < 0.5)
      push(
        'TARIH_DOGUM.context',
        new Builder().lit('Doğum tarihi: ').pii(d, 'TARIH_DOGUM', null).lit(', Ankara.'),
      );
    else
      push(
        'TARIH_DOGUM.dogumlu',
        new Builder().pii(d, 'TARIH_DOGUM', null).lit(' doğumlu tanık dinlendi.'),
      );
  }
  for (let i = 0; i < sizes.perTip; i += 1) {
    const term = g.pick(HEALTH_LEXICON);
    push(
      'SAGLIK.plain',
      new Builder().lit('Davacının ').pii(term, 'SAGLIK', null).lit(' tanısı rapora geçti.'),
    );
  }

  // Zor negatifler (026 §6.6).
  const NEG: (() => string)[] = [
    () => `Yargıtay ${g.int(1, 23)}. Hukuk Dairesi`,
    () => `Yargıtay ${g.int(1, 23)}. Ceza Dairesi`,
    () => `${g.pick(['Ankara', 'İstanbul', 'İzmir'])} BAM ${g.int(1, 30)}. HD`,
    () => `${g.pick(['6098', '6100', '5237', '4721', '2004'])} sayılı Kanun m. ${g.int(1, 600)}`,
    () => `${g.int(2010, 2025)}/${g.int(1, 9999)} E.`,
    () => `${g.int(2010, 2025)}/${g.int(1, 9999)} K.`,
    () =>
      `${String(g.int(1, 28)).padStart(2, '0')}.${String(g.int(1, 12)).padStart(2, '0')}.${g.int(2000, 2025)}`,
    () => `${g.int(1, 999)}.${g.digits(3)}.${g.digits(3)},00 TL`,
    () => g.pick(['Ocak', 'Şubat', 'Mart', 'Nisan', 'Pazartesi', 'Perşembe', 'Cuma']),
    () => g.pick(['DAVACI', 'DAVALI', 'KONU', 'AÇIKLAMALAR', 'SONUÇ VE İSTEM']),
    () => g.pick(['Kira', 'tazminat', 'temyiz', 'vekalet', 'istinaf', 'tahliye']),
    () =>
      g.pick([
        'Sosyal Güvenlik Kurumu',
        'Türkiye Büyük Millet Meclisi',
        'Danıştay İdari Dava Daireleri Kurulu',
      ]),
    () => g.pick(['10 TL 5000', '34 KG 1000', '25 KM 300']),
    () => `Asliye Hukuk Mahkemesi`,
  ];
  for (let i = 0; i < sizes.negativeHard; i += 1) {
    const phrase = (NEG[i % NEG.length] as () => string)();
    push(
      'negative_hard',
      new Builder().lit('Bkz. ').pii(phrase, null, null, false).lit(' hakkında not.'),
    );
  }

  // Saldırgan girdiler (026 §13.2).
  for (let i = 0; i < sizes.adversarial; i += 1) {
    const id = `x-${n}`;
    const first = g.givenName();
    const last = g.surname();
    const dict = personDict(id, first, last);
    switch (i % 6) {
      case 0:
        push(
          'adversarial.token_like',
          new Builder()
            .lit('Model ')
            .pii(`[KISI_${g.pick(['ABCD', 'WXYZ', 'QRST'])}]`, null, null, false)
            .lit(' yazdı.'),
        );
        break;
      case 1:
        push(
          'adversarial.zero_width',
          new Builder()
            .pii(`${first.slice(0, 2)}\u200B${first.slice(2)} ${last}`, 'KISI', id)
            .lit(' geldi.'),
          dict,
        );
        break;
      case 2:
        push(
          'adversarial.nfd',
          new Builder().pii(`${first} ${last}`, 'KISI', id).lit(' geldi.'),
          dict,
          'user_text',
          undefined,
          true,
        );
        break;
      case 3:
        push(
          'adversarial.spaces',
          new Builder().pii(`${first}\u00A0 \t${last}`, 'KISI', id).lit(' geldi.'),
          dict,
        );
        break;
      case 4:
        push(
          'adversarial.case_mix',
          new Builder().pii(`${first} ${trUpper(last)}`, 'KISI', id).lit(' geldi.'),
          dict,
        );
        break;
      default:
        push(
          'adversarial.code',
          new Builder()
            .lit('`')
            .pii(`${first} ${last}`, 'KISI', id)
            .lit('` ve https://ornek.example.com/x'),
          dict,
        );
    }
  }

  // Köken istisnası (026 §5, S4).
  for (let i = 0; i < sizes.corpusOrigin; i += 1) {
    const esas = g.esasNo();
    const caseId = `k-${n}`;
    const dict: DictionaryInput = {
      clients: [],
      parties: [],
      cases: [{ id: caseId, esasNo: esas }],
    };
    if (i % 2 === 0) {
      push(
        'corpus_origin.corpus',
        new Builder()
          .lit('Yargıtay kararı ')
          .pii(`${esas} E.`, 'DOSYA', null, false)
          .lit(' sayılı.'),
        dict,
        'corpus',
      );
    } else {
      push(
        'corpus_origin.own',
        new Builder()
          .lit('Müvekkilin dosyası ')
          .pii(`${esas} E.`, 'DOSYA', `${caseId}:esas`)
          .lit(' sayılı.'),
        dict,
        'user_text',
      );
    }
  }
  return out;
}

/** Rakamla biten değerin GEN eki (026 §7.5 rakam okunuşu); yalnız roundTrip beklentisi için. */
function lastDigitGen(value: string): string {
  const d = value.charAt(value.length - 1);
  return (
    {
      '0': 'ın',
      '1': 'in',
      '2': 'nin',
      '3': 'ün',
      '4': 'ün',
      '5': 'in',
      '6': 'nın',
      '7': 'nin',
      '8': 'in',
      '9': 'un',
    }[d] ?? 'in'
  );
}

/** Duman alt kümesi: grup başına ilk ~20 kayıt (commit'lenir). */
export function smokeSubset(records: readonly MaskingRecord[], perGroup = 20): MaskingRecord[] {
  const seen = new Map<string, number>();
  const out: MaskingRecord[] = [];
  for (const r of records) {
    const prefix = r.group.split('.')[0] ?? r.group;
    const c = seen.get(prefix) ?? 0;
    if (c >= perGroup) continue;
    seen.set(prefix, c + 1);
    out.push(r);
  }
  return out;
}
