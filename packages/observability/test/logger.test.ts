// @tk TK-05
import { describe, expect, it } from 'vitest';
import { createLogger, LOG_EVENTS, REDACT_PATHS } from '../src/logger/index.ts';

function capture(): { lines: Record<string, unknown>[]; write(msg: string): void } {
  const lines: Record<string, unknown>[] = [];
  return { lines, write: (msg) => lines.push(JSON.parse(msg) as Record<string, unknown>) };
}

describe('KK-002-8: günlükleyici redaksiyonu', () => {
  it('002 §23 listesindeki alanlar [REDACTED] olur', () => {
    const out = capture();
    const log = createLogger({ service: 'eda-test', destination: out });
    log.info({ event: 'http.request.completed', user: { email: 'a@b.c', tckn: '1', id: 'u1' } });
    const user = out.lines[0]?.user as Record<string, unknown>;
    expect(user.email).toBe('[REDACTED]');
    expect(user.tckn).toBe('[REDACTED]');
    expect(user.id).toBe('u1');
  });

  it('istek başlıklarında çerez ve yetki değeri yazılmaz', () => {
    const out = capture();
    const log = createLogger({ service: 'eda-test', destination: out });
    log.info({ req: { headers: { cookie: 'x=1', authorization: 'Bearer y' } } });
    const raw = JSON.stringify(out.lines[0]);
    expect(raw).not.toContain('x=1');
    expect(raw).not.toContain('Bearer y');
  });

  it('seviye etiketi ve servis alanı yazılır; zaman ISO 8601', () => {
    const out = capture();
    createLogger({ service: 'eda-test', destination: out }).warn({ event: 'dependency.degraded' });
    expect(out.lines[0]).toMatchObject({ level: 'warn', service: 'eda-test' });
    expect(String(out.lines[0]?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('redact listesi 59 yol, olay sözlüğü tekil', () => {
    expect(REDACT_PATHS.length).toBe(59);
    expect(new Set(LOG_EVENTS).size).toBe(LOG_EVENTS.length);
  });
});
