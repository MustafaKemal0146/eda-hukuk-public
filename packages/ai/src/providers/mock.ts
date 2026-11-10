// Mock sağlayıcı (020 §15): fixture oynatıcı. Yalnız MOCK_LLM ve development/test (kapı denetler).
// Adım sırası istemdeki araç sonucu mesajı sayısından çıkarılır; araç sonuçları gerçek yürütücülerden gelir.
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { z } from 'zod';

export const MockFixture = z.object({
  scenario: z.string(),
  task: z.string(),
  steps: z.array(
    z.object({
      parts: z.array(
        z.discriminatedUnion('type', [
          z.object({
            type: z.literal('tool-call'),
            toolCallId: z.string(),
            toolName: z.string(),
            input: z.string(),
          }),
          z.object({ type: z.literal('text-delta'), delta: z.string() }),
        ]),
      ),
      finishReason: z.enum(['stop', 'tool-calls', 'length']),
      usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
    }),
  ),
  /** Parçalar arası yapay gecikme (ms); akış arayüzü testleri için (P10 A5). */
  delayMs: z.number().int().nonnegative().optional(),
});
export type MockFixture = z.infer<typeof MockFixture>;

function stepIndex(options: LanguageModelV4CallOptions): number {
  // Son kullanıcı mesajından sonraki asistan (araç çağrısı) mesajları = tamamlanan adımlar.
  const prompt = options.prompt;
  let lastUser = -1;
  prompt.forEach((m, i) => {
    if (m.role === 'user') lastUser = i;
  });
  return prompt.slice(lastUser + 1).filter((m) => m.role === 'assistant').length;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

export function mockModel(fixture: MockFixture): LanguageModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'mock',
    modelId: `mock:${fixture.scenario}`,
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('mock: yalnız akış')),
    doStream: async (options) => {
      const step = fixture.steps[Math.min(stepIndex(options), fixture.steps.length - 1)];
      if (!step) throw new Error('mock: senaryoda adım yok');
      const delay = fixture.delayMs ?? 0;
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          let textOpen = false;
          for (const part of step.parts) {
            if (options.abortSignal?.aborted) break;
            if (delay > 0) await sleep(delay, options.abortSignal);
            if (part.type === 'text-delta') {
              if (!textOpen) {
                controller.enqueue({ type: 'text-start', id: 't0' });
                textOpen = true;
              }
              controller.enqueue({ type: 'text-delta', id: 't0', delta: part.delta });
            } else {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              });
            }
          }
          if (textOpen) controller.enqueue({ type: 'text-end', id: 't0' });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: step.finishReason, raw: step.finishReason },
            usage: {
              inputTokens: {
                total: step.usage.inputTokens,
                noCache: step.usage.inputTokens,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: {
                total: step.usage.outputTokens,
                text: step.usage.outputTokens,
                reasoning: 0,
              },
            },
          });
          controller.close();
        },
      });
      return { stream };
    },
  };
}

/** Geliştirmede mesaj `/senaryo <ad>` ile başlıyorsa senaryo seçilir; önek mesajdan çıkarılır. */
export function pickScenario(text: string): { scenario: string | null; text: string } {
  const m = /^\/senaryo\s+([a-z0-9_]+)\s*/u.exec(text);
  return m ? { scenario: m[1] ?? null, text: text.slice(m[0].length) } : { scenario: null, text };
}
