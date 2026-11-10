// @tk TK-28
// KK-021 araç kilidi (021 §4.15): 9 araç sabit sırada; strict alt küme; kilit dosyası üretimle aynı.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLock } from '../scripts/tools-canon.ts';
import { LLM_TOOL_NAMES, LLM_TOOLS } from '../src/tools/index.ts';
import { LLM_TOOL_DEFS } from '../src/tools/llm-tools.generated.ts';

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

describe('Araç kilidi (021 §4.1, §4.15)', () => {
  it('9 araç 002 §13.1 sırasıyla', () => {
    expect(LLM_TOOL_NAMES).toEqual([
      'search_decisions',
      'get_decision',
      'search_legislation',
      'get_legislation_article',
      'search_case_files',
      'calculate_deadline',
      'create_document',
      'edit_document',
      'submit_outline',
    ]);
  });

  it('strict alt küme ihlali yok; üretilmiş dosya ve kilit güncel', () => {
    const { generated, lock, errors } = buildLock(LLM_TOOLS);
    expect(errors).toEqual([]);
    expect(LLM_TOOL_DEFS).toEqual(generated);
    expect(read('../tools.lock.json')).toEqual(lock);
  });

  it('her nesne alanı zorunlu, ek alan kapalı; null yalnız anyOf ile', () => {
    const json = JSON.stringify(LLM_TOOL_DEFS);
    expect(json).not.toMatch(/"type":\[/);
    for (const k of [
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
      'default',
      '$ref',
      'oneOf',
    ]) {
      expect(json).not.toContain(`"${k}"`);
    }
  });
});
