// KK-AUDIT-6: meta veri süzgeci ve gün hesabı (saf işlevler; savunma derinliği, SQL beyaz listesine ek).

import { AuditLoginFailuresResponse } from '@eda/contracts/api/admin-audit';
import { describe, expect, it } from 'vitest';
import { createAdminAuditService, istanbulDay, safeMetadata } from '../src/admin/audit-service.ts';
import type { AdminDb } from '../src/admin/db.ts';

describe('KK-AUDIT-6: safeMetadata', () => {
  it('yalnız beyaz listeli anahtar ve güvenli skaler değer kalır', () => {
    expect(
      safeMetadata({
        reasonCode: 'identity_mismatch',
        amount: 10,
        status: false,
        email: 'a@b.test',
        code: 'serbest metin',
        scope: { x: 1 },
        kind: 'x'.repeat(65),
        newValue: null,
      }),
    ).toEqual({ reasonCode: 'identity_mismatch', amount: 10, status: false });
  });

  it('nesne olmayan girdi boş sonuç verir', () => {
    expect(safeMetadata(null)).toEqual({});
    expect(safeMetadata(['kind'])).toEqual({});
    expect(safeMetadata('x')).toEqual({});
  });

  it('Europe/Istanbul günü UTC gece yarısından sonra bir gün ileridir', () => {
    expect(istanbulDay(new Date('2026-10-15T22:30:00Z'))).toBe('2026-10-16');
    expect(istanbulDay(new Date('2026-10-15T20:30:00Z'))).toBe('2026-10-15');
  });
});

describe('KK-GIRIS-1: yönetim girişi sayaçları (loginFailures)', () => {
  const dbWith = (rows: unknown[] | Error): AdminDb => ({
    withAdmin: async (fn) => {
      if (rows instanceof Error) throw rows;
      return fn({ query: async () => ({ rows }) as never, db: undefined as never });
    },
    withAdminWrite: async () => {
      throw new Error('yazma yok');
    },
    end: async () => undefined,
  });
  const at = () => new Date('2026-10-17T08:00:00Z');

  it('toplamlar ve nedenler eşlenir; kod dışı neden "other" olur; yanıt şemaya uyar ve alan eklemez', async () => {
    const svc = createAdminAuditService({
      now: at,
      db: dbWith([
        { scope: 'total', key: 'failures24h', n: '7' },
        { scope: 'total', key: 'failures7d', n: '31' },
        { scope: 'total', key: 'lockouts24h', n: '2' },
        { scope: 'reason', key: 'invalid_credentials', n: '5' },
        { scope: 'reason', key: 'backoff', n: '2' },
        { scope: 'reason', key: 'a@b.test', n: '1' },
      ]),
    });
    const out = await svc.loginFailures('00000000-0000-4000-8000-000000000001');
    expect(() => AuditLoginFailuresResponse.parse(out)).not.toThrow();
    expect(out).toMatchObject({ failures24h: 7, failures7d: 31, lockouts24h: 2 });
    expect(out.byReason.map((r) => r.key)).toEqual(['invalid_credentials', 'backoff', 'other']);
    expect(JSON.stringify(out)).not.toContain('a@b.test');
  });

  it('satır yoksa sıfır döner; personel değilse (42501) ADMIN_FORBIDDEN', async () => {
    const empty = await createAdminAuditService({ now: at, db: dbWith([]) }).loginFailures('x');
    expect(empty).toMatchObject({ failures24h: 0, failures7d: 0, lockouts24h: 0, byReason: [] });
    await expect(
      createAdminAuditService({
        now: at,
        db: dbWith(Object.assign(new Error('x'), { code: '42501' })),
      }).loginFailures('x'),
    ).rejects.toMatchObject({ code: 'ADMIN_FORBIDDEN' });
  });
});
