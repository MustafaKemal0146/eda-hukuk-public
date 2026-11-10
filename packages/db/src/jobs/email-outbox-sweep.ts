// `email_outbox.sweep` (045 §6.2 madde 5, §6.6 basamak 5; 043 §9): dakikada bir, `eda_jobs`.
// (1) Süresi geçen `queued`/`sending` satırlar mühürlü parametre açılmadan silinerek `expired` olur;
// (2) `sending` durumunda takılı kalan (işleyici çöktü) satırlar `queued`'a döner;
// (3) bayat `queued` satırlar yeniden kuyruğa alınmak üzere döndürülür (kuyruğa alma `jobId =
// deliveryId` ile idempotenttir ve çağıranın işidir). Sorgular açık durum/zaman filtresi taşır.
import type { JobsDb } from './db.ts';

/**
 * İşleyici çökmesi eşiği (045 §6.2 madde 5: "10 dk"); belge değeridir, yapılandırma anahtarı yoktur
 *.
 */
export const SENDING_STALE_MIN = 10;

export interface EmailOutboxSweepOptions {
  /** `notifications.sweepStaleMin`. */
  readonly staleMin: number;
  /** Tek koşuda yeniden kuyruğa alınacak en çok satır (`jobs.rowBatchSize`). */
  readonly batchSize: number;
  /** Karşılaştırma anı (test: sahte saat); varsayılan şimdi. */
  readonly now?: Date;
}

export interface SweptDelivery {
  readonly id: string;
  readonly class: 'security' | 'deadline' | 'action' | 'service';
  readonly templateCode: string;
}

export interface EmailOutboxSweepResult {
  readonly expired: number;
  readonly reset: number;
  readonly requeue: readonly SweptDelivery[];
}

export async function runEmailOutboxSweep(
  db: JobsDb,
  opts: EmailOutboxSweepOptions,
): Promise<EmailOutboxSweepResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const expired = await tx.query(
      `UPDATE app.email_deliveries SET status = 'expired', sealed_params = NULL
       WHERE status IN ('queued', 'sending') AND expires_at < $1`,
      [now],
    );
    const reset = await tx.query(
      `UPDATE app.email_deliveries SET status = 'queued'
       WHERE status = 'sending' AND updated_at < $1::timestamptz - make_interval(mins => $2)`,
      [now, SENDING_STALE_MIN],
    );
    const stale = await tx.query<{
      id: string;
      class: SweptDelivery['class'];
      template_code: string;
    }>(
      `SELECT id, class, template_code FROM app.email_deliveries
       WHERE status = 'queued' AND created_at < $1::timestamptz - make_interval(mins => $2)
       ORDER BY created_at
       LIMIT $3`,
      [now, opts.staleMin, opts.batchSize],
    );
    return {
      expired: expired.rowCount ?? 0,
      reset: reset.rowCount ?? 0,
      requeue: stale.rows.map((r) => ({ id: r.id, class: r.class, templateCode: r.template_code })),
    };
  });
}
