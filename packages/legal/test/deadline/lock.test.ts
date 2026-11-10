// @tk TK-14
// Süre Kilidi (083 §11.4, 022 §3.11; KK-083-19, KK-022-18, 027 H-DLOCK mutasyon alt kümesi).
// Yanıt metinleri sentetiktir ("Örnek"); hesaplar motorun çıktısıdır (Süre Kilidi hesap yapmaz).
import { describe, expect, it } from 'vitest';
import {
  calculateDeadline,
  checkDeadlineText,
  compareWithCalculations,
  extractDeadlineExpressions,
  formatTr,
  fromIso,
  type LockCalculation,
} from '../../src/deadline-engine/index.ts';
import { catalogRule, ctxFor, holidayData } from './helpers.ts';

const DATA = holidayData();

function calcOf(code: string, eventDate: string, id: string): LockCalculation {
  const rule = catalogRule(code, { verified: true });
  const r = calculateDeadline(
    { startEvent: rule.startEvents[0] ?? 'service', eventDate, serviceMethod: null },
    ctxFor(rule, { holidays: DATA }),
  );
  if (!r.ok) throw new Error(r.code);
  return {
    calculationId: id,
    durationValue: rule.durationValue,
    durationUnit: rule.durationUnit,
    dueDate: r.value.dueDate,
    contestedDueDate: r.value.contestedDueDate,
    safeDueAt: r.value.safeDueAt,
  };
}

const TWO_WEEKS = calcOf('hmk_istinaf_basvuru', '2026-03-05', 'call-2w');
const ONE_WEEK = calcOf('hmk_ihtiyati_tedbir_itiraz', '2026-03-05', 'call-1w');
const ONE_MONTH = calcOf('is_ise_iade_arabulucu_basvuru', '2026-03-31', 'call-1m');

describe('KK-P22-18 (KK-083-19, KK-022-18) Süre Kilidi match/mismatch/no_calculation', () => {
  const text = 'Örnek karara karşı iki hafta içinde istinaf yoluna başvurabilirsiniz.';

  it('"iki hafta içinde istinaf" + 2 haftalık hesap = match (calculationId ile)', () => {
    expect(checkDeadlineText(text, [TWO_WEEKS])).toEqual([
      { checkId: 'dc-1', text: 'iki hafta', status: 'match', calculationId: 'call-2w' },
    ]);
  });

  it('1 haftalık hesap = mismatch', () => {
    expect(checkDeadlineText(text, [ONE_WEEK]).map((c) => c.status)).toEqual(['mismatch']);
  });

  it('hesap yok = no_calculation', () => {
    expect(checkDeadlineText(text, []).map((c) => c.status)).toEqual(['no_calculation']);
  });

  it('"14 gün" ile 2 haftalık hesap eşleşir; "1 ay" ile "30 gün" eşleşmez', () => {
    expect(checkDeadlineText('İstinaf süresi 14 gündür.', [TWO_WEEKS])[0]?.status).toBe('match');
    const thirtyDays: LockCalculation = { ...ONE_MONTH, durationValue: 30, durationUnit: 'day' };
    expect(checkDeadlineText('Başvuru süresi 1 aydır.', [thirtyDays])[0]?.status).toBe('mismatch');
    expect(checkDeadlineText('Başvuru süresi 30 gündür.', [ONE_MONTH])[0]?.status).toBe('mismatch');
    expect(checkDeadlineText('Başvuru süresi 1 aylık bir süredir.', [ONE_MONTH])[0]?.status).toBe(
      'match',
    );
  });

  it('tarih ifadesi son gün, tartışmalı tarih veya güvenli an tarihiyle eşleşir (GG.AA.YYYY ve G Ay YYYY)', () => {
    // 05.03.2026 tebliğ: güvenli 19.03.2026 13:00, tartışmalı 23.03.2026 (G03).
    expect(checkDeadlineText('Son gün 19.03.2026 tarihidir.', [TWO_WEEKS])[0]?.status).toBe(
      'match',
    );
    expect(checkDeadlineText('En geç 23 Mart 2026 günü başvurun.', [TWO_WEEKS])[0]?.status).toBe(
      'match',
    );
    expect(checkDeadlineText('Son gün 20.03.2026 tarihidir.', [TWO_WEEKS])[0]?.status).toBe(
      'mismatch',
    );
  });

  it('bağlam sözcüğü yoksa aday değildir; ofsetler özgün metne göredir', () => {
    expect(extractDeadlineExpressions('Toplantı iki hafta sonra yapılacak.')).toEqual([]);
    const t = 'Not: İSTİNAF süresi   İki Hafta olup...';
    const [e] = extractDeadlineExpressions(t);
    expect(e?.text).toBe('İki Hafta');
    expect(t.slice(e?.start ?? 0, e?.end ?? 0)).toBe('İki Hafta');
  });

  it('dışlama listesi: hapis, yaş, faiz, kıdem, ihbar, ücret, kira bedeli, taksit, gün karşılığı, adli para', () => {
    const samples = [
      'İtiraz edilen kararda 15 gün hapis cezası verilmiştir.',
      'Çocuk 15 yaşında olduğundan itiraz süresi 2 hafta sayılmaz.',
      'Cevap dilekçesinde 30 gün faiz talep edilmiştir.',
      'İtiraz konusu 30 gün kıdem tazminatı hesabıdır.',
      'İtiraz konusu 2 hafta ihbar öneli hakkındadır.',
      'İtiraz konusu 1 aylık ücret alacağıdır.',
      'İtiraz konusu 3 ay kira bedeli farkıdır.',
      'İtiraz konusu 2 ay taksit tutarıdır.',
      'Cevapta 20 gün karşılığı adli para cezası istenmiştir.',
    ];
    for (const s of samples) expect(extractDeadlineExpressions(s), s).toEqual([]);
    // Dışlama ş/s ayrımı yapar: "yasal" dışlama değildir.
    expect(extractDeadlineExpressions('Yasal itiraz süresi 7 gündür.')).toHaveLength(1);
  });

  it('sayı sözcükleri: bir…on, on beş, yirmi, otuz, kırk beş, altmış, doksan', () => {
    const words: [string, number][] = [
      ['bir', 1],
      ['iki', 2],
      ['üç', 3],
      ['dört', 4],
      ['beş', 5],
      ['altı', 6],
      ['yedi', 7],
      ['sekiz', 8],
      ['dokuz', 9],
      ['on', 10],
      ['on beş', 15],
      ['yirmi', 20],
      ['otuz', 30],
      ['kırk beş', 45],
      ['altmış', 60],
      ['doksan', 90],
    ];
    for (const [w, n] of words) {
      const [e] = extractDeadlineExpressions(`İtiraz süresi ${w} gündür.`);
      expect(e?.kind === 'duration' && e.value, w).toBe(n);
    }
  });
});

describe('KK-P22-18 (027 H-DLOCK) mutasyon alt kümesi: lock_miss_count = 0', () => {
  // Kayıtlı yanıt yerine sentetik örnek yanıtlar (P32 eval kümesi gelene dek).
  const responses: { text: string; calcs: LockCalculation[] }[] = [
    {
      text: 'Örnek kararın tebliğinden itibaren 2 hafta içinde istinaf başvurusu yapılmalıdır. Son gün 19.03.2026 olup tartışmalı uzama 23.03.2026 tarihidir.',
      calcs: [TWO_WEEKS],
    },
    {
      text: 'İhtiyati tedbir kararına itiraz süresi 7 gündür; en geç 12 Mart 2026 tarihinde itiraz edin.',
      calcs: [ONE_WEEK],
    },
    {
      text: 'Arabulucuya başvuru süresi 1 aydır. Son gün 30.04.2026 tarihidir.',
      calcs: [ONE_MONTH],
    },
  ];

  type Mut = { from: string; to: string };
  function mutations(text: string): Mut[] {
    const out: Mut[] = [];
    for (const e of extractDeadlineExpressions(text)) {
      if (e.kind === 'date') {
        const shifted = formatTr(fromIso(e.date) + 1);
        out.push({
          from: e.text,
          to: e.text.includes('.')
            ? shifted
            : `${Number(shifted.slice(0, 2))} ${e.text.split(' ').slice(1).join(' ')}`,
        });
      } else {
        const num = /^\d+/.exec(e.text)?.[0];
        if (num !== undefined)
          out.push({ from: e.text, to: e.text.replace(num, String(Number(num) + 1)) });
        const unitSwap: Record<string, string> = {
          gün: 'hafta',
          hafta: 'gün',
          ay: 'gün',
          yıl: 'ay',
        };
        for (const [u, v] of Object.entries(unitSwap)) {
          if (new RegExp(`\\s${u}`, 'u').test(e.text))
            out.push({ from: e.text, to: e.text.replace(u, v) });
        }
      }
    }
    return out;
  }

  it('her mutasyon mismatch üretir', () => {
    let total = 0;
    let lockMiss = 0;
    for (const r of responses) {
      // Özgün yanıt tam eşleşir.
      expect(
        checkDeadlineText(r.text, r.calcs).every((c) => c.status === 'match'),
        r.text,
      ).toBe(true);
      for (const m of mutations(r.text)) {
        total++;
        const mutated = r.text.replace(m.from, m.to);
        const checks = checkDeadlineText(mutated, r.calcs);
        if (!checks.some((c) => c.text === m.to && c.status === 'mismatch')) lockMiss++;
      }
    }
    expect(total).toBeGreaterThanOrEqual(10);
    expect(lockMiss).toBe(0);
  });

  it('compareWithCalculations hesap yapmaz: yalnız verilen hesapları karşılaştırır', () => {
    const exprs = extractDeadlineExpressions('İstinaf süresi 2 haftadır.');
    expect(compareWithCalculations(exprs, [])[0]?.status).toBe('no_calculation');
  });
});
