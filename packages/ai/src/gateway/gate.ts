// Veri sınıfı kapısı (020 §4; Y-23/Y-24/Y-31): saf karar fonksiyonu. Kökenden sınıf; sınıf PII
// algılamasıyla düşürülmez; deepseek yalnız public alır. Dev istisnaları: MOCK_LLM (yalnız
// development/test) ve DEV_REAL_LLM=deepseek|anthropic (development ve beta-synthetic, sentetik veri bildirimiyle).
import type { AiCatalog, ModelRow, ProviderRow } from './catalog.ts';

export type DataClass = 'public' | 'client' | 'case';
export type OriginKind =
  | 'user_text'
  | 'attachment'
  | 'file_mention'
  | 'case_binding'
  | 'case_tool_result'
  | 'corpus'
  | 'live_source'
  | 'system';

export type GateEnv = {
  edaEnv: 'development' | 'test' | 'staging' | 'beta-synthetic' | 'production' | 'onprem';
  mockLlm: boolean;
  devRealLlm: 'deepseek' | 'anthropic' | null;
};

export type GateInput = {
  alias: 'edai-flash' | 'edai-pro';
  origins: readonly OriginKind[];
  /** Sohbetin kalıcı sınıfı (yalnız yükselir). */
  conversationClass: DataClass;
  /** "Genel araştırma (kamu)" modu beyanı (Y-25); dilimde kapalı. */
  publicModeDeclared: boolean;
};

export type Candidate = { provider: ProviderRow; model: ModelRow };

export type GateDecision =
  | {
      ok: true;
      dataClass: DataClass;
      candidates: Candidate[];
      flags: ('mock' | 'dev_real_llm')[];
      notices: ('simulation' | 'beta_synthetic')[];
    }
  | { ok: false; code: 'AI_POLICY_NO_PROVIDER' | 'AI_MOCK_FORBIDDEN' };

const RANK: Record<DataClass, number> = { public: 0, client: 1, case: 2 };
const ORIGIN_CLASS: Record<OriginKind, DataClass> = {
  user_text: 'client',
  attachment: 'client',
  file_mention: 'case',
  case_binding: 'case',
  case_tool_result: 'case',
  corpus: 'public',
  live_source: 'public',
  system: 'public',
};

export function classOf(input: GateInput): DataClass {
  let cls: DataClass = input.conversationClass;
  for (const o of input.origins) {
    let c = ORIGIN_CLASS[o];
    // Kamu modunda kullanıcı metni public sayılır; ek/dava gelirse mod biter (020 §4.3 adım 3).
    if (o === 'user_text' && input.publicModeDeclared) c = 'public';
    if (RANK[c] > RANK[cls]) cls = c;
  }
  return cls;
}

export function decide(catalog: AiCatalog, env: GateEnv, input: GateInput): GateDecision {
  const dataClass = classOf(input);
  const models = catalog.models.filter((m) => m.alias === input.alias);
  const pair = (kind: ProviderRow['kind']): Candidate[] =>
    models.flatMap((model) => {
      const provider = catalog.providers.find((p) => p.id === model.providerId);
      return provider && provider.kind === kind ? [{ provider, model }] : [];
    });

  if (env.mockLlm) {
    if (env.edaEnv !== 'development' && env.edaEnv !== 'test') {
      return { ok: false, code: 'AI_MOCK_FORBIDDEN' };
    }
    const mock = pair('mock');
    return mock.length > 0
      ? { ok: true, dataClass, candidates: mock, flags: ['mock'], notices: ['simulation'] }
      : { ok: false, code: 'AI_POLICY_NO_PROVIDER' };
  }

  if (
    env.devRealLlm !== null &&
    (env.edaEnv === 'development' || env.edaEnv === 'beta-synthetic')
  ) {
    // Geliştirici açıkça seçtiği için `enabled` bayrağı aranmaz (P07d: anthropic tohumda kapalıdır);
    // yalnız sentetik veri, beta_synthetic bildirimi (020 §15.4). beta-synthetic tek VPS pilotunda da
    // açıktır; production/staging/onprem'de env doğrulaması bayrağı zaten reddeder ve kapı da yok sayar.
    const kind = env.devRealLlm;
    // Doğrudan API sağlayıcısı (id = tür): `anthropic-eu` AB uç noktası ayrı yapılandırma ister.
    const real = pair(kind).filter(
      (c) => c.provider.id === kind && (kind === 'anthropic' || c.provider.enabled),
    );
    return real.length > 0
      ? {
          ok: true,
          dataClass,
          candidates: real,
          flags: ['dev_real_llm'],
          notices: ['beta_synthetic'],
        }
      : { ok: false, code: 'AI_POLICY_NO_PROVIDER' };
  }

  const candidates = models
    .flatMap((model) => {
      const provider = catalog.providers.find((p) => p.id === model.providerId);
      return provider ? [{ provider, model }] : [];
    })
    .filter(
      (c) =>
        c.provider.enabled &&
        c.provider.kind !== 'mock' &&
        c.provider.allowedDataClasses.includes(dataClass),
    )
    .sort((a, b) => a.provider.priority - b.provider.priority);
  return candidates.length > 0
    ? { ok: true, dataClass, candidates, flags: [], notices: [] }
    : { ok: false, code: 'AI_POLICY_NO_PROVIDER' };
}
