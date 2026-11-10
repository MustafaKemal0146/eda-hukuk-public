// Ek uyumlayıcı altın kümesi (026 §13.5, 027 §4.4): tip başına oracle üretimli kayıtlar ve çekirdek
// (elle yazılmış, verified: false) kayıtlar. Test ve ölçüm betiği aynı üreticiyi kullanır.
import { readFileSync } from 'node:fs';
import { HEALTH_LEXICON } from '../../src/data/health-lexicon.tr.ts';
import { trUpper } from '../../src/fold.ts';
import { SyntheticGen } from '../../src/testing.ts';
import { TIPS, type Tip } from '../../src/types.ts';
import { DECOY_SOUNDS, ORACLE_CHAINS, oracleExpected, oracleRealize } from './suffix-oracle.ts';

export interface SuffixRecord {
  tip: Tip;
  display: string;
  written: string;
  expected: string;
  verified: boolean;
}

export const SUFFIX_SAMPLES_PER_TIP = 500;

export function displayFor(gen: SyntheticGen, tip: Tip): string {
  switch (tip) {
    case 'KISI': {
      const name = `${gen.givenName()} ${gen.surname()}`;
      const r = gen.next();
      if (r < 0.1) return trUpper(name);
      if (r < 0.2) return gen.givenName();
      return name;
    }
    case 'SIRKET':
      return gen.company().name;
    case 'TCKN':
      return gen.tckn();
    case 'VKN':
      return gen.vkn();
    case 'TEL':
      return gen.phone().text;
    case 'EPOSTA':
      return gen.email();
    case 'IBAN':
      return gen.ibanFormatted(gen.pick(['plain', 'spaced', 'dashed'] as const));
    case 'ADRES':
      return gen.address();
    case 'PLAKA':
      return gen.plate();
    case 'DOSYA':
      return gen.esasNo();
    case 'TARIH_DOGUM':
      return gen.birthDate(gen.next() < 0.5);
    case 'SAGLIK':
      return gen.pick(HEALTH_LEXICON);
  }
}

/** Tip başına oracle üretimli altın küme (027 §4.4 (b)); tohumlu, deterministik. */
export function oracleGolden(seed: number, perTip = SUFFIX_SAMPLES_PER_TIP): SuffixRecord[] {
  const gen = new SyntheticGen(seed);
  const out: SuffixRecord[] = [];
  for (const tip of TIPS) {
    for (let i = 0; i < perTip; i += 1) {
      const display = displayFor(gen, tip);
      const chain = gen.pick(ORACLE_CHAINS);
      const written = oracleRealize(chain, gen.pick(DECOY_SOUNDS));
      out.push({
        tip,
        display,
        written,
        expected: oracleExpected(display, tip, chain),
        verified: false,
      });
    }
  }
  return out;
}

export interface CoreGolden {
  verified: boolean;
  records: { display: string; tip: Tip; writtenSuffix: string; expected: string }[];
}

export function coreGolden(): CoreGolden {
  return JSON.parse(
    readFileSync(new URL('../golden/suffix-core.json', import.meta.url), 'utf8'),
  ) as CoreGolden;
}
