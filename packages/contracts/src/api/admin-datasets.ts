// Yönetim paneli "Veri seti" modülü sözleşmeleri (yalnız izleme): karar arşivi kaynak durumu, mevzuat
// özeti ve son alım çalıştırmaları. Yükleme/silme yoktur. Karar veya madde METNİ taşımaz.
import { z } from 'zod';

const IsoDateTime = z.iso.datetime({ offset: true });
const Count = z.number().int().nonnegative();

export const DatasetSourceDto = z.strictObject({
  source: z.string(),
  liveEnabled: z.boolean(),
  state: z.enum(['up', 'degraded', 'down', 'disabled']).nullable(),
  breakerState: z.enum(['closed', 'open', 'half_open']).nullable(),
  lastSuccessAt: IsoDateTime.nullable(),
  lastErrorAt: IsoDateTime.nullable(),
  /** Hata KODU (ayrıntı/ileti yok). */
  lastErrorCode: z.string().nullable(),
  p95Ms: z.number().int().nullable(),
  bucketFillPct: z.number().int().nullable(),
  lastCanaryAt: IsoDateTime.nullable(),
  lastCanaryOk: z.boolean().nullable(),
  statusUpdatedAt: IsoDateTime.nullable(),
  decisionCount: Count,
  corpusCount: Count,
  liveCount: Count,
  withdrawnCount: Count,
  lastRetrievedAt: IsoDateTime.nullable(),
  /** Kaynakta hata var: açık devre kesici, `down` durumu veya son hata son başarıdan yeni. */
  hasError: z.boolean(),
});
export type DatasetSourceDtoValue = z.infer<typeof DatasetSourceDto>;

export const DatasetLegislationDto = z.strictObject({
  lawType: z.string(),
  lawCount: Count,
  inForceCount: Count,
  repealedCount: Count,
  articleCount: Count,
  lastSnapshotAt: IsoDateTime.nullable(),
  lastAmendedDate: z.string().nullable(),
});
export type DatasetLegislationDtoValue = z.infer<typeof DatasetLegislationDto>;

export const DatasetRunDto = z.strictObject({
  runId: z.uuid(),
  kind: z.string(),
  source: z.string().nullable(),
  status: z.enum(['running', 'succeeded', 'partial', 'failed']),
  itemsSeen: Count,
  itemsInserted: Count,
  itemsUpdated: Count,
  itemsFailed: Count,
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
});
export type DatasetRunDtoValue = z.infer<typeof DatasetRunDto>;

export const AdminDatasetsDto = z.strictObject({
  sources: z.array(DatasetSourceDto),
  legislation: z.array(DatasetLegislationDto),
  runs: z.array(DatasetRunDto),
  /** Sayılar yalnız yönetim içindir; kullanıcıya dönük metinlerde korpus büyüklüğü iddiası yazılmaz. */
  generatedAt: IsoDateTime,
});
export type AdminDatasetsDtoValue = z.infer<typeof AdminDatasetsDto>;
