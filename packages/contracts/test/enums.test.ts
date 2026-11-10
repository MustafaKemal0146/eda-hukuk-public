// @tk TK-28
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as enums from '../src/enums.ts';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'canon-enums.json'), 'utf8'),
) as Record<string, string[]>;

describe('KK-P00-9 KK-002-5 enum kümeleri 002 §11 ile birebir', () => {
  it('KK-002-5: dışa aktarılan küme adları fixture ile aynı', () => {
    expect(Object.keys(enums).sort()).toEqual(Object.keys(fixture).sort());
  });

  it.each(Object.entries(fixture))('KK-002-5: %s dizisi fixture ile aynı', (name, values) => {
    expect((enums as Record<string, unknown>)[name]).toEqual(values);
  });
});
