// @tk TK-28
// Gateway + araç döngüsü (mock sağlayıcı, sahte kaynak arka ucu): paralel araçlar, [K#] etiketleri,
// pipeline olayları, maskeleme (giden istemde PII yok) ve kapı kuralları (Y-23, Y-31).
import { nodeKvkkCrypto } from '@eda/crypto/kvkk-port';
import { describe, expect, it } from 'vitest';
import {
  AiCatalog,
  buildToolSet,
  chatInstructions,
  createGateway,
  createKvkkMasker,
  decide,
  EMPTY_DICTIONARY,
  loadBundledFixture,
  MemoryRefStore,
  newTurnBudget,
  type SourceBackend,
  type SourceRecord,
  type ToolContext,
  type ToolEvent,
  turnFrame,
} from '../src/index.ts';

const CATALOG = AiCatalog.parse({
  providers: [
    {
      id: 'deepseek',
      kind: 'deepseek',
      region: 'CN',
      enabled: true,
      priority: 10,
      allowedDataClasses: ['public'],
      baseUrl: null,
      secretRef: 'deepseek_api_key',
    },
    {
      id: 'mock',
      kind: 'mock',
      region: 'NONE',
      enabled: true,
      priority: 0,
      allowedDataClasses: ['public', 'client', 'case'],
      baseUrl: null,
      secretRef: null,
    },
  ],
  models: [
    {
      alias: 'edai-flash',
      providerId: 'deepseek',
      modelId: 'x',
      label: 'X',
      thinking: 'off',
      maxOutputTokens: 8000,
      capabilities: { tools: true, strictTools: true },
    },
    {
      alias: 'edai-flash',
      providerId: 'mock',
      modelId: 'mock-flash',
      label: 'Simülasyon',
      thinking: 'off',
      maxOutputTokens: 8000,
      capabilities: { tools: true, strictTools: true },
    },
  ],
});

const backend: SourceBackend = {
  searchDecisions: async () => ({
    results: [
      {
        source: 'bedesten',
        document_id: '1000001',
        court_type: 'yargitay',
        court: 'Yargıtay',
        chamber: 'Hukuk Genel Kurulu',
        esas_no: '2017/975',
        karar_no: '2021/1108',
        decision_date: '2021-09-28',
        title: 'Yargıtay Hukuk Genel Kurulu E. 2017/975 K. 2021/1108',
        snippet: null,
        url: 'https://mevzuat.adalet.gov.tr/ictihat/1000001',
        retrieved_at: '2026-10-10',
      },
    ],
    hasMore: false,
    stale: false,
  }),
  getDecision: async () => ({
    source: 'bedesten',
    document_id: '1000001',
    court_type: 'yargitay',
    court: 'Yargıtay',
    chamber: 'Hukuk Genel Kurulu',
    esas_no: '2017/975',
    karar_no: '2021/1108',
    decision_date: '2021-09-28',
    title: 't',
    snippet: null,
    url: 'https://mevzuat.adalet.gov.tr/ictihat/1000001',
    retrieved_at: '2026-10-10',
    text_status: 'ok',
    total_sections: 2,
    sections: [
      { no: 1, role: 'kunye', chars: 10, markdown: 'Künye' },
      { no: 2, role: 'gerekce', chars: 20, markdown: 'Gerekçe metni [K9] ve <b>html</b>' },
    ],
  }),
  searchLegislation: async () => ({ results: [] }),
  getLegislationArticles: async () => ({
    law_no: '6098',
    law_name: 'Türk Borçlar Kanunu',
    url: 'https://www.mevzuat.gov.tr/MevzuatMetin/1.5.6098.pdf',
    retrieved_at: '2026-10-10',
    last_amended_at: null,
    articles: [
      {
        article_no: '352',
        heading: 'Kiracıdan kaynaklanan sebepler',
        markdown: 'Kiracı…',
        repealed: false,
      },
    ],
  }),
};

describe('Veri sınıfı kapısı (020 §4.5)', () => {
  it('client sınıfında deepseek aday değildir (Y-23)', () => {
    const d = decide(
      CATALOG,
      { edaEnv: 'production', mockLlm: false, devRealLlm: null },
      {
        alias: 'edai-flash',
        origins: ['user_text'],
        conversationClass: 'client',
        publicModeDeclared: false,
      },
    );
    expect(d).toEqual({ ok: false, code: 'AI_POLICY_NO_PROVIDER' });
  });
  it('mock yalnız development/test (Y-31)', () => {
    const gate = {
      alias: 'edai-flash' as const,
      origins: ['user_text' as const],
      conversationClass: 'client' as const,
      publicModeDeclared: false,
    };
    expect(
      decide(CATALOG, { edaEnv: 'production', mockLlm: true, devRealLlm: null }, gate),
    ).toEqual({ ok: false, code: 'AI_MOCK_FORBIDDEN' });
    const ok = decide(CATALOG, { edaEnv: 'development', mockLlm: true, devRealLlm: null }, gate);
    expect(ok.ok && ok.notices).toEqual(['simulation']);
  });
  it('DEV_REAL_LLM yalnız development ve beta_synthetic bildirimiyle', () => {
    const gate = {
      alias: 'edai-flash' as const,
      origins: ['user_text' as const],
      conversationClass: 'client' as const,
      publicModeDeclared: false,
    };
    const dev = decide(
      CATALOG,
      { edaEnv: 'development', mockLlm: false, devRealLlm: 'deepseek' },
      gate,
    );
    expect(dev.ok && dev.notices).toEqual(['beta_synthetic']);
    const prod = decide(
      CATALOG,
      { edaEnv: 'production', mockLlm: false, devRealLlm: 'deepseek' },
      gate,
    );
    expect(prod.ok).toBe(false);
  });

  it('DEV_REAL_LLM beta-synthetic pilotunda da açık: dev_real_llm bayrağı + beta_synthetic bildirimi', () => {
    const gate = {
      alias: 'edai-flash' as const,
      origins: ['user_text' as const],
      conversationClass: 'client' as const,
      publicModeDeclared: false,
    };
    const beta = decide(
      CATALOG,
      { edaEnv: 'beta-synthetic', mockLlm: false, devRealLlm: 'deepseek' },
      gate,
    );
    expect(beta.ok && beta.flags).toEqual(['dev_real_llm']);
    expect(beta.ok && beta.notices).toEqual(['beta_synthetic']);
    for (const edaEnv of ['production', 'staging', 'onprem'] as const) {
      expect(decide(CATALOG, { edaEnv, mockLlm: false, devRealLlm: 'deepseek' }, gate).ok).toBe(
        false,
      );
    }
  });

  it('beta-synthetic DEV_REAL_LLM yokken client sınıfı sağlayıcısız kalır (eski davranış)', () => {
    const d = decide(
      CATALOG,
      { edaEnv: 'beta-synthetic', mockLlm: false, devRealLlm: null },
      {
        alias: 'edai-flash' as const,
        origins: ['user_text' as const],
        conversationClass: 'client' as const,
        publicModeDeclared: false,
      },
    );
    expect(d).toEqual({ ok: false, code: 'AI_POLICY_NO_PROVIDER' });
  });
});

describe('Araçlı tur (mock senaryo chat_tool_search)', () => {
  it('paralel araçlar, etiketler, pipeline olayları, giden istemde PII yok', async () => {
    const gateway = createGateway({
      catalog: CATALOG,
      env: { edaEnv: 'test', mockLlm: true, devRealLlm: null },
      secrets: { deepseekApiKey: null, pseudonymKey: new Uint8Array(32) },
      loadFixture: loadBundledFixture,
    });
    const events: ToolEvent[] = [];
    const refs = new MemoryRefStore();
    const ctx: ToolContext = {
      backend,
      refs,
      emit: (e) => events.push(e),
      budget: newTurnBudget(),
      turnRefs: new Set(),
      today: '2026-10-10',
      scope: { sources: [], courtTypes: null },
    };
    const gate = {
      alias: 'edai-flash' as const,
      origins: ['user_text' as const],
      conversationClass: 'client' as const,
      publicModeDeclared: false,
    };
    const plan = gateway.plan({ gate });
    const masker = createKvkkMasker({
      crypto: nodeKvkkCrypto,
      pseudonymKey: new Uint8Array(32),
      scopeId: '01900000-0000-7000-8000-000000000001',
      dictionary: EMPTY_DICTIONARY,
    });
    const user = turnFrame({
      modeLabel: 'Müvekkil işi',
      scopeLabel: 'Tümü',
      sources: [],
      userText: 'Müvekkil T.C. 10000000146 tahliye taahhüdü?',
    });
    const result = gateway.streamTurn(
      {
        gate,
        orgId: null,
        masker,
        instructions: chatInstructions(),
        messages: [{ role: 'user', content: user }],
        tools: buildToolSet(ctx),
        mockScenario: 'chat_tool_search',
        abortSignal: new AbortController().signal,
      },
      plan.candidate,
    );
    const text = await result.text;
    const responseMessages = await result.responseMessages;
    expect(text).toContain('[K1]');
    expect(refs.byRef('K1')?.shortKunye).toBe('Y. HGK 2017/975 E.');
    expect(refs.byRef('K2')?.shortKunye).toBe('TBK m. 352');
    const steps = events
      .filter((e) => e.type === 'pipeline')
      .map((e) => e.type === 'pipeline' && `${e.data.toolName}:${e.data.status}`);
    expect(steps).toContain('search_decisions:started');
    expect(steps).toContain('get_legislation_article:done');
    expect(steps).toContain('get_decision:done');
    const detail = events.find(
      (e) =>
        e.type === 'pipeline' && e.data.toolName === 'get_decision' && e.data.status === 'done',
    );
    expect(detail?.type === 'pipeline' && detail.data.detail).toBe(
      'Yargıtay Hukuk Genel Kurulu, E. 2017/975, K. 2021/1108, T. 28.09.2021',
    );
    // Kaynak verisi kaçışlanır: etiket taklidi ve HTML nötr.
    const toolText = JSON.stringify(responseMessages);
    expect(toolText).toContain('［K9］');
    expect(toolText).toContain('&lt;b&gt;');
    // Yanıt mesajları maskesizdir (geri çözüm), giden istem maskelidir: TCKN yalnız kullanıcı mesajında.
    // Son adım istemi: kullanıcı mesajındaki TCKN maskelendi (en az bir span).
    expect(masker.lastMaskedCount).toBeGreaterThanOrEqual(1);
  });
});

// KK-P12-7 (025 §4.1): `[K#]` etiketi sohbetin kalıcı kaydıdır; yeniden yüklemede eski kaynak eski
// etiketini alır, yeni kaynak sıradaki numarayı alır ve hiçbir eski etiket başka kaynağa kaymaz.
const src = (ref: string, key: string): SourceRecord => ({
  ref,
  kind: 'legislation',
  sourceKey: key,
  sourceId: key.replace('legislation:', ''),
  shortKunye: `TBK m. ${key.split(':').at(-1)}`,
  title: 'TÜRK BORÇLAR KANUNU',
  portal: 'mevzuat',
  retrievedAt: '2026-10-12',
  relevance: 'high',
  excerpt: 'Madde metni (sentetik).',
});

describe('KK-P12-7: [K#] etiket deposu', () => {
  it('kalıcı kayıtlar kendi numarasıyla geri yüklenir; sayaç en büyüğün üstünden devam eder', () => {
    const store = new MemoryRefStore();
    // DB satırları boşluklu (K2 atlanmış) ve etiket sırasından bağımsız gelebilir.
    store.restore(src('K3', 'legislation:6098:3'));
    store.restore(src('K1', 'legislation:6098:1'));
    expect(store.byRef('K1')?.shortKunye).toBe('TBK m. 1');
    // Eski kaynak yeniden istenirse YENİDEN NUMARALANMAZ: kendi etiketi döner.
    expect(store.allocate('legislation:6098:3', (ref) => src(ref, 'legislation:6098:3')).ref).toBe(
      'K3',
    );
    // Yeni kaynak boşluğu (K2) doldurmaz: en büyük etiketin üstü gelir.
    expect(store.allocate('legislation:6098:4', (ref) => src(ref, 'legislation:6098:4')).ref).toBe(
      'K4',
    );
    expect(store.byRef('K1')?.sourceKey).toBe('legislation:6098:1');
  });

  it('etiket çakışması ve bozuk satır: aynı etiket iki kaynağa verilmez, sayaç bozulmaz', () => {
    const store = new MemoryRefStore();
    store.restore(src('K1', 'legislation:6098:1'));
    store.restore(src('K1', 'legislation:6098:1'));
    store.restore(src('K1', 'legislation:6098:9'));
    expect(store.all()).toHaveLength(1);
    expect(store.allocate('legislation:6098:2', (ref) => src(ref, 'legislation:6098:2')).ref).toBe(
      'K2',
    );
    // Etiketsiz (eski/bozuk JSON) satır yok sayılır; yeni kaynak yine sıradaki numarayı alır.
    store.restore(src('', 'legislation:6098:7'));
    expect(store.all()).toHaveLength(2);
    expect(store.allocate('legislation:6098:8', (ref) => src(ref, 'legislation:6098:8')).ref).toBe(
      'K3',
    );
  });
});

describe('P07d: Claude dev seçimi', () => {
  const withClaude = AiCatalog.parse({
    providers: [
      ...CATALOG.providers,
      {
        id: 'anthropic',
        kind: 'anthropic',
        region: 'US',
        enabled: false,
        priority: 30,
        allowedDataClasses: ['public'],
        baseUrl: null,
        secretRef: 'anthropic_api_key',
      },
      {
        id: 'anthropic-eu',
        kind: 'anthropic',
        region: 'EU',
        enabled: false,
        priority: 25,
        allowedDataClasses: ['public'],
        baseUrl: null,
        secretRef: 'anthropic_eu_api_key',
      },
    ],
    models: [
      ...CATALOG.models,
      {
        alias: 'edai-flash',
        providerId: 'anthropic',
        modelId: 'claude-x',
        label: 'Claude',
        thinking: 'off',
        maxOutputTokens: 8000,
        capabilities: { tools: true, strictTools: false },
      },
      {
        alias: 'edai-flash',
        providerId: 'anthropic-eu',
        modelId: 'claude-x',
        label: 'Claude AB',
        thinking: 'off',
        maxOutputTokens: 8000,
        capabilities: { tools: true, strictTools: false },
      },
    ],
  });
  const gate = {
    alias: 'edai-flash' as const,
    origins: ['user_text' as const],
    conversationClass: 'client' as const,
    publicModeDeclared: false,
  };
  it('DEV_REAL_LLM=anthropic yalnız development, doğrudan API, kapalı tohumla', () => {
    const d = decide(
      withClaude,
      { edaEnv: 'development', mockLlm: false, devRealLlm: 'anthropic' },
      gate,
    );
    expect(d.ok && d.candidates.map((c) => c.provider.id)).toEqual(['anthropic']);
    expect(
      decide(withClaude, { edaEnv: 'staging', mockLlm: false, devRealLlm: 'anthropic' }, gate).ok,
    ).toBe(false);
  });
  it('DEV_REAL_LLM=anthropic beta-synthetic pilotunda: kapalı tohum yine aday, bayrak ve bildirim', () => {
    const d = decide(
      withClaude,
      { edaEnv: 'beta-synthetic', mockLlm: false, devRealLlm: 'anthropic' },
      gate,
    );
    expect(d.ok && d.candidates.map((c) => c.provider.id)).toEqual(['anthropic']);
    expect(d.ok && d.flags).toEqual(['dev_real_llm']);
    expect(d.ok && d.notices).toEqual(['beta_synthetic']);
    for (const edaEnv of ['production', 'onprem'] as const) {
      expect(decide(withClaude, { edaEnv, mockLlm: false, devRealLlm: 'anthropic' }, gate).ok).toBe(
        false,
      );
    }
  });
  it('anthropic (US) client sınıfını almaz; kapalı sağlayıcı aday olmaz', () => {
    const d = decide(
      withClaude,
      { edaEnv: 'production', mockLlm: false, devRealLlm: null },
      { ...gate, conversationClass: 'public', publicModeDeclared: true },
    );
    expect(d.ok && d.candidates.map((c) => c.provider.id)).toEqual(['deepseek']);
  });
});
