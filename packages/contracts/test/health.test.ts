// @tk TK-28
import { describe, expect, it } from 'vitest';
import { HealthResponse } from '../src/doc-engine/health.ts';

describe('KK-P00-9 doc-engine HealthResponse şeması', () => {
  it('KK-P00-9: geçerli yanıtı kabul eder', () => {
    expect(HealthResponse.parse({ status: 'ok', version: '0.0.0' })).toEqual({
      status: 'ok',
      version: '0.0.0',
    });
  });

  it.each([
    ['status ok değil', { status: 'down', version: '0.0.0' }],
    ['version eksik', { status: 'ok' }],
    ['version string değil', { status: 'ok', version: 1 }],
    ['fazla alan', { status: 'ok', version: '0.0.0', extra: true }],
  ])('KK-P00-9: geçersiz yanıtı reddeder (%s)', (_label, input) => {
    expect(HealthResponse.safeParse(input).success).toBe(false);
  });
});
