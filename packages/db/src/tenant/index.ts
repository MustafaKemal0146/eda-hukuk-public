// `@eda/db/tenant` alt yolu (P03a'dan beri): kiracı sarmalayıcısının tipli yüzü src/tenant.ts'tedir.
// Bu dosya yalnız adlandırılmış yeniden dışa aktarımdır (`export *` YOK).
export {
  bindDeletionReason,
  createTenantRunner,
  NO_TENANT_REASONS,
  type NoTenantReason,
  type NoTenantTx,
  type Queryable,
  SLOW_TX_WARN_MS,
  type TenantCtx,
  type TenantLogEntry,
  type TenantLogger,
  TenantNestingError,
  type TenantRunner,
  type TenantRunnerOptions,
  type TenantTx,
  TenantTxClosedError,
  type TxOptions,
  type UserCtx,
  type UserTx,
} from '../tenant.ts';
