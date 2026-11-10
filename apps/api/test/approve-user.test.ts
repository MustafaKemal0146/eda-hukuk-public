// @tk TK-05
// KK-P04a-6 (KK-042-6) komut kısmı: `make approve-user` hata eşlemesi ve çıktısı (sahte AdminDb; ağsız).
// Geçersiz e-posta 2, süper yönetici yok/belirsiz 3 (dev-sample/create-staff yönlendirmesi), başvuru
// yok 4, karar beklemiyor 5; başarıda yalnız kimlik soneki ve durum döner, e-posta işi eklenir.
import { describe, expect, it } from 'vitest';
import { type ApproveUserDeps, ApproveUserError, approveUser } from '../src/admin/approve-user.ts';

type AdminDb = ApproveUserDeps['db'];

const ACTOR = '0198d2a4-0000-7000-8000-0000000000f1';
const USER = '0198d2a4-0000-7000-8000-0000000000a1';
const DELIVERY = '0198d2a4-0000-7000-8000-0000000000d1';

type Q = (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

function fakeDb(query: Q): AdminDb {
  const tx = { query } as never;
  return {
    withAdmin: (fn) => fn(tx),
    withAdminWrite: (fn) => fn(tx),
    end: async () => undefined,
  };
}

const pgError = (code: string) => Object.assign(new Error('pg'), { code });

async function exitCode(p: Promise<unknown>): Promise<number> {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApproveUserError);
  return (err as ApproveUserError).exitCode;
}

describe('KK-P04a-6 (KK-042-6): approve-user komutu', () => {
  it('başarı: karar fonksiyonu çağrılır, e-posta işi eklenir, çıktıda e-posta yok', async () => {
    const calls: string[] = [];
    const enqueued: string[] = [];
    const db = fakeDb(async (sql, values) => {
      calls.push(sql.split('(')[0] ?? '');
      if (sql.includes('admin_resolve_actor')) return { rows: [{ id: ACTOR }] };
      if (sql.includes('admin_find_application')) {
        return { rows: [{ user_id: USER, verification_status: 'pending_verification' }] };
      }
      expect(values?.slice(0, 4)).toEqual([ACTOR, USER, 'approved', null]);
      return { rows: [{ id: DELIVERY }] };
    });
    const out = await approveUser(
      { db, enqueueEmailSend: async (id) => void enqueued.push(id) },
      { email: 'Avukat@Ornek.Test' },
    );
    expect(out).toEqual({ userIdSuffix: USER.slice(-8), status: 'verified' });
    expect(JSON.stringify(out)).not.toContain('ornek');
    expect(enqueued).toEqual([DELIVERY]);
    expect(calls).toHaveLength(3);
  });

  it('hata eşlemesi: 2 geçersiz e-posta, 3 aktör yok, 4 başvuru yok, 5 karar beklemiyor', async () => {
    const noop = async () => undefined;
    expect(
      await exitCode(
        approveUser(
          { db: fakeDb(async () => ({ rows: [] })), enqueueEmailSend: noop },
          {
            email: 'avukat@örnek.test',
          },
        ),
      ),
    ).toBe(2);
    const noActor = fakeDb(async () => {
      throw pgError('P0002');
    });
    const err = await approveUser(
      { db: noActor, enqueueEmailSend: noop },
      { email: 'a@ornek.test' },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApproveUserError);
    expect((err as ApproveUserError).exitCode).toBe(3);
    expect((err as ApproveUserError).message).toMatch(/--as/);
    const missing = fakeDb(async (sql) =>
      sql.includes('admin_resolve_actor') ? { rows: [{ id: ACTOR }] } : { rows: [] },
    );
    expect(
      await exitCode(
        approveUser({ db: missing, enqueueEmailSend: noop }, { email: 'a@ornek.test' }),
      ),
    ).toBe(4);
    const decided = fakeDb(async (sql) =>
      sql.includes('admin_resolve_actor')
        ? { rows: [{ id: ACTOR }] }
        : { rows: [{ user_id: USER, verification_status: 'verified' }] },
    );
    expect(
      await exitCode(
        approveUser({ db: decided, enqueueEmailSend: noop }, { email: 'a@ornek.test' }),
      ),
    ).toBe(5);
  });
});
