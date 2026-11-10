// Yönetim "Yapay zekâ" servisi: sağlayıcı/model kataloğunun salt okur görünümü, model başına son 7 gün
// çağrı/hata özeti, istem sürüm özeti ve model etkin/pasif anahtarı. Okuma/yazma `eda_readonly_admin`
// havuzundan `app.admin_ai_*` SECURITY DEFINER fonksiyonlarıyla yapılır; aktör her çağrıda veritabanında
// `super_admin` doğrulanır. Sır DEĞERİ okunmaz: anahtar kaynağı için yalnız var/yok yoklaması yapılır.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AdminAiCatalogResponseValue,
  AdminAiPromptsResponseValue,
  AdminAiPromptTextResponseValue,
  AdminAiUsageResponseValue,
  SetAiModelEnabledResultValue,
} from '@eda/contracts/api/admin-ai';
import { AppError } from '@eda/contracts/errors';
import { PROMPTS, type PromptKey } from '@eda/contracts/prompts';
import type { AdminDb } from '@eda/db/admin';
import { AI_CATALOG_SEED } from '@eda/db/ai-catalog';

export const AI_USAGE_WINDOW_DAYS = 7;

export interface AiConfigServiceDeps {
  readonly db: AdminDb;
  /** Sağlayıcı anahtar kaynağı (`secret_ref`) dolu mu? Değer okunup dışarı verilmez. */
  readonly secretConfigured: (secretRef: string) => boolean;
}

/** `${dir}/${ref}` dosyası var ve boş değilse true (değer hiçbir yere taşınmaz). */
export function fileSecretProbe(dir: string): (ref: string) => boolean {
  return (ref) => {
    if (!/^[a-z0-9_]{2,64}$/.test(ref)) return false;
    try {
      return readFileSync(join(dir, ref), 'utf8').trim() !== '';
    } catch {
      return false;
    }
  };
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : (v instanceof Date ? v : new Date(String(v))).toISOString();
const sqlState = (err: unknown): string | undefined => {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
};
const isKey = (k: string): k is PromptKey => Object.hasOwn(PROMPTS, k);

export function createAiConfigService(deps: AiConfigServiceDeps) {
  return {
    async catalog(actorId: string): Promise<AdminAiCatalogResponseValue> {
      const { prov, mod } = await deps.db.withAdmin(async (tx) => ({
        prov: (await tx.query('SELECT * FROM app.admin_ai_providers($1)', [actorId]))
          .rows as Record<string, unknown>[],
        mod: (await tx.query('SELECT * FROM app.admin_ai_models($1)', [actorId])).rows as Record<
          string,
          unknown
        >[],
      }));
      const providers = prov.map((p) => {
        const ref = (p.secret_ref as string | null) ?? null;
        return {
          id: String(p.id),
          kind: String(p.kind),
          region: String(p.region),
          enabled: p.enabled === true,
          priority: n(p.priority),
          allowedDataClasses: (p.allowed_data_classes as ('public' | 'client' | 'case')[]) ?? [],
          transferBasis: (p.transfer_basis as string | null) ?? null,
          trainingUse: p.training_use === true,
          humanReview: p.human_review === true,
          retentionDays: p.retention_days === null ? null : n(p.retention_days),
          secretConfigured: ref === null ? null : deps.secretConfigured(ref),
        };
      });
      const models = mod.map((m) => {
        // Katalog kaydında yetenekler snake_case saklanır (`strict_tools`); camelCase eski anlık görüntü biçimi de kabul edilir.
        const caps = (m.capabilities ?? {}) as {
          tools?: unknown;
          strict_tools?: unknown;
          strictTools?: unknown;
        };
        return {
          id: String(m.id),
          alias: String(m.alias),
          providerId: String(m.provider_id),
          label: String(m.label),
          thinking: String(m.thinking),
          maxOutputTokens: n(m.max_output_tokens),
          contextBudget: n(m.context_budget),
          capabilities: {
            tools: caps.tools === true,
            strictTools: caps.strict_tools === true || caps.strictTools === true,
          },
          enabled: m.enabled === true,
          priority: n(m.priority),
          evalGatePassedAt: iso(m.eval_gate_passed_at),
        };
      });
      const dbProviders = new Set(providers.map((p) => p.id));
      const dbModels = new Set(models.map((m) => `${m.alias}|${m.providerId}`));
      return {
        providers,
        models,
        notInDb: {
          providers: AI_CATALOG_SEED.providers
            .map((p) => p.id)
            .filter((id) => !dbProviders.has(id)),
          models: AI_CATALOG_SEED.models
            .filter((m) => !dbModels.has(`${m.alias}|${m.providerId}`))
            .map((m) => ({ alias: m.alias, providerId: m.providerId, label: m.label })),
        },
      };
    },

    async usage(actorId: string): Promise<AdminAiUsageResponseValue> {
      const r = await deps.db.withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_ai_usage($1, $2)', [actorId, AI_USAGE_WINDOW_DAYS]),
      );
      return {
        windowDays: AI_USAGE_WINDOW_DAYS,
        items: (r.rows as Record<string, unknown>[]).map((x) => {
          const calls = n(x.calls);
          const errors = n(x.errors);
          return {
            alias: String(x.model_alias),
            providerId: String(x.provider_id),
            calls,
            errors,
            errorRate: calls === 0 ? 0 : Math.min(1, errors / calls),
            avgLatencyMs: x.avg_latency_ms === null ? null : n(x.avg_latency_ms),
          };
        }),
      };
    },

    prompts(): AdminAiPromptsResponseValue {
      return {
        items: (Object.keys(PROMPTS) as PromptKey[]).map((key) => {
          const p = PROMPTS[key];
          return {
            key,
            version: p.version,
            chars: p.text.length,
            sha256: createHash('sha256').update(p.text, 'utf8').digest('hex'),
          };
        }),
      };
    },

    /** İstem metni yalnız salt okur görüntülenir; düzenleme ucu yoktur (istemler kodla sürümlenir). */
    promptText(key: string): AdminAiPromptTextResponseValue {
      if (!isKey(key)) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
      const p = PROMPTS[key];
      return { key, version: p.version, text: p.text };
    },

    async setModelEnabled(
      actorId: string,
      modelId: string,
      enabled: boolean,
    ): Promise<SetAiModelEnabledResultValue> {
      try {
        const changed = await deps.db.withAdminWrite(async (tx) => {
          const r = await tx.query<{ changed: boolean }>(
            'SELECT app.admin_set_ai_model_enabled($1, $2, $3) AS changed',
            [actorId, modelId, enabled],
          );
          return r.rows[0]?.changed === true;
        });
        return { id: modelId, enabled, changed };
      } catch (err) {
        const code = sqlState(err);
        if (code === 'P0002') throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
        if (code === '42501') throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
        if (code === '55000')
          throw new AppError('VALIDATION_CONFLICT', { reason: 'state_changed' });
        throw err;
      }
    },
  };
}

export type AiConfigService = ReturnType<typeof createAiConfigService>;
