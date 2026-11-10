// @tk TK-28
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../src/audit-events.ts';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'canon-audit-events.json'), 'utf8'),
) as string[];

describe('KK-P03b-24 KK-002-10: AUDIT_ACTIONS 002 §22 ile birebir', () => {
  it('KK-002-10: dizi 002 §22 tablosundan üretilen fixture ile aynı sırada eşit', () => {
    expect([...AUDIT_ACTIONS]).toEqual(fixture);
  });

  it('KK-002-10: olay kodları tekil ve alan.eylem biçiminde', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    for (const a of AUDIT_ACTIONS) expect(a).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });
});
