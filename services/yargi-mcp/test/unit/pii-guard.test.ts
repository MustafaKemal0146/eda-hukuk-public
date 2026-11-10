// @tk TK-28
// 021 §5.13 PII savunma derinliği: kişisel veri deseni içeren sorgu canlı kaynağa gitmez (sentetik değerler).
import { describe, expect, it } from 'vitest';
import { containsPii, isIban, isTckn, isVkn } from '../../src/pii-guard.ts';
import { searchDecisions } from '../../src/tools/search-decisions.ts';
import { CTX, makeDeps, NULLS, replay } from '../helpers.ts';

describe('PII kapısı (yargi-mcp savunma derinliği)', () => {
  it('algoritmalı kimlikler: TCKN, VKN, IBAN', () => {
    expect(isTckn('10000000146')).toBe(true);
    expect(isTckn('10000000147')).toBe(false);
    expect(isVkn('123456789')).toBe(false);
    expect(isIban('TR33 0006 1005 1978 6457 8413 26')).toBe(true);
  });

  it.each([
    ['kira 10000000146 tahliye', true],
    ['iletişim ornek@example.com', true],
    ['0532 123 45 67 numaralı hat', true],
    ['[KISI_7QXM] tahliye taahhüdü', true],
    ['IBAN TR330006100519786457841326', true],
    ['6098 sayılı TBK 352. madde tahliye', false],
    ['2024/1234 E. 2024/5678 K.', false],
  ])('%s → %s', (q, expected) => {
    expect(containsPii(q)).toBe(expected);
  });

  it('PII içeren sorgu SOURCE_PII_BLOCKED; portala istek yok', async () => {
    const t = replay();
    const deps = makeDeps({ transport: t.transport });
    await expect(
      searchDecisions(
        deps,
        {
          source: 'bedesten',
          query: '[KISI_7QXM] kira',
          court_types: null,
          ...NULLS,
          page: 1,
          page_size: 10,
        },
        CTX,
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_PII_BLOCKED' });
    expect(t.calls).toHaveLength(0);
  });
});
