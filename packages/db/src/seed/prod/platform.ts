// Platform referans verisi (032 §10.6, §10.10): paketler (6), bayraklar (2), kaynak durumu (14).
// Paket kredi/OCR/depolama miktarları ve fiyatlar BAŞLANGIÇ VARSAYILANIDIR (093 kesinleştirir;
// ); `iyzico_plan_ref_*` NULL kalır (P25), `is_active` yönetici alanıdır (seed dokunmaz).
// `system_settings` satırı yazılmaz (öncelik: kod varsayılanı -> env -> DB).
import { MVP_LIVE_SOURCE_CODES, SOURCE_CODES } from '@eda/contracts/enums';
import type { SeedDef } from '../types.ts';
import { type UpsertSpec, upsertRows } from '../upsert.ts';

const GIB = 1024 ** 3;

export interface PlanSeedRow {
  readonly code: 'trial' | 'trainee' | 'lawyer' | 'lawyer_pro' | 'firm' | 'enterprise';
  readonly name: string;
  readonly per_seat: boolean;
  readonly seat_min: number;
  readonly seat_max: number | null;
  readonly monthly_credits: number;
  readonly monthly_ocr_pages: number;
  readonly storage_quota_bytes: number;
  readonly price_monthly_kurus: number | null;
  readonly price_yearly_kurus: number | null;
  readonly is_public: boolean;
  readonly sort_order: number;
}

/** 032 §10.6 tablosu (KDV dahil kuruş; deneme kredisi plan satırında değil `trial.credits`). */
export const PLAN_ROWS: readonly PlanSeedRow[] = [
  {
    code: 'trial',
    name: 'Deneme',
    per_seat: false,
    seat_min: 1,
    seat_max: 1,
    monthly_credits: 0,
    monthly_ocr_pages: 100,
    storage_quota_bytes: 2 * GIB,
    price_monthly_kurus: null,
    price_yearly_kurus: null,
    is_public: false,
    sort_order: 0,
  },
  {
    code: 'trainee',
    name: 'Stajyer',
    per_seat: false,
    seat_min: 1,
    seat_max: 1,
    monthly_credits: 300,
    monthly_ocr_pages: 500,
    storage_quota_bytes: 10 * GIB,
    price_monthly_kurus: null,
    price_yearly_kurus: 1_188_000,
    is_public: true,
    sort_order: 1,
  },
  {
    code: 'lawyer',
    name: 'Avukat',
    per_seat: false,
    seat_min: 1,
    seat_max: 1,
    monthly_credits: 600,
    monthly_ocr_pages: 1_500,
    storage_quota_bytes: 25 * GIB,
    price_monthly_kurus: 199_000,
    price_yearly_kurus: 1_990_000,
    is_public: true,
    sort_order: 2,
  },
  {
    code: 'lawyer_pro',
    name: 'Avukat Pro',
    per_seat: false,
    seat_min: 1,
    seat_max: 1,
    monthly_credits: 1_500,
    monthly_ocr_pages: 4_000,
    storage_quota_bytes: 100 * GIB,
    price_monthly_kurus: 349_000,
    price_yearly_kurus: 3_490_000,
    is_public: true,
    sort_order: 3,
  },
  {
    code: 'firm',
    name: 'Büro',
    per_seat: true,
    seat_min: 3,
    seat_max: null,
    monthly_credits: 600,
    monthly_ocr_pages: 1_500,
    storage_quota_bytes: 25 * GIB,
    price_monthly_kurus: null,
    price_yearly_kurus: 2_988_000,
    is_public: true,
    sort_order: 4,
  },
  {
    code: 'enterprise',
    name: 'Kurumsal',
    per_seat: true,
    seat_min: 3,
    seat_max: null,
    monthly_credits: 0,
    monthly_ocr_pages: 0,
    storage_quota_bytes: 0,
    price_monthly_kurus: null,
    price_yearly_kurus: null,
    is_public: true,
    sort_order: 5,
  },
];

const PLAN_UPDATE = [
  'name',
  'per_seat',
  'seat_min',
  'seat_max',
  'monthly_credits',
  'monthly_ocr_pages',
  'storage_quota_bytes',
  'price_monthly_kurus',
  'price_yearly_kurus',
  'features',
  'is_public',
  'sort_order',
] as const;

const PLANS: UpsertSpec = {
  table: 'app.plans',
  key: ['code'],
  columns: ['code', ...PLAN_UPDATE],
  update: [...PLAN_UPDATE],
  casts: { features: 'jsonb' },
};

export function plansSeed(rows: readonly PlanSeedRow[] = PLAN_ROWS): SeedDef {
  // `features` 093 doldurur; şimdilik boş nesne.
  const mapped = rows.map((r) => ({ ...r, features: '{}' }));
  return {
    name: 'plans',
    stage: 'prod',
    content: mapped,
    apply: (q) => upsertRows(q, PLANS, mapped),
  };
}

/** 032 §10.10: bakım modu kapalı; korpus toplu alımı varsayılan KAPALI (002 §17). */
export const FEATURE_FLAG_ROWS = [
  { key: 'maintenance_mode', enabled: false, description: 'Bakım modu (yalnız süper admin açar)' },
  {
    key: 'corpus_ingest_run_enabled',
    enabled: false,
    description: 'Korpus toplu alım işi (corpus.ingest_run)',
  },
] as const;

const FLAGS: UpsertSpec = {
  table: 'app.feature_flags',
  key: ['key'],
  columns: ['key', 'enabled', 'description'],
  update: [], // DO NOTHING: `enabled` yönetici alanıdır.
};

export function featureFlagsSeed(): SeedDef {
  const rows = FEATURE_FLAG_ROWS.map((r) => ({ ...r }));
  return {
    name: 'feature_flags',
    stage: 'prod',
    content: rows,
    apply: (q) => upsertRows(q, FLAGS, rows),
  };
}

const SOURCE_STATUS: UpsertSpec = {
  table: 'corpus.source_status',
  key: ['source'],
  columns: ['source', 'live_enabled'],
  update: [], // `live_enabled` yalnız ilk eklemede; çalışma zamanı alanlarına dokunulmaz.
};

export function sourceStatusSeed(): SeedDef {
  const live = new Set<string>(MVP_LIVE_SOURCE_CODES);
  const rows = SOURCE_CODES.map((source) => ({ source, live_enabled: live.has(source) }));
  return {
    name: 'source_status',
    stage: 'prod',
    content: rows,
    apply: (q) => upsertRows(q, SOURCE_STATUS, rows),
  };
}
