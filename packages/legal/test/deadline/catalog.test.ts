// @tk TK-14
// Kural kataloğu (083 §7; KK-083-1, KK-083-20, KK-083-21). Katalog taslaktır; hiçbir kural
// doğrulanmış değildir (Y-80, Y-83).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_NOTE_PREFIX,
  catalogNotes,
  catalogRuleRecord,
  DEADLINE_RULE_CATALOG,
  DeadlineRuleRecord,
  PROFILES,
  parseDeadlineRule,
} from '../../src/deadline-engine/index.ts';
import { renderWarnings } from '../../src/deadline-engine/warnings.ts';

// 083 §7 tablosu: kod -> [süre, birim, başlangıç olayları, profil, süre türü, güven].
const TABLE_083: Readonly<
  Record<string, readonly [number, string, string, string, string, string]>
> = {
  hmk_cevap_dilekcesi: [2, 'week', 'service', 'P-HMK', 'procedural', 'B'],
  hmk_replik_dilekcesi: [2, 'week', 'service', 'P-HMK', 'procedural', 'B'],
  hmk_duplik_dilekcesi: [2, 'week', 'service', 'P-HMK', 'procedural', 'B'],
  hmk_istinaf_basvuru: [2, 'week', 'service,pronouncement', 'P-HMK', 'procedural', 'B'],
  hmk_istinaf_cevap: [2, 'week', 'service', 'P-HMK', 'procedural', 'C'],
  hmk_temyiz_basvuru: [2, 'week', 'service,pronouncement', 'P-HMK', 'procedural', 'B'],
  hmk_bilirkisi_raporuna_itiraz: [2, 'week', 'service', 'P-HMK', 'procedural', 'C'],
  hmk_ihtiyati_tedbir_itiraz: [1, 'week', 'service,pronouncement', 'P-HMK-NR', 'procedural', 'C'],
  hmk_ise_iade_dava: [2, 'week', 'learning', 'P-HMK-NR', 'forfeiture', 'B'],
  iik_odeme_emrine_itiraz: [7, 'day', 'service', 'P-IIK', 'procedural', 'C'],
  iik_imzaya_itiraz: [5, 'day', 'service', 'P-IIK', 'procedural', 'C'],
  iik_sikayet: [7, 'day', 'learning', 'P-IIK', 'procedural', 'C'],
  iik_ihtiyati_haciz_itiraz: [7, 'day', 'service,learning', 'P-IIK', 'procedural', 'C'],
  iik_itirazin_iptali_davasi: [12, 'month', 'service', 'P-IIK-GM', 'forfeiture', 'C'],
  iik_icra_mahkemesi_istinaf: [10, 'day', 'service,pronouncement', 'P-IIK', 'procedural', 'C'],
  iyuk_dava_acma_idare: [60, 'day', 'service', 'P-IYUK', 'forfeiture', 'B'],
  iyuk_dava_acma_vergi: [30, 'day', 'service', 'P-IYUK', 'forfeiture', 'C'],
  iyuk_yd_itiraz: [7, 'day', 'service', 'P-IYUK', 'procedural', 'C'],
  iyuk_istinaf: [30, 'day', 'service', 'P-IYUK', 'procedural', 'C'],
  iyuk_temyiz: [30, 'day', 'service', 'P-IYUK', 'procedural', 'C'],
  cmk_istinaf: [7, 'day', 'pronouncement,service', 'P-CMK', 'procedural', 'C'],
  cmk_temyiz: [15, 'day', 'pronouncement,service', 'P-CMK', 'procedural', 'C'],
  cmk_itiraz_sulh_ceza: [7, 'day', 'service,learning', 'P-CMK', 'procedural', 'C'],
  cmk_kyok_itiraz: [15, 'day', 'service', 'P-CMK', 'procedural', 'C'],
  med_dava_sarti_genel: [3, 'week', 'learning', 'P-MED-SURE', 'process', 'A'],
  med_dava_sarti_ticari: [6, 'week', 'learning', 'P-MED-SURE', 'process', 'A'],
  is_ise_iade_arabulucu_basvuru: [1, 'month', 'service', 'P-MED-BASVURU', 'forfeiture', 'C'],
};

describe('KK-P22-1 (KK-083-1) katalog satırları şemadan geçer', () => {
  it('27 satır, kodlar tekil, sıra 083 §7 ile aynı; her satır DeadlineRuleRecord ile ayrıştırılır', () => {
    expect(DEADLINE_RULE_CATALOG).toHaveLength(27);
    expect(DEADLINE_RULE_CATALOG.map((e) => e.no)).toEqual(
      Array.from({ length: 27 }, (_, i) => i + 1),
    );
    expect(DEADLINE_RULE_CATALOG.map((e) => e.code)).toEqual(Object.keys(TABLE_083));
    for (const e of DEADLINE_RULE_CATALOG) {
      const rec = catalogRuleRecord(e);
      expect(DeadlineRuleRecord.safeParse(rec).success, e.code).toBe(true);
      expect(parseDeadlineRule(rec)).toEqual(rec);
    }
  });

  it('süre, birim, başlangıç olayı, profil, süre türü ve güven 083 §7 ile birebir', () => {
    for (const e of DEADLINE_RULE_CATALOG) {
      const [v, u, ev, prof, nature, conf] = TABLE_083[e.code] ?? [];
      expect(
        [
          e.durationValue,
          e.durationUnit,
          e.startEvents.join(','),
          e.profile,
          e.periodNature,
          e.confidence,
        ],
        e.code,
      ).toEqual([v, u, ev, prof, nature, conf]);
      const rec = catalogRuleRecord(e);
      const profile = PROFILES[e.profile];
      expect(rec.params.holidayShift).toBe(profile.holidayShift);
      expect(rec.params.recessBranch).toBe(profile.recessBranch);
      expect(rec.recessApplies).toBe(profile.recessBranch !== null);
    }
  });

  it('032 §10.5 ile bilinen farklar 083 lehine (#9 learning, #14 recessBranch hmk, #27 kaydırma)', () => {
    const by = (c: string) => {
      const e = DEADLINE_RULE_CATALOG.find((x) => x.code === c);
      if (e === undefined) throw new Error(c);
      return catalogRuleRecord(e);
    };
    expect(by('hmk_ise_iade_dava').startEvents).toEqual(['learning']);
    expect(by('hmk_ise_iade_dava').params.startEventLabels).toEqual({
      learning: 'Son tutanak düzenleme tarihi',
    });
    expect(by('iik_itirazin_iptali_davasi').params.recessBranch).toBe('hmk');
    expect(by('is_ise_iade_arabulucu_basvuru').params.holidayShift).toBe('next_working_day');
    expect(by('med_dava_sarti_genel').params.optionalExtension).toEqual({ value: 1, unit: 'week' });
    expect(by('med_dava_sarti_ticari').params.optionalExtension).toEqual({
      value: 2,
      unit: 'week',
    });
  });

  it('hiçbir katalog kuralı doğrulanmış değildir (Y-83)', () => {
    for (const e of DEADLINE_RULE_CATALOG) {
      const rec = catalogRuleRecord(e);
      expect(rec.verifiedBy).toBeNull();
      expect(rec.verifiedAt).toBeNull();
    }
  });
});

describe('KK-P22-19 (KK-083-20) katalog doğrulamaları', () => {
  it('her satırda law_ref, güven düzeyi ve effective_during dolu; mülga HMK m.107 dayanaklı kural yok', () => {
    for (const e of DEADLINE_RULE_CATALOG) {
      const rec = catalogRuleRecord(e);
      expect(rec.lawRef.trim().length, e.code).toBeGreaterThan(0);
      const notes = catalogNotes(e);
      expect(notes.startsWith(CATALOG_NOTE_PREFIX)).toBe(true);
      expect(notes).toMatch(/güven [ABC]/);
      expect(rec.effectiveDuring).toEqual({ start: '2024-01-01', endExclusive: null });
      expect(rec.lawRef).not.toMatch(/HMK m\.107\b/);
      expect(notes).not.toMatch(/m\.107\b/);
    }
  });
});

describe('KK-P22-20 (KK-083-21) yasaklı ifade ve mutlak vaat taraması', () => {
  const BANNED = [
    /garanti/iu,
    /tam doğru/iu,
    /kesin korunur/iu,
    /hatasız/iu,
    /kusursuz/iu,
    /%\s?100/u,
  ];
  it('katalog adları, notları, takma adları ve uyarı metinleri temiz', () => {
    const texts: string[] = [];
    for (const e of DEADLINE_RULE_CATALOG) texts.push(e.title, catalogNotes(e), ...e.aliases);
    const all = new Set([
      'holiday_data_missing',
      'half_day',
      'administrative_leave',
      'contested_extension',
      'rule_unverified_preview',
      'saturday_shift',
    ] as const);
    for (const w of renderWarnings(all, [2029])) texts.push(w.message);
    for (const t of texts) for (const re of BANNED) expect(re.test(t), t).toBe(false);
  });
  it('hesap izi ve uyarı şablonlarının kaynağı temiz', () => {
    for (const f of ['steps.ts', 'warnings.ts', 'lock.ts']) {
      const text = readFileSync(
        join(import.meta.dirname, '..', '..', 'src', 'deadline-engine', f),
        'utf8',
      );
      for (const re of BANNED) expect(re.test(text), `${f} ${re}`).toBe(false);
    }
  });
});
