// @tk TK-08
// KK-P08-11 (KK-020-15, KK-022-5 hazırlığı, 026 §13.7 S1/S6): wire testi — casus sağlayıcıyla yakalanan
// giden BAYTLARDA sözlük değerlerinin hiçbiri (tam ad, soyad varyantı, TCKN, VKN, IBAN, telefon,
// e-posta) bulunmaz; >= 10.000 tohumlu örnek (fast-check yerine tohumlu PRNG) ve 6 turluk
// betikli konuşma. Markasız istem reddedilir; maskeleme hatası enjekte edilince dış çağrı 0 ve
// KVKK_MASKING_FAILED. Veri sentetiktir (@eda/kvkk/testing).
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { nodeKvkkCrypto } from '@eda/crypto/kvkk-port';
import {
  type CompiledDictionary,
  compileDictionary,
  type DictionaryInput,
  foldChars,
  LEGAL_TERMS,
  sourcesFromInput,
} from '@eda/kvkk';
import { SyntheticGen } from '@eda/kvkk/testing';
import { streamText, wrapLanguageModel } from 'ai';
import { describe, expect, it } from 'vitest';
import { guardedModel } from '../../src/gateway/gateway.ts';
import { egressGuardMiddleware } from '../../src/middleware/egress-guard.ts';
import { MaskingDenied, maskingMiddleware, NullMasker } from '../../src/middleware/masking.ts';
import { createKvkkMasker, type DictionaryProvider } from '../../src/middleware/masking-kvkk.ts';

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const TOKEN =
  /\[(?:KISI|TCKN|VKN|TEL|EPOSTA|IBAN|ADRES|SIRKET|PLAKA|DOSYA|TARIH_DOGUM|SAGLIK)_[A-Z2-7]{4,6}\]/gu;

interface Spy {
  model: LanguageModelV4;
  bodies: string[];
}

function spy(
  reply: (prompt: LanguageModelV4Prompt) => LanguageModelV4StreamPart[] = () => [],
): Spy {
  const bodies: string[] = [];
  const model: LanguageModelV4 = {
    specificationVersion: 'v4',
    provider: 'spy',
    modelId: 'spy',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('yalnız akış')),
    doStream: async (options: LanguageModelV4CallOptions) => {
      bodies.push(JSON.stringify(options.prompt));
      const parts: LanguageModelV4StreamPart[] = [
        ...reply(options.prompt),
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        } as LanguageModelV4StreamPart,
      ];
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(c) {
            for (const p of parts) c.enqueue(p);
            c.close();
          },
        }),
      };
    },
  };
  return { model, bodies };
}

async function collect(
  stream: ReadableStream<LanguageModelV4StreamPart>,
): Promise<LanguageModelV4StreamPart[]> {
  const out: LanguageModelV4StreamPart[] = [];
  const reader = stream.getReader();
  for (;;) {
    const r = await reader.read();
    if (r.done) return out;
    out.push(r.value);
  }
}

function provider(d: CompiledDictionary | null): DictionaryProvider {
  return { current: () => d };
}

function masker(dict: CompiledDictionary | null, scope = '01900000-0000-7000-8000-000000000001') {
  return createKvkkMasker({
    crypto: nodeKvkkCrypto,
    pseudonymKey: KEY,
    scopeId: scope,
    dictionary: provider(dict),
  });
}

const callOpts = (prompt: LanguageModelV4Prompt): LanguageModelV4CallOptions =>
  ({ prompt }) as LanguageModelV4CallOptions;

/** Tek sözcüklü varyant olarak maskelenmesi gereken mi (026 §7.2: >= 4 harf, LEGAL_TERMS değil). */
function singleOk(w: string): boolean {
  return [...w].length >= 4 && !LEGAL_TERMS.has(foldChars(w));
}

interface Planted {
  dictionary: DictionaryInput;
  values: string[];
}

function persona(
  g: SyntheticGen,
  i: number,
): {
  input: DictionaryInput['clients'][number];
  forms: string[];
  values: string[];
} {
  const first = g.givenName();
  const last = g.surname();
  const tckn = g.tckn();
  const vkn = g.vkn();
  const iban = g.ibanFormatted(g.pick(['plain', 'spaced', 'dashed'] as const));
  const phone = g.phone().text;
  const email = g.email();
  const full = `${first} ${last}`;
  const forms = [full, `${first.charAt(0)}. ${last}`];
  if (singleOk(last)) forms.push(last, `${last}'ın`);
  if (singleOk(first)) forms.push(first);
  return {
    input: {
      id: `c${i}`,
      kind: 'person',
      firstName: first,
      lastName: last,
      tckn,
      vkn,
      email,
      phone,
    },
    forms,
    values: [tckn, vkn, iban, phone, email],
  };
}

const FILLER = [
  'kira bedelinin tespiti davası',
  'tahliye taahhüdü',
  'ihtarname gönderildi',
  'Yargıtay 3. HD 2023/118 E.',
  'TBK m. 352 uyarınca',
  'görüşme notları',
  '[K1] kaynağına göre',
];

function sentence(g: SyntheticGen, planted: string[], pool: string[]): string {
  const parts: string[] = [];
  const n = g.int(1, 4);
  for (let i = 0; i < n; i += 1) {
    if (g.next() < 0.6 && pool.length > 0) {
      const v = g.pick(pool);
      planted.push(v);
      parts.push(g.next() < 0.5 ? v : `${g.pick(FILLER)}: ${v}`);
    } else {
      parts.push(g.pick(FILLER));
    }
  }
  return `${parts.join(', ')}.`;
}

function randomConversation(g: SyntheticGen): {
  prompt: LanguageModelV4Prompt;
  planted: Planted;
  leakForms: string[];
} {
  const people = Array.from({ length: g.int(1, 3) }, (_, i) => persona(g, i));
  const pool = people.flatMap((p) => [...p.forms, ...p.values.slice(0, 3)]);
  const planted: string[] = [];
  const msgs: LanguageModelV4Message[] = [
    { role: 'system', content: 'Sabit sistem direktifi (katman 1).' },
    { role: 'user', content: [{ type: 'text', text: sentence(g, planted, pool) }] },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: `Düşünce: [KISI_ABCD] ve ${sentence(g, planted, pool)}` },
        { type: 'text', text: sentence(g, planted, pool) },
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'search_decisions',
          input: { query: sentence(g, planted, pool), page: 1 },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'search_decisions',
          output: {
            type: 'text',
            value: sentence(g, planted, pool),
            providerOptions: { eda: { origin: 'live_source' } },
          },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Evrak: ${sentence(g, planted, pool)}`,
          providerOptions: { eda: { origin: 'attachment' } },
        },
        {
          type: 'text',
          text: `Özet: ${sentence(g, planted, pool)}`,
          providerOptions: { eda: { origin: 'system' } },
        },
        {
          type: 'text',
          text: `[7] ${sentence(g, planted, pool)}`,
          providerOptions: { eda: { origin: 'corpus' } },
        },
        { type: 'text', text: sentence(g, planted, pool) },
      ],
    },
  ];
  return {
    prompt: msgs,
    planted: {
      dictionary: { clients: people.map((p) => p.input), parties: [], cases: [] },
      values: planted,
    },
    leakForms: [
      ...new Set(people.flatMap((p) => [...p.forms.filter((f) => !f.includes("'")), ...p.values])),
    ],
  };
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
}

/** Giden bayt içinde (tokenlar çıkarıldıktan sonra) sözlük değeri geçiyor mu. */
function leaks(body: string, forms: readonly string[]): string[] {
  const clean = body.replace(TOKEN, ' ');
  return forms.filter(
    (f) =>
      clean.includes(f) &&
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRx(f)}(?![\\p{L}\\p{N}])`, 'u').test(clean),
  );
}

describe('KK-P08-11: wire testi (KK-020-15, 026 §13.7 S1)', () => {
  it('KK-P08-11 >= 10.000 rastgele sohbet geçmişi: giden baytlarda sözlük değeri yok', async () => {
    const g = new SyntheticGen(20261011);
    let samples = 0;
    const found: string[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      const conv = randomConversation(g);
      const dict = compileDictionary(
        sourcesFromInput(conv.planted.dictionary, { maskOwnCaseNumber: true }),
        {
          crypto: nodeKvkkCrypto,
        },
      );
      const s = spy();
      const m = masker(dict);
      const model = guardedModel(s.model, m);
      await collect((await model.doStream(callOpts(conv.prompt))).stream);
      const body = s.bodies[0] ?? '';
      expect(s.bodies.length).toBe(1);
      // Sistem direktifi (katman 1) aynen gider.
      expect(body).toContain('Sabit sistem direktifi (katman 1).');
      const hit = leaks(body, conv.leakForms);
      if (hit.length > 0) found.push(`${i}: ${hit.join(' | ')}`);
      samples += 1;
    }
    expect(found.slice(0, 5)).toEqual([]);
    expect(samples).toBeGreaterThanOrEqual(10_000);
  }, 300_000);

  it('KK-P08-11 6 turluk betikli konuşma: istekte değer yok, yanıtta geri çözülmüş', async () => {
    const g = new SyntheticGen(6);
    const p = persona(g, 1);
    const dict = compileDictionary(
      sourcesFromInput({ clients: [p.input], parties: [], cases: [] }, { maskOwnCaseNumber: true }),
      { crypto: nodeKvkkCrypto },
    );
    const full = `${p.input.firstName} ${p.input.lastName}`;
    const tckn = p.input.tckn ?? '';
    let turnNo = 0;
    const s = spy((prompt) => {
      turnNo += 1;
      const tokens = JSON.stringify(prompt).match(TOKEN) ?? [];
      const kisi = tokens.find((t) => t.startsWith('[KISI_')) ?? '[KISI_ZZZZ]';
      const parts: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 'a' },
        { type: 'text-delta', id: 'a', delta: `Tur ${turnNo}: ${kisi.slice(0, 5)}` },
        { type: 'text-delta', id: 'a', delta: `${kisi.slice(5)}'in dosyası hazır.` },
        { type: 'text-end', id: 'a' },
      ];
      if (turnNo === 2) {
        parts.push({
          type: 'tool-call',
          toolCallId: 'q',
          toolName: 'search_decisions',
          input: JSON.stringify({ query: `${kisi} kira tahliye` }),
        });
      }
      if (turnNo === 4) {
        parts.push({
          type: 'tool-call',
          toolCallId: 'd',
          toolName: 'create_document',
          input: JSON.stringify({ title: `${kisi} "ihtar"`, kind: 'ihtarname' }),
        });
      }
      return parts;
    });
    const history: LanguageModelV4Message[] = [{ role: 'system', content: 'Direktif.' }];
    const outputs: string[] = [];
    const toolInputs: Record<string, string> = {};
    for (let turn = 1; turn <= 6; turn += 1) {
      history.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Tur ${turn}: müvekkil ${full}, TC ${tckn}, tel ${p.input.phone}, e-posta ${p.input.email}.`,
          },
        ],
      });
      if (turn === 3) {
        history.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Evrak: ${p.input.lastName}'ın VKN ${p.input.vkn} beyanı.`,
              providerOptions: { eda: { origin: 'attachment' } },
            },
          ],
        });
      }
      const m = masker(dict);
      const res = await guardedModel(s.model, m).doStream(callOpts([...history]));
      const parts = await collect(res.stream);
      const text = parts
        .filter((x) => x.type === 'text-delta')
        .map((x) => (x as { delta: string }).delta)
        .join('');
      for (const x of parts) if (x.type === 'tool-call') toolInputs[x.toolName] = x.input;
      outputs.push(text);
      history.push({ role: 'assistant', content: [{ type: 'text', text }] });
    }
    expect(s.bodies).toHaveLength(6);
    for (const body of s.bodies) {
      expect(
        leaks(body, [full, tckn, p.input.phone ?? '', p.input.email ?? '', p.input.vkn ?? '']),
      ).toEqual([]);
    }
    for (const o of outputs) {
      expect(o).toMatch(new RegExp(`${escapeRx(full)}'[\\p{L}]{1,3} dosyası hazır\\.$`, 'u'));
      expect(o).not.toMatch(TOKEN);
    }
    // strip_tokens: arama sorgusunda token yok; unmask: belge girdisinde gerçek değer, JSON kaçışı korunur.
    expect(JSON.parse(toolInputs.search_decisions ?? '{}')).toEqual({ query: 'kira tahliye' });
    expect(JSON.parse(toolInputs.create_document ?? '{}')).toEqual({
      title: `${full} "ihtar"`,
      kind: 'ihtarname',
    });
    expect(Object.keys(JSON.parse(toolInputs.create_document ?? '{}'))).toEqual(['title', 'kind']);
  });
});

describe('KK-P08-11: markasız istem reddi ve fail-closed (KK-020-15, 026 §13.7 S6)', () => {
  const prompt: LanguageModelV4Prompt = [
    { role: 'system', content: 'Direktif.' },
    { role: 'user', content: [{ type: 'text', text: 'TC 10000000146 hakkında.' }] },
  ];

  it('KK-P08-11 markasız istem egress bekçisinde reddedilir, dış çağrı 0', async () => {
    const s = spy();
    const model = wrapLanguageModel({
      model: s.model,
      middleware: egressGuardMiddleware(masker(null)),
    });
    await expect(model.doStream(callOpts(prompt))).rejects.toBeInstanceOf(MaskingDenied);
    expect(s.bodies).toHaveLength(0);
  });

  it('KK-P08-11 maskeden sonra değiştirilen istem (ham TCKN) doğrulamada reddedilir', async () => {
    const s = spy();
    const m = masker(null);
    const tamper = {
      specificationVersion: 'v4' as const,
      transformParams: async ({ params }: { params: LanguageModelV4CallOptions }) => {
        const msg = params.prompt[1];
        if (msg?.role === 'user' && msg.content[0]?.type === 'text') {
          (msg.content[0] as { text: string }).text += ' 10000000146';
        }
        return params;
      },
    };
    const model = wrapLanguageModel({
      model: s.model,
      middleware: [maskingMiddleware(m), tamper, egressGuardMiddleware(m)],
    });
    await expect(model.doStream(callOpts(prompt))).rejects.toMatchObject({
      code: 'KVKK_MASKING_FAILED',
    });
    expect(s.bodies).toHaveLength(0);
  });

  const failing: [string, () => ReturnType<typeof masker> | NullMasker, string][] = [
    [
      'sözlük okunamadı',
      () =>
        createKvkkMasker({
          crypto: nodeKvkkCrypto,
          pseudonymKey: KEY,
          scopeId: 'x',
          dictionary: {
            current: () => {
              throw new Error('db');
            },
          },
        }),
      'DICTIONARY_UNAVAILABLE',
    ],
    [
      'kripto portu hatası',
      () =>
        createKvkkMasker({
          crypto: {
            hkdfSha256: nodeKvkkCrypto.hkdfSha256,
            hmacSha256: () => {
              throw new Error('hsm');
            },
          },
          pseudonymKey: KEY,
          scopeId: 'x',
          dictionary: provider(null),
        }),
      'INTERNAL',
    ],
    ['maskeleyici kurulmadı (NullMasker)', () => new NullMasker(), 'MASKER_NOT_CONFIGURED'],
  ];
  for (const [name, make, reason] of failing) {
    it(`KK-P08-11 enjekte hata (${name}): dış çağrı 0, KVKK_MASKING_FAILED`, async () => {
      const s = spy();
      const model = guardedModel(s.model, make());
      const err = await Promise.resolve(model.doStream(callOpts(prompt))).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MaskingDenied);
      expect(err).toMatchObject({ code: 'KVKK_MASKING_FAILED', reason });
      expect(String((err as Error).message)).not.toContain('10000000146');
      expect(s.bodies).toHaveLength(0);
    });
  }

  it('KK-P08-11 streamText yolu: maskeleme hatasında tek error parçası, dış çağrı 0', async () => {
    const s = spy();
    const result = streamText({
      model: guardedModel(s.model, new NullMasker()),
      prompt: 'TC 10000000146 hakkında.',
      maxRetries: 0,
      // Hata yalnız akışta tek error parçası olarak gözlenir (konsola yazılmaz).
      onError: () => undefined,
    });
    const errors: unknown[] = [];
    for await (const part of result.fullStream) if (part.type === 'error') errors.push(part.error);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'KVKK_MASKING_FAILED' });
    expect(s.bodies).toHaveLength(0);
  });
});

describe('KK-P08-11: köken etiketi ve korunan katman', () => {
  it('KK-P08-11 eda ad alanı sağlayıcıya gitmez; korpus kökeninde serbest sezgi çalışmaz', async () => {
    const s = spy();
    const prompt: LanguageModelV4Prompt = [
      { role: 'system', content: 'Direktif.' },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Karar: Mehmet Kaya ile Ege Gıda A.Ş. arasında.',
            providerOptions: { eda: { origin: 'corpus' } },
          },
          { type: 'text', text: 'Sayın Mehmet Kaya geldi.' },
        ],
      },
    ];
    await collect((await guardedModel(s.model, masker(null)).doStream(callOpts(prompt))).stream);
    const body = s.bodies[0] ?? '';
    expect(body).not.toContain('"eda"');
    // Korpus kökenli metin sezgiyle maskelenmez; kullanıcı metnindeki ipuçlu ad maskelenir ve öğrenilen
    // yüzey korpus metnine de yayılır (026 §5, §6.7).
    expect(body).toContain('Ege Gıda A.Ş.');
    expect(body).not.toMatch(/Mehmet Kaya/u);
  });
});
