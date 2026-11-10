// Veri seti modülü servisi (yalnız izleme). Kaynak sağlığı `corpus.source_status` (yargi-mcp'nin yazdığı
// kalıcı yansıma), sayılar `corpus.decisions`/`corpus.laws` üzerinden yönetim fonksiyonlarıyla okunur.
// Karar ve madde metni, hata ayrıntısı (yalnız hata KODU) okunmaz; yükleme/silme yoktur.
import type {
  AdminDatasetsDtoValue,
  DatasetRunDtoValue,
  DatasetSourceDtoValue,
} from '@eda/contracts/api/admin-datasets';
import type { AdminDb } from '@eda/db/admin';

export interface DatasetsServiceDeps {
  readonly db: AdminDb;
  readonly now?: () => Date;
}

const RUNS_LIMIT = 20;

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : (v instanceof Date ? v : new Date(String(v))).toISOString();
const dateOnly = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);

export function createDatasetsService(deps: DatasetsServiceDeps) {
  const now = deps.now ?? (() => new Date());
  return {
    async overview(actorId: string): Promise<AdminDatasetsDtoValue> {
      const r = await deps.db.withAdmin(async (tx) => ({
        sources: await tx.query('SELECT * FROM app.admin_dataset_sources($1)', [actorId]),
        laws: await tx.query('SELECT * FROM app.admin_dataset_legislation($1)', [actorId]),
        runs: await tx.query('SELECT * FROM app.admin_dataset_runs($1, $2)', [actorId, RUNS_LIMIT]),
      }));
      const sources: DatasetSourceDtoValue[] = (r.sources.rows as Record<string, unknown>[]).map(
        (x) => {
          const lastSuccess = iso(x.last_success_at);
          const lastError = iso(x.last_error_at);
          const state = (x.source_state as DatasetSourceDtoValue['state']) ?? null;
          const breaker = (x.breaker_state as DatasetSourceDtoValue['breakerState']) ?? null;
          return {
            source: String(x.source),
            liveEnabled: Boolean(x.live_enabled),
            state,
            breakerState: breaker,
            lastSuccessAt: lastSuccess,
            lastErrorAt: lastError,
            lastErrorCode: (x.last_error_code as string | null) ?? null,
            p95Ms: nn(x.p95_ms),
            bucketFillPct: nn(x.bucket_fill_pct),
            lastCanaryAt: iso(x.last_canary_at),
            lastCanaryOk: x.last_canary_ok === null ? null : Boolean(x.last_canary_ok),
            statusUpdatedAt: iso(x.status_updated_at),
            decisionCount: n(x.decision_count),
            corpusCount: n(x.corpus_count),
            liveCount: n(x.live_count),
            withdrawnCount: n(x.withdrawn_count),
            lastRetrievedAt: iso(x.last_retrieved_at),
            hasError:
              state === 'down' ||
              breaker === 'open' ||
              (lastError !== null && (lastSuccess === null || lastError > lastSuccess)),
          };
        },
      );
      return {
        sources,
        legislation: (r.laws.rows as Record<string, unknown>[]).map((x) => ({
          lawType: String(x.law_type),
          lawCount: n(x.law_count),
          inForceCount: n(x.in_force_count),
          repealedCount: n(x.repealed_count),
          articleCount: n(x.article_count),
          lastSnapshotAt: iso(x.last_snapshot_at),
          lastAmendedDate: dateOnly(x.last_amended_date),
        })),
        runs: (r.runs.rows as Record<string, unknown>[]).map(
          (x): DatasetRunDtoValue => ({
            runId: String(x.run_id),
            kind: String(x.run_kind),
            source: (x.source as string | null) ?? null,
            status: x.run_status as DatasetRunDtoValue['status'],
            itemsSeen: n(x.items_seen),
            itemsInserted: n(x.items_inserted),
            itemsUpdated: n(x.items_updated),
            itemsFailed: n(x.items_failed),
            startedAt: iso(x.started_at) ?? '',
            finishedAt: iso(x.finished_at),
          }),
        ),
        generatedAt: now().toISOString(),
      };
    },
  };
}

export type DatasetsService = ReturnType<typeof createDatasetsService>;
