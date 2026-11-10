// Koltuk fixture'ı (042 §4.3; P04b): `members_seat_limit` tetikleyicisi canlı aboneliği olmayan büroda
// kapasiteyi 1 sayar. Birden çok üyeli test bürolarına çok koltuklu canlı abonelik satırı, seed ile aynı
// RLS istisnası (032 §11.3; `withSeedRlsException`) ve kendi işlemiyle yazılır. Açık bir işlem içinden
// çağrılmaz.
import type pg from 'pg';
import { withSeedRlsException } from '../../src/seed/rls-exception.ts';

/** Fixture bürolarının koltuk sayısı (dünyalardaki en kalabalık büroyu karşılar). */
export const FIXTURE_SEATS = 50;

export async function grantSeats(
  owner: pg.Client,
  orgId: string,
  seats: number = FIXTURE_SEATS,
): Promise<void> {
  await owner.query('BEGIN');
  try {
    await withSeedRlsException(owner, 'subscriptions', () =>
      owner.query(
        `INSERT INTO app.subscriptions (org_id, plan_code, status, provider, seats)
         VALUES ($1, 'firm', 'active', 'manual', $2)`,
        [orgId, seats],
      ),
    );
    await owner.query('COMMIT');
  } catch (err) {
    await owner.query('ROLLBACK');
    throw err;
  }
}
