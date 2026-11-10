// @tk TK-14
// Determinizm, saat dilimi bağımsızlığı ve statik tarama (083 KK-083-13, KK-083-14; P22 K14).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calculateDeadline,
  canonicalJson,
  fromIso,
  toIstanbulIso,
} from '../../src/deadline-engine/index.ts';
import { allGoldenCases, catalogRule, ctxFor, holidayData } from './helpers.ts';

const ENGINE_DIR = join(import.meta.dirname, '..', '..', 'src', 'deadline-engine');
const HOLIDAYS_DIR = join(import.meta.dirname, '..', '..', 'src', 'holidays');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(dir, f));
}

describe('KK-P22-13 (KK-083-13) determinizm', () => {
  it('aynı girdi 100 çağrıda aynı kanonik JSON ve aynı anahtar sırası', () => {
    const data = holidayData();
    for (const c of allGoldenCases()) {
      const run = () =>
        calculateDeadline(
          {
            startEvent: c.input.startEvent,
            eventDate: c.input.eventDate,
            serviceMethod: c.input.serviceMethod,
          },
          ctxFor(catalogRule(c.ruleCode, { verified: true }), {
            holidays: data,
            court: c.input.courtExempt ? { adminRecessExempt: true } : null,
          }),
        );
      const first = JSON.stringify(run());
      for (let i = 0; i < 100; i++) {
        if (JSON.stringify(run()) !== first) expect.fail(`${c.id} çağrı ${i}`);
      }
    }
  });

  it('ayrı kurulan aynı tatil verisi aynı parmak izini ve aynı çıktıyı verir', () => {
    const a = holidayData();
    const b = holidayData();
    expect(a).not.toBe(b);
    expect(a.fingerprint).toBe(b.fingerprint);
    const rule = catalogRule('hmk_istinaf_basvuru', { verified: true });
    const input = {
      startEvent: 'service' as const,
      eventDate: '2026-03-05',
      serviceMethod: 'postal' as const,
    };
    expect(canonicalJson(calculateDeadline(input, ctxFor(rule, { holidays: a })))).toBe(
      canonicalJson(calculateDeadline(input, ctxFor(rule, { holidays: b }))),
    );
  });

  it('statik tarama: motor ve tatil kaynağında JS tarih nesnesi, rastgelelik, toLowerCase, node:* yok', () => {
    const banned = [
      /\bDate\b/,
      /Math\.random/,
      /toLowerCase|toLocaleLowerCase|toLocaleUpperCase/,
      /from 'node:/,
      /\bprocess\./,
    ];
    for (const f of [...sourceFiles(ENGINE_DIR), ...sourceFiles(HOLIDAYS_DIR)]) {
      const text = readFileSync(f, 'utf8');
      for (const re of banned) expect(re.test(text), `${f}: ${re}`).toBe(false);
      // Intl yalnız format.ts içinde (saat dilimi ofseti; tarih aritmetiği değil).
      if (!f.endsWith('format.ts')) expect(/\bIntl\b/.test(text), `${f}: Intl`).toBe(false);
    }
  });
});

describe('KK-P22-13 (KK-083-14) saat dilimi matrisi ve +03:00 ofseti', () => {
  it('dueAt her zaman +03:00 ofsetlidir (2026-2028)', () => {
    for (let d = fromIso('2026-01-01'); d <= fromIso('2028-12-31'); d++) {
      const s = toIstanbulIso(d, '17:00');
      if (!s.endsWith('T17:00:00+03:00')) expect.fail(s);
    }
  });

  it('TZ=UTC, TZ=Europe/Istanbul ve TZ=America/New_York alt süreçlerinde çıktı bayt-bayt aynı', () => {
    const probe = join(import.meta.dirname, 'tz-probe.ts');
    const outputs = ['UTC', 'Europe/Istanbul', 'America/New_York'].map((tz) =>
      execFileSync(process.execPath, [probe], {
        env: { TZ: tz },
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
    expect(outputs[0]?.length).toBeGreaterThan(1000);
    expect(outputs[1]).toBe(outputs[0]);
    expect(outputs[2]).toBe(outputs[0]);
  });
});
